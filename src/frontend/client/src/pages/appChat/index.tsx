import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useRecoilState, useRecoilValue } from "recoil";
import { ChatMessageType, FlowData } from "~/@types/chat";
import { getAssistantDetailApi, getBysConfigApi, getChatHistoryApi, getDeleteFlowApi, getFlowApi, postBuildInit } from "~/api/apps";
import { useToastContext } from "~/Providers";
import ChatView from "./ChatView";
import { bishengConfState, chatIdState, chatsState, currentChatState, runningState,submitDataState, tabsState } from "./store/atoms";
import { AppLostMessage } from "./useWebsocket";

const API_VERSION = 'v1';
export const enum FLOW_TYPES {
    WORK_FLOW = 10,
    ASSISTANT = 5,
    SKILL = 1,
}

export default function index({ chatId = '', flowId = '', shareToken = '', flowType = '' }) {
    const { conversationId: _cid, fid: _fid, type: _type } = useParams();
    const cid = _cid || chatId;
    const fid = _fid || flowId;
    const type = _type || flowType;
    const [readOnly] = useState(shareToken);
    const [chats, setChats] = useRecoilState(chatsState)
    const [__, setRunningState] = useRecoilState(runningState)
    const [_, setChatId] = useRecoilState(chatIdState)
    const chatState = useRecoilValue(currentChatState)
    const build = useBuild()

    const location = useLocation();
    const [submitData, setSubmitData] = useRecoilState(submitDataState)
    const [initCompleted, setInitCompleted] = useState<Record<string, boolean>>({})

    useConfig()

    // 使用ref标记是否已经处理过自动提交，避免重复执行
    const hasProcessedRef = useRef(false);
    const hasSentInitDataRef = useRef(false); // 标记是否已发送init_data
    const hasSentInputRef = useRef(false); // 标记是否已发送input

    // 自动提交数据（如果有）
    useEffect(() => {
        if (location.state?.autoSubmitData && cid) {
            let initTimer: NodeJS.Timeout | null = null;
            let inputTimer: NodeJS.Timeout | null = null;
            
            const executeAutoSubmit = () => {
                // 如果已经处理过，直接返回
                if (hasProcessedRef.current) return;
                
                const currentChat = chats[cid];
                if (currentChat?.flow) {
                    hasProcessedRef.current = true; // 标记为已处理
                    
                    const autoSubmitData = {
                        ...location.state.autoSubmitData,
                        flow: currentChat.flow // 使用已加载的flow数据
                    };
                    
                    console.log('开始自动提交流程，flow数据已就绪');
                    
                    // 先更新UI状态，给用户即时反馈
                    setRunningState((prev) => ({
                        ...prev,
                        [cid]: {
                            ...prev[cid], // 借鉴useAreaText.ts模式：先展开现有状态，避免undefined错误
                            running: true,
                            showStop: true,
                            showUpload: false,
                            inputDisabled: true,
                            inputForm: false as any, // inputForm类型为any，需要类型断言
                            // error、guideWord、showReRun等属性会自动保留，无需手动设置
                        }
                    }));
                    
                    // 采用更可靠的自动提交策略：先发送init_data，等待足够时间后再发送input
                    // 确保WebSocket有足够时间建立连接
                    if (!hasSentInitDataRef.current) {
                        initTimer = setTimeout(() => {
                            console.log('发送init_data消息');
                            hasSentInitDataRef.current = true;
                            // 发送init_data消息建立会话
                            setSubmitData({
                                action: 'init_data',
                                chatId: cid,
                                flow: currentChat.flow
                            });
                            
                            // 等待更长时间确保WebSocket连接建立和init_data处理完成
                            if (!hasSentInputRef.current) {
                                inputTimer = setTimeout(() => {
                                    console.log('发送input消息');
                                    hasSentInputRef.current = true;
                                    setSubmitData({
                                        action: 'input',
                                        chatId: cid,
                                        flow: currentChat.flow,
                                        input: autoSubmitData.input,
                                        files: autoSubmitData.files
                                    });
                                }, 5000); // 等待5秒确保WebSocket连接和init_data处理完成
                            }
                        }, 200); // 等待500ms确保组件状态稳定
                    }
                    // 清除路由状态，避免重复提交
                    window.history.replaceState({}, document.title);
                    // 清除autoSubmitData标记，从根源上避免重复提交
                    if (location.state?.autoSubmitData) {
                        location.state.autoSubmitData = null;
                    }
                }
            };

            // 检查是否已经完成init
            if (initCompleted[cid]) {
                console.log('init已完成，立即执行自动提交');
                executeAutoSubmit();
                
                // 返回清理函数 - 只清理未发送的定时器
                return () => {
                    // 如果init_data还没发送，清理initTimer
                    if (!hasSentInitDataRef.current && initTimer) {
                        // clearTimeout(initTimer);
                    }
                    // 如果input还没发送，清理inputTimer
                    if (!hasSentInputRef.current && inputTimer) {
                        // clearTimeout(inputTimer);
                    }
                    // 注意：这里不重置hasProcessedRef，只在组件卸载时重置
                };
            } else {
                console.log('等待init完成...');
                // 等待init完成
                const waitForInit = setInterval(() => {
                    if (initCompleted[cid]) {
                        console.log('init已完成，执行自动提交');
                        clearInterval(waitForInit);
                        executeAutoSubmit();
                    }
                }, 100); // 每100ms检查一次

                // 设置超时，防止无限等待
                const timeoutTimer = setTimeout(() => {
                    clearInterval(waitForInit);
                    console.warn('等待init完成超时，尝试直接执行自动提交');
                    executeAutoSubmit();
                }, 10000); // 10秒超时

                // 统一的清理函数 - 只清理未发送的定时器
                return () => {
                    clearInterval(waitForInit);
                    clearTimeout(timeoutTimer);
                    if (!hasSentInitDataRef.current && initTimer) clearTimeout(initTimer);
                    if (!hasSentInputRef.current && inputTimer) clearTimeout(inputTimer);
                };
            }
        }
    }, [cid, location.state?.autoSubmitData, initCompleted]); // 移除chats依赖，避免状态更新导致重新执行


    // console.log('[chatState] :>> ', chatState);
    // console.log('[runningState] :>> ', __);
    // 切换会话
    const init = async () => {
        if (!cid) return;

        let flowData: FlowData | null = null
        let messages: ChatMessageType[] = []
        const currentData = chats[cid]
        let error = ''

        setChatId(cid!) // 切换会话

        if (currentData) return; // 有缓存不重复加载

        const numericType = Number(type);

        switch (numericType) {
            case FLOW_TYPES.SKILL:
            case FLOW_TYPES.WORK_FLOW:
                // 获取详情和历史消息
                const [flowRes, msgRes] = await Promise.all([
                    getFlowApi(fid!, API_VERSION, shareToken),
                    getChatHistoryApi({ flowId: fid, chatId: cid, flowType: type, shareToken })
                ])

                if (flowRes.status_code !== 200) {
                    error = AppLostMessage
                    const lostFlow = await getDeleteFlowApi(cid)
                    flowRes.data = {
                        id: lostFlow.data.flow_id,
                        name: lostFlow.data.flow_name,
                        logo: lostFlow.data.flow_logo,
                        flow_type: lostFlow.data.flow_type,
                    }
                }
                messages = msgRes.reverse()
                flowData = { ...flowRes.data, isNew: !messages.length }

                // 插入分割线
                // if (messages.length) {
                //     messages.push({
                //         ...baseMsgItem,
                //         id: Math.random() * 1000000,
                //         category: 'divider',
                //         message: '以上为历史消息',
                //     })
                // }
                if (numericType === FLOW_TYPES.SKILL) {
                    try {
                        await build(flowData, cid);
                    } catch (error) { }
                }
                break;
            case FLOW_TYPES.ASSISTANT:
                const [assistantRes, historyRes] = await Promise.all([
                    getAssistantDetailApi(fid, shareToken),
                    getChatHistoryApi({ flowId: fid, chatId: cid, flowType: type, shareToken })
                ]);

                if (assistantRes.status_code !== 200) {
                    error = AppLostMessage;
                    const lostFlow = await getDeleteFlowApi(cid)
                    assistantRes.data = {
                        name: lostFlow.data.flow_name,
                        logo: lostFlow.data.flow_logo,
                        flow_type: lostFlow.data.flow_type,
                    }
                }
                messages = historyRes.reverse();
                flowData = { ...assistantRes.data, flow_type: FLOW_TYPES.ASSISTANT, isNew: !messages.length };
                break;
            default:
        }

        setChats(prevChats => ({
            ...prevChats,
            [cid]: {
                flow: flowData,
                messages,
                historyEnd: false
            }
        }));

        if (shareToken) {
            error = ''
        }

        // 标记init完成 - 必须在setChats之后，确保chats状态已经更新
        setInitCompleted(prev => ({
            ...prev,
            [cid]: true
        }));

        // 更新状态
        // !!flow.data?.nodes.find(node => ["VariableNode", "InputFileNode"].includes(node.data.type))
        setRunningState((prev) => {
            return {
                ...prev,
                [cid]: {
                    running: false,
                    inputDisabled: error || numericType === FLOW_TYPES.WORK_FLOW,
                    error,
                    inputForm: numericType !== FLOW_TYPES.WORK_FLOW || null,
                    showUpload: numericType === FLOW_TYPES.WORK_FLOW,
                    showStop: false,
                    guideWord: flowData?.guide_question,
                    showReRun: false
                }
            }
        })

    }

    useEffect(() => {
        init()
    }, [cid])

    if (!cid || !chatState?.flow) return null;

    return <ChatView data={chatState.flow} cid={cid} v={API_VERSION} readOnly={readOnly} />
};

