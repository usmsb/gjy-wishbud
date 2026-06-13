import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  History,
  Loader2,
  Play,
  RefreshCcw,
  Square,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useRecoilState } from 'recoil';
import { getBysConfigApi, getChatHistoryApi, getChatSessionListApi, getFlowApi, uploadFileWithProgress } from '~/api/apps';
import { dataService } from '~/data-provider/data-provider/src';
import store from '~/store';
import { generateUUID } from '~/utils';
import {
  extractDocxReportUrl,
  extractMessageText,
  normalizeFileUrl,
  parseReportDocx,
  parseReportText,
  type ReportRow,
} from './reportParser';
import './index.css';

type RunState = 'idle' | 'uploading' | 'running' | 'streaming' | 'paused' | 'complete' | 'error';
type HistoryStatus = RunState;
type UploadSlot = 'pdf' | 'docx';
type NodeStatus = 'waiting' | 'running' | 'done' | 'error';

type UploadFile = {
  name: string;
  size: number;
  raw?: File;
  path?: string;
  uploadProgress?: number;
};

type ReviewNode = {
  id: string;
  name: string;
  type: string;
};

type ReviewHistory = {
  id: string;
  chatId?: string;
  title: string;
  submittedAt: string;
  status: HistoryStatus;
  progress: number;
  duration: string;
  files: Record<UploadSlot, UploadFile | null>;
  nodeStatusMap: Record<string, NodeStatus>;
  summary: string;
  rows: ReportRow[];
  reportUrl?: string;
  rawReport?: string;
};

const LOGO_SRC = '/workspace/assets/negative-list/gztri-logo.jpeg';
const WORKFLOW_ID = '440870e48aa8494181c57f59613fe822';
const START_NODE_ID = 'start_cc7f3';
const INPUT_NODE_ID = 'input_fc2dc';
const FINAL_LLM_NODE_ID = 'llm_bb10a';
const REPORT_NODE_ID = 'report_78962';
const END_NODE_ID = 'end_273a4';
const HISTORY_PAGE_SIZE = 100;
const HISTORY_MAX_PAGES = 30;

function formatFileSize(size: number) {
  if (!size) return '0 KB';
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getNodeStatusText(status: NodeStatus) {
  if (status === 'done') return '已完成';
  if (status === 'running') return '执行中';
  if (status === 'error') return '异常';
  return '等待中';
}

function getHistoryStatusText(status: HistoryStatus) {
  if (status === 'complete') return '已完成';
  if (status === 'streaming') return '报告生成中';
  if (status === 'uploading') return '上传中';
  if (status === 'running') return '进行中';
  if (status === 'paused') return '已停止';
  if (status === 'error') return '异常';
  return '待开始';
}

function computeNodeProgress(statusMap: Record<string, NodeStatus>, nodes: ReviewNode[]) {
  if (!nodes.length) return 0;
  const done = nodes.filter((node) => statusMap[node.id] === 'done').length;
  const running = nodes.filter((node) => statusMap[node.id] === 'running').length;
  if (!done && !running) return 0;
  return Math.min(99, Math.max(1, Math.round(((done + running * 0.35) / nodes.length) * 100)));
}

function normalizeFlowPayload(flow: any) {
  if (!flow) return null;
  const graphData = flow.data && typeof flow.data === 'object' ? flow.data : {};
  const { data: _data, ...flowMeta } = flow;
  return { ...flowMeta, ...graphData };
}

function getWorkflowNodes(flow: any): ReviewNode[] {
  const nodes = flow?.nodes || flow?.data?.nodes || [];
  if (!Array.isArray(nodes)) return [];

  return nodes
    .filter((node: any) => node?.id)
    .map((node: any) => ({
      id: node.id,
      name:
        node.data?.name ||
        node.data?.label ||
        node.data?.title ||
        node.data?.node?.display_name ||
        node.data?.node?.name ||
        node.name ||
        node.id,
      type: node.type || node.data?.type || node.data?.node?.type || '-',
    }));
}

function normalizeDateTime(value: any) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatDateTime(date);
}

function formatDuration(startValue: any, endValue: any) {
  const start = startValue ? new Date(startValue).getTime() : NaN;
  const end = endValue ? new Date(endValue).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '未记录耗时';

  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds} 秒`;

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes} 分 ${restSeconds} 秒` : `${minutes} 分钟`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
}

function parseReportMarkdown(markdown: string): { summary: string; rows: ReportRow[] } {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tableStart = lines.findIndex((line) => line.startsWith('|') && line.includes('有无负面清单'));
  const summaryLines = tableStart >= 0 ? lines.slice(0, tableStart) : lines.filter((line) => !line.startsWith('|'));
  const summary = summaryLines
    .join('')
    .replace(/^\*\*/, '')
    .replace(/\*\*$/, '')
    .replace(/^#+\s*/, '')
    .trim();

  if (tableStart < 0) return { summary, rows: [] };

  const rows = lines
    .slice(tableStart + 1)
    .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line))
    .map((line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => Number.isFinite(Number(cells[0])) && cells.length >= 3)
    .map((cells) => ({
      no: Number(cells[0]),
      name: cells[1] || '',
      hasNegative: cells[2].includes('有') ? '有' : '无',
      detail: cells.slice(3).join('|').trim(),
    }));

  return { summary, rows };
}

