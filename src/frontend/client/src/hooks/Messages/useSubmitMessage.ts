import { useCallback } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { v4 } from 'uuid';
import { useAddedChatContext, useChatContext, useChatFormContext } from '~/Providers';
import { sameSopLabelState } from '~/components/Chat/Input/SameSopSpan';
import { Constants } from '~/data-provider/data-provider/src';
import { useAuthContext } from '~/hooks/AuthContext';
import store from '~/store';
import { replaceSpecialVars } from '~/utils';
import { useSetFilesToDelete } from '../Files';
import { useLinsightSessionManager } from '../useLinsightManager';

import { useQueryClient } from '@tanstack/react-query'
import { addConversation, generateUUID } from "~/utils"
import { ConversationData, QueryKeys } from "~/data-provider/data-provider/src"
import { useNavigate } from 'react-router-dom';
import { getFlowApi } from "~/api/apps";
import { chatFileState, chatIdState, currentChatState, runningState, submitDataState } from "~/pages/appChat/store/atoms";


const appendIndex = (index: number, value?: string) => {
  if (!value) {
    return value;
  }
  return `${value}${Constants.COMMON_DIVIDER}${index}`;
};

export default function useSubmitMessage(helpers?: { clearDraft?: () => void }) {
  const { user } = useAuthContext();
  const methods = useChatFormContext();
  const { files, setFiles, ask, index, getMessages, setMessages, latestMessage } = useChatContext();
  const { addedIndex, ask: askAdditional, conversation: addedConvo } = useAddedChatContext();

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const activeConvos = useRecoilValue(store.allConversationsSelector);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));
  const { setLinsightSubmission } = useLinsightSessionManager('new')
  const setFilesToDelete = useSetFilesToDelete();
  const [sameSopLabel, setSameSopLabel] = useRecoilState(sameSopLabelState)


  
  const searchType = useRecoilValue(store.searchType);
  const { setConversation } = store.useCreateConversationAtom(0);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [_, setSubmitDataState] = useRecoilState(submitDataState)
  const [__, setRunningState] = useRecoilState(runningState)
  const [chatFile, setChatFileState] = useRecoilState(chatFileState)
  const chatState = useRecoilValue(currentChatState)
  // 添加chatId状态管理，与useAreaText.ts保持一致
  const [chatId, setChatId] = useRecoilState(chatIdState)
  const getFlow = async (id) => {
    const [flowRes] = await Promise.all([
      getFlowApi(id,  'v1')
    ])
    const flowData = { ...flowRes.data, isNew: false}
    return flowData
  }


  const submitMessage = useCallback(
    (data?: { text: string, linsight?: boolean, tools?: any[] }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }

      if (data?.linsight) {
        setLinsightSubmission('new', {
          sameSopId: sameSopLabel?.id || undefined,
          isNew: true,
          files: Array.from(files.values()).map(item => ({
            file_id: item.file_id,
            file_name: item.filename,
            parsing_status: 'completed'
          })),
          question: data?.text,
          // feedback: '',
          tools: data.tools,
          model: 'gpt-4',
          enableWebSearch: false,
          useKnowledgeBase: true
        });
        // 重置表单和清理草稿
        methods.reset();
        setFiles(new Map())
        setFilesToDelete({});
        helpers?.clearDraft && helpers.clearDraft();
        return setSameSopLabel(null);
      }
      const pro_knowledge_enabled = searchType && searchType === 'enterpriseKnowledgeSearch' || false;
      if(pro_knowledge_enabled){
          const _chatId = generateUUID(32)
          const flowId = 'bb89020ee1ac4d0c8d3b12234d0a85b9'
          const flowType = 10
          
          // 首先更新全局chatId状态，确保后续操作使用正确的chatId
          setChatId(_chatId)
          
          // 新建会话 - 使用与ChatView.tsx一致的完整流程
          queryClient.setQueryData<ConversationData>([QueryKeys.allConversations], (convoData) => {
            if (!convoData) {
                return convoData;
            }
            
            // 关键修复：正确设置conversation状态
            setConversation((prevState: any) => ({
                ...prevState,
                conversationId: _chatId,
                flowId,
                flowType,
                title: "知识库问答"
            }));
            
            return addConversation(convoData, {
                conversationId: _chatId,
                createdAt: new Date().toISOString(),
                endpoint: null,
                endpointType: null,
                model: "",
                flowId,
                flowType: flowType,
                title: "知识库问答",
                tools: [],
                updatedAt: new Date().toISOString()
            });
          });
          
          // 关键修复：先获取flow数据，再设置状态和导航
          getFlow(flowId).then(flowData => {
            // 设置当前对话状态，确保页面能正确显示
            queryClient.setQueryData([QueryKeys.conversation, _chatId], {
              conversationId: _chatId,
              flowId,
              flowType,
              title: "知识库问答",
              ...flowData
            });
            
            // 重置表单和清理草稿
            methods.reset();
            setFiles(new Map())
            setFilesToDelete({});
            helpers?.clearDraft && helpers.clearDraft();
            
            // 关键修复：先导航，等待页面加载完成后再设置提交数据状态
            navigate(`/chat/${_chatId}/${flowId}/${flowType}`, {
              state: {
                autoSubmitData: {
                  input: data?.text,
                  action: 'input',
                  chatId: _chatId,
                  flow: flowData,
                  files: chatFile,
                }
              }
            });
            
          }).catch(error => {
            console.error('获取流程数据失败:', error);
            // 处理错误情况，可以设置错误状态或显示错误信息
            setRunningState((prev) => ({
              ...prev,
              [_chatId]: {
                ...prev[_chatId],
                running: false,
                showStop: false,
                showUpload: true,
                inputDisabled: false,
                inputForm: true,
              },
            }))
          });
        return;
      }
      // 检查最新消息是否在会话中
      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }
      // 处理会话 ID 和消息 ID 的逻辑
      const hasAdded = addedIndex && activeConvos[addedIndex] && addedConvo;
      const isNewMultiConvo =
        hasAdded &&
        activeConvos.every((convoId) => convoId === Constants.NEW_CONVO) &&
        !rootMessages?.length;
      const overrideConvoId = isNewMultiConvo ? v4() : undefined;
      const overrideUserMessageId = hasAdded ? v4() : undefined;
      const rootIndex = addedIndex - 1;
      const clientTimestamp = new Date().toISOString();
      // 发送消息
      ask({
        text: data.text,
        overrideConvoId: appendIndex(rootIndex, overrideConvoId),
        overrideUserMessageId: appendIndex(rootIndex, overrideUserMessageId),
        clientTimestamp,
      });

      // 处理附加消息（如果有）
      if (hasAdded) {
        askAdditional(
          {
            text: data.text,
            overrideConvoId: appendIndex(addedIndex, overrideConvoId),
            overrideUserMessageId: appendIndex(addedIndex, overrideUserMessageId),
            clientTimestamp,
          },
          { overrideMessages: rootMessages },
        );
      }
      // 重置表单和清理草稿
      methods.reset();
      helpers?.clearDraft && helpers.clearDraft();
    },
    [
      ask,
      methods,
      helpers,
      addedIndex,
      addedConvo,
      setMessages,
      getMessages,
      activeConvos,
      askAdditional,
      latestMessage,
    ],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const currentText = methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