const useConfig = () => {
    const [_, setConfig] = useRecoilState(bishengConfState)

    useEffect(() => {
        getBysConfigApi().then(res => {
            setConfig(res.data)
        })
    }, [])
}

/**
 * build flow
 * 校验每个节点，展示进度及结果；返回input_keys;end_of_stream断开链接
 * 主要校验节点并设置更新setTabsState的 formKeysData
 */

const useBuild = () => {
    const { showToast } = useToastContext();
    const [_, setTabsState] = useRecoilState(tabsState)

    // SSE 服务端推送
    async function streamNodeData(flow: any, chatId: string) {
        // Step 1: Make a POST request to send the flow data and receive a unique session ID
        const res = await postBuildInit({ flow, chatId });
        const flowId = res.data.flowId;
        // Step 2: Use the session ID to establish an SSE connection using EventSource
        let validationResults = [];
        let finished = false;
        let buildEnd = false
        const apiUrl = `${__APP_ENV__.BASE_URL}/api/v1/build/stream/${flowId}?chat_id=${chatId}`;
        const eventSource = new EventSource(apiUrl);

        eventSource.onmessage = (event) => {
            // If the event is parseable, return
            if (!event.data) {
                return;
            }
            const parsedData = JSON.parse(event.data);
            // if the event is the end of the stream, close the connection
            if (parsedData.end_of_stream) {
                eventSource.close(); // 结束关闭链接
                buildEnd = true
                return;
            } else if (parsedData.log) {
                // If the event is a log, log it
                // setSuccessData({ title: parsedData.log });
            } else if (parsedData.input_keys) {
                setTabsState((old) => {
                    return {
                        ...old,
                        [flowId]: {
                            ...old[flowId],
                            formKeysData: parsedData,
                        },
                    };
                });
            } else {
                // setProgress(parsedData.progress);
                validationResults.push(parsedData.valid);
            }
        };

        eventSource.onerror = (error: any) => {
            buildEnd = true
            console.error("EventSource failed:", error);
            eventSource.close();
            // if (error.data) {
            //     const parsedData = JSON.parse(error.data);
            //     showToast({ message: parsedData.error, status: 'error' });
            // }
        };
        // Step 3: Wait for the stream to finish
        while (!finished) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            finished = buildEnd // validationResults.length === flow.data.nodes.length;
        }
        // Step 4: Return true if all nodes are valid, false otherwise
        return validationResults.every((result) => result);
    }

    // 延时器
    async function enforceMinimumLoadingTime(
        startTime: number,
        minimumLoadingTime: number
    ) {
        const elapsedTime = Date.now() - startTime;
        const remainingTime = minimumLoadingTime - elapsedTime;

        if (remainingTime > 0) {
            return new Promise((resolve) => setTimeout(resolve, remainingTime));
        }
    }

    async function handleBuild(flow: any, chatId: string) {
        try {
            // const errors = flow.data.nodes.flatMap((n) => validateNode(n, flow.data.edges))
            // if (errors.length > 0) {
            //     return showToast({ message: errors.join('\n'), status: 'error' });
            // }

            const minimumLoadingTime = 200; // in milliseconds
            const startTime = Date.now();

            await streamNodeData(flow, chatId);
            await enforceMinimumLoadingTime(startTime, minimumLoadingTime); // 至少等200ms, 再继续(强制最小load时间)
        } catch (error) {
            console.error("Error:", error);
        } finally {
        }
    }

    return handleBuild
}