function getHistoryMessageNodeId(item: any) {
  return item?.message?.node_id || item?.message?.nodeId || item?.node_id || item?.nodeId || '';
}

function getHistoryMessageText(item: any) {
  const message = item?.message;
  if (typeof message === 'string') return message;
  if (typeof message?.msg === 'string') return message.msg;
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.output === 'string') return message.output;
  if (typeof message?.answer === 'string') return message.answer;
  return extractMessageText(item);
}

function normalizeMessagesOrder(messages: any[]) {
  return [...messages].sort((a, b) => {
    const aId = Number(a?.id);
    const bId = Number(b?.id);
    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
    return new Date(a?.create_time || 0).getTime() - new Date(b?.create_time || 0).getTime();
  });
}

function buildNodeStatusMapFromMessages(messages: any[]) {
  return normalizeMessagesOrder(messages).reduce<Record<string, NodeStatus>>((map, item) => {
    const nodeId = getHistoryMessageNodeId(item);
    if (!nodeId) return map;

    if (item.category === 'node_run') {
      if (item.type === 'start') map[nodeId] = 'running';
      if (item.type === 'end') map[nodeId] = item.message?.reason ? 'error' : 'done';
    }

    if (item.category === 'input' || item.category === 'question') {
      map[START_NODE_ID] = map[START_NODE_ID] || 'done';
      if (nodeId) map[nodeId] = 'done';
    }

    if (item.category === 'stream_msg' || item.category === 'output_msg') {
      map[nodeId] = item.type === 'end' ? 'done' : 'running';
    }

    return map;
  }, {});
}

function extractReportTextFromMessages(messages: any[]) {
  const finalMessages = normalizeMessagesOrder(messages).filter((item) => getHistoryMessageNodeId(item) === FINAL_LLM_NODE_ID);
  const chunks = finalMessages.map(getHistoryMessageText).filter(Boolean);
  if (!chunks.length) {
    return normalizeMessagesOrder(messages)
      .filter((item) => ['report', 'answer', 'output_msg', 'stream_msg'].includes(item.category))
      .map(getHistoryMessageText)
      .filter((text) => text.includes('负面清单'))
      .sort((a, b) => b.length - a.length)[0] || '';
  }

  const endText = [...finalMessages].reverse().find((item) => item.type === 'end' && getHistoryMessageText(item));
  const endMessageText = endText ? getHistoryMessageText(endText) : '';
  if (endMessageText.includes('有无负面清单') || endMessageText.length > 500) return endMessageText;
  return chunks.join('');
}

function extractReportUrlFromMessages(messages: any[]) {
  const reportMessages = normalizeMessagesOrder(messages).filter((item) => {
    const nodeId = getHistoryMessageNodeId(item);
    return nodeId === REPORT_NODE_ID || (!item.isSend && item.category !== 'question');
  });

  for (const item of reportMessages) {
    const url = extractDocxReportUrl(item) || extractReportFileUrl(item);
    if (url) return normalizeFileUrl(url);
  }

  return '';
}

