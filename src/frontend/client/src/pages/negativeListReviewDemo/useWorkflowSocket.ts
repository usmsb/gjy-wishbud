import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkflowInputRequest = {
  nodeId: string;
  messageId?: string | number;
  inputSchema?: any;
};

type ConnectOptions = {
  flow: any;
  chatId: string;
};

type UseWorkflowSocketOptions = {
  workflowId: string;
  onMessage?: (data: any) => void;
  onNodeRun?: (data: any) => void;
  onComplete?: (data: any) => void;
  onError?: (error: Error | string, data?: any) => void;
};

function getWebSocketUrl(workflowId: string, chatId: string) {
  const isSecureProtocol = window.location.protocol === 'https:';
  const protocol = isSecureProtocol ? 'wss' : 'ws';
  const basePath = __APP_ENV__.BASE_URL;
  return `${protocol}://${window.location.host}${basePath}/api/v1/workflow/chat/${workflowId}?chat_id=${chatId}`;
}

function getFlowPayload(flow: any) {
  if (!flow) return {};
  const { data, ...rest } = flow;
  return data ? { ...rest, ...data } : flow;
}

function findInputVariable(flow: any, nodeId: string) {
  const nodes = flow?.data?.nodes || flow?.nodes || [];
  const node = nodes.find((item: any) => item.id === nodeId);
  const tab = node?.data?.tab?.value;

  let variable = '';
  node?.data?.group_params?.some((group: any) =>
    group?.params?.some((param: any) => {
      if (!tab || param.tab === tab) {
        variable = param.key;
        return true;
      }
      return false;
    }),
  );

  return variable || 'input';
}

export function useWorkflowSocket({ workflowId, onMessage, onNodeRun, onComplete, onError }: UseWorkflowSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const flowRef = useRef<any>(null);
  const chatIdRef = useRef('');
  const inputRequestRef = useRef<WorkflowInputRequest | null>(null);
  const [inputRequest, setInputRequest] = useState<WorkflowInputRequest | null>(null);
  const [readyState, setReadyState] = useState<number>(WebSocket.CLOSED);

  const close = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setReadyState(WebSocket.CLOSED);
  }, []);

  const sendRaw = useCallback((payload: any) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      onError?.('WebSocket 未连接，无法发送消息');
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }, [onError]);

  const sendInput = useCallback((message: string, filePaths: string[]) => {
    const request = inputRequestRef.current;
    const flow = flowRef.current;
    const chatId = chatIdRef.current;

    if (!request || !flow || !chatId) {
      onError?.('尚未收到工作流输入节点，无法提交文件');
      return false;
    }

    const variable = findInputVariable(flow, request.nodeId);
    return sendRaw({
      action: 'input',
      chat_id: chatId,
      flow_id: workflowId,
      data: {
        [request.nodeId]: {
          data: {
            [variable]: message,
            dialog_files_content: filePaths,
          },
          message,
          message_id: request.messageId,
          category: 'question',
          extra: '',
          source: 0,
        },
      },
    });
  }, [onError, sendRaw, workflowId]);

  const stop = useCallback(() => {
    sendRaw({ action: 'stop' });
  }, [sendRaw]);

  const connect = useCallback(({ flow, chatId }: ConnectOptions) => {
    close();
    flowRef.current = flow;
    chatIdRef.current = chatId;
    inputRequestRef.current = null;
    setInputRequest(null);

    const ws = new WebSocket(getWebSocketUrl(workflowId, chatId));
    wsRef.current = ws;
    setReadyState(ws.readyState);

    ws.onopen = () => {
      setReadyState(ws.readyState);
      ws.send(JSON.stringify({
        action: flow?.isNew === false ? 'check_status' : 'init_data',
        chat_id: chatId,
        flow_id: workflowId,
        data: getFlowPayload(flow),
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage?.(data);

        if (data.category === 'node_run') {
          onNodeRun?.(data);
        }

        if (data.category === 'input') {
          const request: WorkflowInputRequest = {
            nodeId: data.message?.node_id,
            messageId: data.message_id,
            inputSchema: data.message?.input_schema,
          };
          inputRequestRef.current = request;
          setInputRequest(request);
        }

        if ((data.type === 'close' && data.category === 'processing') || data.type === 'end_cover') {
          onComplete?.(data);
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : String(error));
      }
    };

    ws.onerror = () => {
      setReadyState(ws.readyState);
      onError?.('WebSocket 连接异常');
    };

    ws.onclose = () => {
      setReadyState(WebSocket.CLOSED);
    };

    return ws;
  }, [close, onComplete, onError, onMessage, onNodeRun, workflowId]);

  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  return {
    connect,
    close,
    inputRequest,
    readyState,
    sendInput,
    stop,
  };
}