function fileNameFromPath(value: string) {
  if (!value) return '';
  const path = value.split('?')[0].split('#')[0];
  const name = path.split('/').pop() || path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function collectFileLikeValues(value: any, result: any[] = []) {
  if (!value) return result;

  if (typeof value === 'string') {
    if (/\.(pdf|docx)(\?|#|$)/i.test(value)) result.push(value);
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectFileLikeValues(item, result));
    return result;
  }

  if (typeof value !== 'object') return result;

  const direct = value.file_name || value.name || value.filename || value.original_filename || value.file_url || value.file_path || value.path || value.url;
  if (direct && /\.(pdf|docx)(\?|#|$)/i.test(String(direct))) result.push(value);

  Object.values(value).forEach((item) => collectFileLikeValues(item, result));
  return result;
}

function normalizeUploadFile(value: any): UploadFile | null {
  const direct = typeof value === 'string'
    ? value
    : value?.file_name || value?.name || value?.filename || value?.original_filename || value?.file_url || value?.file_path || value?.path || value?.url;
  if (!direct) return null;

  const rawName = String(value?.file_name || value?.name || value?.filename || value?.original_filename || fileNameFromPath(String(direct)));
  const path = typeof value === 'string' ? value : value?.file_url || value?.file_path || value?.path || value?.url || '';
  return {
    name: rawName || fileNameFromPath(String(direct)),
    size: Number(value?.size || value?.file_size || 0),
    path: path ? normalizeFileUrl(String(path)) : undefined,
  };
}

function extractUploadedFilesFromMessages(messages: any[]): Record<UploadSlot, UploadFile | null> {
  const result: Record<UploadSlot, UploadFile | null> = { pdf: null, docx: null };

  normalizeMessagesOrder(messages).forEach((item) => {
    if (!item.isSend && item.category !== 'question' && item.category !== 'input') return;

    const candidates = [
      ...(Array.isArray(item.files) ? item.files : []),
      ...collectFileLikeValues(item.message),
    ];

    const text = getHistoryMessageText(item);
    const pdfName = text.match(/上传成果PDF文件[:：]\s*([^\n\r]+)/i)?.[1]?.trim();
    const docxName = text.match(/请上传word文件[:：]\s*([^\n\r]+)/i)?.[1]?.trim();
    if (pdfName) candidates.push(pdfName);
    if (docxName) candidates.push(docxName);

    candidates.forEach((candidate) => {
      const file = normalizeUploadFile(candidate);
      if (!file?.name) return;
      if (/\.pdf$/i.test(file.name) && !result.pdf) result.pdf = file;
      if (/\.docx$/i.test(file.name) && !result.docx) result.docx = file;
    });
  });

  return result;
}

function inferHistoryStatus(messages: any[], statusMap: Record<string, NodeStatus>, reportUrl: string): HistoryStatus {
  if (Object.values(statusMap).includes('error')) return 'error';
  if (statusMap[END_NODE_ID] === 'done' || statusMap[REPORT_NODE_ID] === 'done' || reportUrl) return 'complete';
  if (Object.values(statusMap).includes('running')) return 'running';
  if (messages.length) return 'paused';
  return 'idle';
}

function extractReportFileUrl(payload: any): string {
  const queue = [payload];
  const seen = new Set<any>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'string') {
      if (/\.docx(\?|$)/i.test(current)) return current;
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current === 'object') {
      const direct = current.file_url || current.url || current.fileUrl || current.download_url;
      if (typeof direct === 'string' && /\.docx(\?|$)/i.test(direct)) return direct;
      Object.values(current).forEach((value) => queue.push(value));
    }
  }

  return '';
}

function getMessageNodeId(payload: any) {
  return payload?.message?.node_id || payload?.node_id || '';
}

export default function NegativeListReviewDemo() {
  const [clientUser, setClientUser] = useRecoilState(store.user);
  const [runState, setRunState] = useState<RunState>('idle');
  const [progress, setProgress] = useState(0);
  const [files, setFiles] = useState<Record<UploadSlot, UploadFile | null>>({
    pdf: null,
    docx: null,
  });
  const [streamText, setStreamText] = useState('');
  const [selectedHistoryId, setSelectedHistoryId] = useState('current');
  const [nodeStatusMap, setNodeStatusMap] = useState<Record<string, NodeStatus>>({});
  const [apiStage, setApiStage] = useState('等待上传文档');
  const [apiError, setApiError] = useState('');
  const [workflowFlow, setWorkflowFlow] = useState<any>(null);
  const [bishengConfig, setBishengConfig] = useState<any>(null);
  const [startedAt, setStartedAt] = useState('');
  const [activeChatId, setActiveChatId] = useState('');
  const [activeReportSummary, setActiveReportSummary] = useState('');
  const [activeReportRows, setActiveReportRows] = useState<ReportRow[]>([]);
  const [reportDownloadUrl, setReportDownloadUrl] = useState('');
  const [savedHistories, setSavedHistories] = useState<ReviewHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamTextRef = useRef('');
  const filesRef = useRef(files);
  const reviewNodes = useMemo(() => getWorkflowNodes(workflowFlow), [workflowFlow]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!['running', 'streaming'].includes(runState)) return;
    const computed = computeNodeProgress(nodeStatusMap, reviewNodes);
    if (computed > 0) setProgress((value) => Math.max(value, computed));
  }, [nodeStatusMap, reviewNodes, runState]);

  useEffect(() => {
    let mounted = true;

    getBysConfigApi()
      .then((res) => mounted && setBishengConfig(res.data))
      .catch(() => mounted && setBishengConfig(null));

    if (!clientUser) {
      dataService.getUser()
        .then((nextUser) => mounted && setClientUser(nextUser))
        .catch(() => undefined);
    }

    loadWorkflowFlow()
      .then((flow) => mounted && setWorkflowFlow(flow))
      .catch(() => mounted && setApiStage('工作流详情待连接，开始审查时将重试'));

    return () => {
      mounted = false;
      wsRef.current?.close();
    };
  }, [clientUser, setClientUser]);

  const loadWorkflowFlow = async () => {
    try {
      const response = await getFlowApi(WORKFLOW_ID);
      if (response?.status_code && response.status_code !== 200) {
        throw new Error(response.status_message || '工作流详情接口返回异常');
      }
      const flow = response?.data || response;
      const normalized = normalizeFlowPayload(flow);
      if (normalized?.nodes?.length) return normalized;
    } catch (error) {
      try {
        const fallbackResponse = await fetch(`${__APP_ENV__.BASE_URL}/api/v1/workflow/get_one_flow/${WORKFLOW_ID}`, {
          credentials: 'include',
        });
        const fallbackText = await fallbackResponse.text();
        const fallbackJson = fallbackText ? JSON.parse(fallbackText) : null;
        if (fallbackJson?.status_code && fallbackJson.status_code !== 200) {
          throw new Error(fallbackJson.status_message || '工作流详情接口返回异常');
        }
        const normalized = normalizeFlowPayload(fallbackJson?.data || fallbackJson);
        if (normalized?.nodes?.length) return normalized;
      } catch {
        throw new Error(`未获取到工作流详情，请确认工作流 ${WORKFLOW_ID} 已导入并上线。`);
      }
      throw new Error(`未获取到工作流详情，请确认工作流 ${WORKFLOW_ID} 已导入并上线。`);
    }

    throw new Error('未获取到工作流节点数据');
  };

  const loadCompleteChatHistory = useCallback(async (chatId: string) => {
    const collected: any[] = [];
    let cursor: number | undefined;

    for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
      const pageMessages = await getChatHistoryApi({
        flowId: WORKFLOW_ID,
        chatId,
        flowType: '10',
        id: cursor,
        pageSize: HISTORY_PAGE_SIZE,
      });

      if (!Array.isArray(pageMessages) || !pageMessages.length) break;

      collected.push(...pageMessages);
      const oldestMessage = pageMessages[pageMessages.length - 1];
      const nextCursor = Number(oldestMessage?.id);
      if (!Number.isFinite(nextCursor) || nextCursor === cursor || pageMessages.length < HISTORY_PAGE_SIZE) break;
      cursor = nextCursor;
    }

    const deduped = new Map<string | number, any>();
    collected.forEach((item, index) => {
      deduped.set(item?.id ?? `${item?.create_time || ''}-${index}`, item);
    });

    return normalizeMessagesOrder(Array.from(deduped.values()));
  }, []);

  const buildReviewHistoryFromSession = useCallback(async (session: any, nodes: ReviewNode[]): Promise<ReviewHistory> => {
    const messages = await loadCompleteChatHistory(session.chat_id);
    const filesFromHistory = extractUploadedFilesFromMessages(messages);
    const nodeStatusFromHistory = buildNodeStatusMapFromMessages(messages);
    const reportUrl = extractReportUrlFromMessages(messages);
    const rawReport = extractReportTextFromMessages(messages);
    const markdownReport = parseReportMarkdown(rawReport);
    const textReport = markdownReport.summary ? markdownReport : parseReportText(rawReport);

    let summary = markdownReport.summary || textReport.summary || '';
    let rows = markdownReport.rows;

    if (reportUrl && !rows.length) {
      try {
        const docxReport = await parseReportDocx(reportUrl);
        summary = summary || docxReport.summary;
        rows = docxReport.rows;
      } catch (error) {
        console.warn('negative list report docx parse failed', error);
      }
    }

    const nodeStatusMapForHistory = {
      ...nodeStatusFromHistory,
      ...(reportUrl ? { [REPORT_NODE_ID]: 'done' as NodeStatus } : {}),
    };
    const status = inferHistoryStatus(messages, nodeStatusMapForHistory, reportUrl);
    if (status === 'complete') {
      nodeStatusMapForHistory[END_NODE_ID] = nodeStatusMapForHistory[END_NODE_ID] || 'done';
    }

    const title = filesFromHistory.docx?.name || filesFromHistory.pdf?.name || session.flow_name || '负面清单审查';
    const progressValue = status === 'complete' ? 100 : computeNodeProgress(nodeStatusMapForHistory, nodes);

    return {
      id: session.chat_id,
      chatId: session.chat_id,
      title,
      submittedAt: normalizeDateTime(session.create_time),
      status,
      progress: progressValue,
      duration: status === 'complete' ? formatDuration(session.create_time, session.update_time) : getHistoryStatusText(status),
      files: filesFromHistory,
      nodeStatusMap: nodeStatusMapForHistory,
      summary,
      rows,
      reportUrl,
      rawReport,
    };
  }, [loadCompleteChatHistory]);

  const loadReviewHistories = useCallback(async (nodes: ReviewNode[] = reviewNodes) => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const sessions: any[] = [];

      for (let page = 1; page <= HISTORY_MAX_PAGES; page += 1) {
        const response = await getChatSessionListApi({
          page,
          limit: HISTORY_PAGE_SIZE,
          flowId: WORKFLOW_ID,
          flowType: 10,
        });
        const pageSessions = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
        sessions.push(...pageSessions);
        if (pageSessions.length < HISTORY_PAGE_SIZE) break;
      }

      const histories = await Promise.all(
        sessions
          .filter((session) => session?.chat_id)
          .map((session) => buildReviewHistoryFromSession(session, nodes)),
      );

      setSavedHistories(histories);
    } catch (error: any) {
      setHistoryError(error?.message || '历史记录读取失败');
      setSavedHistories([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [buildReviewHistoryFromSession, reviewNodes]);

  useEffect(() => {
    if (!workflowFlow) return;
    loadReviewHistories(reviewNodes);
  }, [loadReviewHistories, reviewNodes, workflowFlow]);

  const updateNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    if (!nodeId) return;
    setNodeStatusMap((current) => ({
      ...current,
      [nodeId]: status,
    }));
  }, []);

  const markWorkflowComplete = useCallback((downloadUrl = '') => {
    const parsed = parseReportMarkdown(streamTextRef.current);
    const nextSummary = parsed.summary || activeReportSummary;
    const nextRows = parsed.rows.length ? parsed.rows : activeReportRows;

    setNodeStatusMap((current) => ({
      ...current,
      [REPORT_NODE_ID]: 'done',
      [END_NODE_ID]: 'done',
    }));
    setActiveReportSummary(nextSummary);
    setActiveReportRows(nextRows);
    setReportDownloadUrl((current) => downloadUrl || current);
    setProgress(100);
    setRunState('complete');
    setApiStage(downloadUrl ? '报告已生成，可下载 DOCX' : '审查已完成');
    setSelectedHistoryId('current');

    window.setTimeout(() => {
      loadReviewHistories(reviewNodes).catch(() => undefined);
    }, 800);
  }, [activeReportRows, activeReportSummary, loadReviewHistories, reviewNodes]);

  const handleWorkflowMessage = useCallback((payload: any, ws: WebSocket, submitData: { pdfPath: string; docxPath: string }) => {
    if (payload.category === 'error' || payload.type === 'error') {
      const errorMessage = typeof payload.message === 'string'
        ? payload.message
        : payload.message?.status_message || '工作流执行异常';
      setApiError(errorMessage);
      setApiStage('工作流执行异常');
      setRunState('error');
      const nodeId = getMessageNodeId(payload);
      if (nodeId) updateNodeStatus(nodeId, 'error');
      return;
    }

    const reportFileUrl = normalizeFileUrl(extractReportFileUrl(payload));
    if (reportFileUrl) {
      setReportDownloadUrl(reportFileUrl);
    }

    if (payload.category === 'node_run') {
      const nodeId = payload.message?.node_id;
      if (payload.type === 'start') {
        updateNodeStatus(nodeId, 'running');
        setApiStage(`正在执行：${payload.message?.name || nodeId}`);
      } else if (payload.type === 'end') {
        updateNodeStatus(nodeId, payload.message?.reason ? 'error' : 'done');
        setApiStage(payload.message?.reason ? `节点异常：${payload.message?.name || nodeId}` : `已完成：${payload.message?.name || nodeId}`);
      }
      return;
    }

    if (payload.category === 'input') {
      const nodeId = payload.message?.node_id || INPUT_NODE_ID;
      updateNodeStatus(START_NODE_ID, 'done');
      updateNodeStatus(nodeId, 'running');
      setApiStage('工作流等待表单输入，正在提交已上传文件');
      const message = [
        `上传成果PDF文件:${filesRef.current.pdf?.name || ''}`,
        `请上传word文件:${filesRef.current.docx?.name || ''}`,
      ].join('\n');

      ws.send(JSON.stringify({
        action: 'input',
        chat_id: payload.chat_id,
        flow_id: WORKFLOW_ID,
        data: {
          [nodeId]: {
            data: {
              file: [submitData.pdfPath],
              file2_docx: [submitData.docxPath],
            },
            message,
            message_id: payload.message_id,
            category: 'question',
            extra: '',
            source: 0,
          },
        },
      }));
      updateNodeStatus(nodeId, 'done');
      setApiStage('文件已提交，审查节点开始排队执行');
      return;
    }

    if (payload.category === 'stream_msg') {
      const nodeId = payload.message?.node_id;
      const chunk = payload.message?.msg || '';
      if (nodeId === FINAL_LLM_NODE_ID) {
        updateNodeStatus(FINAL_LLM_NODE_ID, payload.type === 'end' ? 'done' : 'running');
        setRunState(payload.type === 'end' ? 'running' : 'streaming');
        setApiStage(payload.type === 'end' ? '报告内容输出完成，正在生成 DOCX' : '大模型2正在流式输出报告内容');
      }

      if (payload.type === 'end') {
        streamTextRef.current = chunk || streamTextRef.current;
        setStreamText(streamTextRef.current);
        const parsed = parseReportMarkdown(streamTextRef.current);
        setActiveReportSummary(parsed.summary);
        setActiveReportRows(parsed.rows);
        setProgress((value) => Math.max(value, 96));
      } else {
        streamTextRef.current += chunk;
        setStreamText(streamTextRef.current);
        setProgress((value) => Math.max(value, 90));
      }
      return;
    }

    if (payload.category === 'output_msg' && payload.message?.node_id === FINAL_LLM_NODE_ID) {
      const msg = payload.message?.msg || '';
      streamTextRef.current = msg;
      setStreamText(msg);
      const parsed = parseReportMarkdown(msg);
      setActiveReportSummary(parsed.summary);
      setActiveReportRows(parsed.rows);
      updateNodeStatus(FINAL_LLM_NODE_ID, 'done');
      setApiStage('报告内容输出完成，正在生成 DOCX');
      return;
    }

    if (payload.message?.node_id === REPORT_NODE_ID || reportFileUrl) {
      updateNodeStatus(REPORT_NODE_ID, reportFileUrl ? 'done' : 'running');
      setApiStage(reportFileUrl ? 'DOCX 报告已返回' : '正在生成 DOCX 报告');
    }

    if (payload.type === 'close') {
      updateNodeStatus(REPORT_NODE_ID, 'done');
      updateNodeStatus(END_NODE_ID, 'done');
      markWorkflowComplete(reportFileUrl);
    }
  }, [markWorkflowComplete, updateNodeStatus]);

  const uploadWorkflowFile = async (slot: UploadSlot, file: File) => {
    setFiles((current) => ({
      ...current,
      [slot]: current[slot] ? { ...current[slot]!, uploadProgress: 0 } : null,
    }));

    const result = await uploadFileWithProgress(file, (value: number) => {
      setFiles((current) => ({
        ...current,
        [slot]: current[slot] ? { ...current[slot]!, uploadProgress: value } : null,
      }));
    });

    if (typeof result === 'string') throw new Error(result);
    const filePath = result?.file_path;
    if (!filePath) throw new Error(`${file.name} 上传后未返回 file_path`);

    setFiles((current) => ({
      ...current,
      [slot]: current[slot] ? { ...current[slot]!, path: filePath, uploadProgress: 100 } : null,
    }));

    return filePath;
  };

  const startReview = async () => {
    if (!files.pdf?.raw || !files.docx?.raw) {
      setApiError('请重新选择本地 PDF 和 DOCX 文件后再开始审查。');
      return;
    }

    try {
      wsRef.current?.close();
      streamTextRef.current = '';
      setApiError('');
      setStreamText('');
      setActiveReportSummary('');
      setActiveReportRows([]);
      setReportDownloadUrl('');
      setNodeStatusMap({ [START_NODE_ID]: 'running' });
      setRunState('uploading');
      setProgress(3);
      setStartedAt(formatDateTime(new Date()));
      setSelectedHistoryId('current');
      setApiStage('正在确认工作流配置');

      const flow = workflowFlow || await loadWorkflowFlow();
      setWorkflowFlow(flow);

      setApiStage('正在上传 PDF 与 DOCX 文件');

      const [pdfPath, docxPath] = await Promise.all([
        uploadWorkflowFile('pdf', files.pdf.raw),
        uploadWorkflowFile('docx', files.docx.raw),
      ]);

      setApiStage('文件上传完成，正在连接工作流');
      setRunState('running');
      setProgress(8);

      const chatId = `negative_list_${Date.now()}_${generateUUID(8)}`;
      setActiveChatId(chatId);
      const host = bishengConfig?.websocket_url || window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const basePath = __APP_ENV__.BASE_URL;
      const ws = new WebSocket(`${protocol}://${host}${basePath}/api/v1/workflow/chat/${WORKFLOW_ID}?chat_id=${chatId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setApiStage('工作流已连接，正在初始化节点');
        ws.send(JSON.stringify({
          action: 'init_data',
          chat_id: chatId,
          flow_id: WORKFLOW_ID,
          data: flow,
        }));
      };

      ws.onmessage = (event) => {
        try {
          handleWorkflowMessage(JSON.parse(event.data), ws, { pdfPath, docxPath });
        } catch (error) {
          console.error('workflow websocket parse error', error);
        }
      };

      ws.onerror = () => {
        setApiError('工作流 websocket 连接异常。');
        setApiStage('工作流连接异常');
        setRunState('error');
      };

      ws.onclose = () => {
        wsRef.current = null;
        setApiStage((stage) => {
          if (['complete', 'error', 'paused'].includes(runState)) return stage;
          return stage || '工作流连接已关闭';
        });
      };
    } catch (error: any) {
      setApiError(error?.message || '接口对接执行失败');
      setApiStage('接口执行失败');
      setRunState('error');
    }
  };

  const stopReview = () => {
    try {
      wsRef.current?.send(JSON.stringify({ action: 'stop' }));
    } catch (error) {
      console.error(error);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setRunState('paused');
    setApiStage('审查已停止');
  };

  const resetReview = () => {
    stopReview();
    setRunState('idle');
    setProgress(0);
    setStreamText('');
    streamTextRef.current = '';
    setNodeStatusMap({});
    setApiError('');
    setApiStage('等待上传文档');
    setActiveReportSummary('');
    setActiveReportRows([]);
    setReportDownloadUrl('');
    setActiveChatId('');
    setSelectedHistoryId('current');
  };

  const handleFile = (slot: UploadSlot, file?: File) => {
    if (!file) return;
    const expected = slot === 'pdf' ? /\.pdf$/i : /\.docx$/i;
    if (!expected.test(file.name)) {
      setApiError(slot === 'pdf' ? '成果 PDF 仅支持 .pdf 文件。' : '成果 DOCX 仅支持 .docx 文件。');
      return;
    }
    setFiles((current) => ({
      ...current,
      [slot]: { name: file.name, size: file.size, raw: file },
    }));
    setRunState('idle');
    setProgress(0);
    setStreamText('');
    streamTextRef.current = '';
    setNodeStatusMap({});
    setApiError('');
    setApiStage('等待开始审查');
    setActiveReportSummary('');
    setActiveReportRows([]);
    setReportDownloadUrl('');
    setActiveChatId('');
    setSelectedHistoryId('current');
  };

  const removeFile = (slot: UploadSlot) => {
    setFiles((current) => ({
      ...current,
      [slot]: null,
    }));
    resetReview();
  };

  const currentStatus: HistoryStatus = runState;
  const currentHistory: ReviewHistory = useMemo(
    () => ({
      id: 'current',
      chatId: activeChatId,
      title: '当前负面清单审查',
      submittedAt: startedAt || '-',
      status: currentStatus,
      progress,
      duration: runState === 'complete' ? '已生成报告' : apiStage,
      files,
      nodeStatusMap,
      summary: runState === 'complete' ? activeReportSummary : '',
      rows: runState === 'complete' ? activeReportRows : [],
      reportUrl: reportDownloadUrl,
      rawReport: streamText,
    }),
    [activeChatId, activeReportRows, activeReportSummary, apiStage, files, nodeStatusMap, progress, reportDownloadUrl, runState, startedAt, streamText],
  );

  const histories = useMemo(
    () => [currentHistory, ...savedHistories.filter((item) => item.id !== activeChatId)],
    [activeChatId, currentHistory, savedHistories],
  );
  const selectedHistory = histories.find((item) => item.id === selectedHistoryId) || currentHistory;
  const canStart = Boolean(files.pdf?.raw && files.docx?.raw);
  const isBusy = runState === 'uploading' || runState === 'running' || runState === 'streaming';
  const selectedIsComplete = selectedHistory.status === 'complete';
  const selectedRawReport = selectedHistory.id === 'current' ? streamText : selectedHistory.rawReport || '';
  const selectedIsStreaming = selectedHistory.status === 'streaming' || Boolean(selectedRawReport && !selectedIsComplete);
  const nodeRows = reviewNodes.map((node) => ({
    ...node,
    status: selectedHistory.nodeStatusMap[node.id] || 'waiting' as NodeStatus,
  }));
  const doneCount = nodeRows.filter((node) => node.status === 'done').length;
  const runningCount = nodeRows.filter((node) => node.status === 'running').length;
  const waitingCount = nodeRows.filter((node) => node.status === 'waiting').length;
  const errorCount = nodeRows.filter((node) => node.status === 'error').length;
  const nodePanel = (
    <section className="nlr-panel nlr-nodePanel">
      <div className="nlr-nodeHeader">
        <div>
          <p>节点进度</p>
          <h2>审查过程</h2>
        </div>
        <div className="nlr-nodeCounters">
          <span>已完成 {doneCount}</span>
          <span>执行中 {runningCount}</span>
          <span>等待中 {waitingCount}</span>
          {!!errorCount && <span>异常 {errorCount}</span>}
        </div>
      </div>
      {reviewNodes.length ? (
        <div className="nlr-nodeList">
          {nodeRows.map((node) => (
            <div className={`nlr-nodeRow ${node.status}`} key={node.id}>
              <NodeIcon status={node.status} />
              <strong>{node.name}</strong>
              <em>{node.id}</em>
              <span>{node.type}</span>
              <b>{getNodeStatusText(node.status)}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="nlr-uploadHint">正在读取工作流节点配置。</div>
      )}
    </section>
  );

  return (
    <main className="nlr-shell">
      <header className="nlr-header">
        <div className="nlr-brand">
          <span className="nlr-logoFrame">
            <img src={LOGO_SRC} alt="GZTRI" />
          </span>
          <div>
            <p>成果质量审查工作台</p>
            <h1>负面清单智能审查</h1>
          </div>
        </div>
        <div className="nlr-headerMeta">
          <StatusPill state={selectedHistory.status} />
          <span>
            <Clock3 size={16} />
            {selectedHistory.duration || '等待开始'}
          </span>
          <span>{clientUser?.name || clientUser?.username || '当前用户'}</span>
        </div>
      </header>

      <section className="nlr-layout">
        <aside className="nlr-sidebar">
          <section className="nlr-panel nlr-uploadPanel">
            <PanelTitle label="上传文档" icon={<UploadCloud size={19} />} />
            <FileSlot
              label="成果 PDF"
              acceptText="支持 .pdf"
              file={files.pdf}
              onPick={() => pdfInputRef.current?.click()}
              onRemove={() => removeFile('pdf')}
            />
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf"
              hidden
              onChange={(event) => handleFile('pdf', event.target.files?.[0])}
            />
            <FileSlot
              label="成果 DOCX"
              acceptText="支持 .docx"
              file={files.docx}
              onPick={() => docxInputRef.current?.click()}
              onRemove={() => removeFile('docx')}
            />
            <input
              ref={docxInputRef}
              type="file"
              accept=".docx"
              hidden
              onChange={(event) => handleFile('docx', event.target.files?.[0])}
            />
            <div className="nlr-actionRow">
              <button
                className="nlr-primaryBtn"
                onClick={isBusy ? stopReview : startReview}
                disabled={!isBusy && !canStart}
              >
                {isBusy ? <Square size={16} /> : <Play size={18} />}
                {isBusy ? '停止审查' : runState === 'paused' || runState === 'error' ? '重新开始' : '开始审查'}
              </button>
              <button className="nlr-iconBtn" onClick={resetReview} aria-label="重置审查">
                <RefreshCcw size={18} />
              </button>
            </div>
            {!canStart && <div className="nlr-uploadHint">请同时上传 PDF 和 DOCX 后再开始审查。</div>}
            {apiError && <div className="nlr-errorBox">{apiError}</div>}
          </section>

          <section className="nlr-panel nlr-historyPanel">
            <PanelTitle label="检查历史" icon={<History size={19} />} />
            {historyLoading && <div className="nlr-uploadHint">正在读取后端历史记录...</div>}
            {historyError && <div className="nlr-errorBox">{historyError}</div>}
            {!historyLoading && !historyError && savedHistories.length === 0 && (
              <div className="nlr-uploadHint">暂无后端历史记录。</div>
            )}
            <div className="nlr-historyList">
              {histories.map((item) => (
                <button
                  key={item.id}
                  className={`nlr-historyItem ${selectedHistory.id === item.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setSelectedHistoryId(item.id);
                  }}
                >
                  <span className={`nlr-historyDot ${item.status}`} />
                  <strong>{item.title}</strong>
                  <em>{item.submittedAt}</em>
                  <b>{getHistoryStatusText(item.status)}</b>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="nlr-main">
          <section className="nlr-panel nlr-progressPanel">
            <div>
              <p>{selectedHistory.id === 'current' ? '当前审查' : '历史记录'}</p>
              <h2>{selectedHistory.files.docx?.name || selectedHistory.files.pdf?.name || '未选择文件'}</h2>
            </div>
            <div className="nlr-progressTop">
              <strong>{selectedHistory.progress}%</strong>
              <span>{getHistoryStatusText(selectedHistory.status)}</span>
            </div>
            <div className="nlr-progressTrack">
              <span style={{ width: `${selectedHistory.progress}%` }} />
            </div>
            <div className="nlr-progressNote">
              {selectedIsComplete
                ? '审查已完成，以下内容来自工作流最终流式报告内容和生成的 DOCX 报告。'
                : selectedHistory.status === 'streaming'
                  ? '最后大模型节点正在流式输出报告内容，DOCX 报告生成完成后可下载。'
                  : selectedHistory.status === 'idle'
                    ? '请上传 PDF 和 DOCX 后开始审查。'
                    : selectedHistory.status === 'paused'
                      ? '审查已停止，可重新开始。'
                      : selectedHistory.status === 'error'
                        ? '接口执行异常，请检查登录态、工作流是否已上线以及后端服务是否可用。'
                        : apiStage || '审查正在执行，当前仅展示节点进度，结果将在报告生成后统一展示。'}
            </div>
          </section>

          {selectedIsComplete ? (
            <section className="nlr-panel nlr-reportPanel">
              <div className="nlr-reportHeader">
                <div>
                  <p>报告统计说明</p>
                  <h2>负面清单审查结果</h2>
                </div>
                {selectedHistory.reportUrl ? (
                  <a className="nlr-downloadBtn" href={selectedHistory.reportUrl} download="报告.docx">
                    <ArrowDownToLine size={18} />
                    下载 DOCX 报告
                  </a>
                ) : (
                  <span className="nlr-downloadBtn is-disabled">
                    <ArrowDownToLine size={18} />
                    等待 DOCX
                  </span>
                )}
              </div>
              <div className="nlr-summaryText">{selectedHistory.summary || '暂未解析到统计说明。'}</div>
              {selectedHistory.rows.length ? (
                <div className="nlr-reportBody">
                  <div className="nlr-reportTable">
                    <div className="nlr-reportTableHead">
                      <span>序号</span>
                      <span>负面清单问题</span>
                      <span>有无负面清单</span>
                      <span>详细问题说明</span>
                    </div>
                    {selectedHistory.rows.map((row) => (
                      <div
                        className={`nlr-reportRow ${row.hasNegative === '有' ? 'has-negative' : 'no-negative'}`}
                        key={row.no}
                      >
                        <span>{row.no}</span>
                        <strong>{row.name}</strong>
                        <b>{row.hasNegative}</b>
                        <div className="nlr-reportDetailCell">
                          {row.hasNegative === '有' && row.detail ? renderDetail(row.detail) : '无'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <pre className="nlr-rawReport">{selectedRawReport || '未解析到报告表格。'}</pre>
              )}
            </section>
          ) : (
            <>
              {selectedIsStreaming && (
                <section className="nlr-panel nlr-streamPanel">
                  <div className="nlr-streamHeader">
                    <div>
                      <p>大模型2 / llm_bb10a</p>
                      <h2>流式报告内容</h2>
                    </div>
                    <span>{runState === 'streaming' ? '正在输出' : '已接收'}</span>
                  </div>
                  <pre>{selectedRawReport || '等待大模型开始输出...'}</pre>
                </section>
              )}
            </>
          )}
          {nodePanel}
        </section>
      </section>
    </main>
  );
}

function PanelTitle({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div className="nlr-panelTitle">
      <h2>{label}</h2>
      {icon}
    </div>
  );
}

function FileSlot({
  label,
  acceptText,
  file,
  onPick,
  onRemove,
}: {
  label: string;
  acceptText: string;
  file: UploadFile | null;
  onPick: () => void;
  onRemove: () => void;
}) {
  const isUploading = typeof file?.uploadProgress === 'number' && file.uploadProgress < 100;

  return (
    <div className={`nlr-fileSlot ${file ? 'is-ready' : ''}`}>
      <button className="nlr-filePick" onClick={onPick}>
        <FileText size={22} />
        <span>{label}</span>
        <strong>{file?.name || acceptText}</strong>
        <em>{file ? `${formatFileSize(file.size)}${file.path ? ' / 已上传' : ''}` : '等待上传'}</em>
      </button>
      {file && (
        <button className="nlr-fileRemove" onClick={onRemove} aria-label={`移除${label}`}>
          <XCircle size={18} />
        </button>
      )}
      {isUploading && (
        <div className="nlr-fileProgress">
          <span style={{ width: `${file.uploadProgress || 0}%` }} />
        </div>
      )}
    </div>
  );
}

function StatusPill({ state }: { state: HistoryStatus }) {
  return <span className={`nlr-statusPill ${state}`}>{getHistoryStatusText(state)}</span>;
}

function NodeIcon({ status }: { status: NodeStatus }) {
  if (status === 'done') return <CheckCircle2 size={18} />;
  if (status === 'running') return <Loader2 size={18} />;
  if (status === 'error') return <XCircle size={18} />;
  return <Circle size={18} />;
}

function renderDetail(detail: string) {
  return detail.split('<br>').map((line, index) => (
    <p key={`${line}-${index}`}>{line}</p>
  ));
}
