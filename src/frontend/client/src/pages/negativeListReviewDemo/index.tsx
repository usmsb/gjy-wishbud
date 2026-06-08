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
import { getBysConfigApi, getFlowApi, uploadFileWithProgress } from '~/api/apps';
import { dataService } from '~/data-provider/data-provider/src';
import store from '~/store';
import { generateUUID } from '~/utils';
import './index.css';

type RunState = 'idle' | 'uploading' | 'running' | 'streaming' | 'paused' | 'complete' | 'error';
type HistoryStatus = RunState;
type UploadSlot = 'pdf' | 'docx';
type NodeStatus = 'waiting' | 'running' | 'done' | 'error';
type NegativeFlag = '有' | '无';

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

type ReportRow = {
  no: number;
  name: string;
  hasNegative: NegativeFlag;
  detail: string;
};

type ReviewHistory = {
  id: string;
  title: string;
  submittedAt: string;
  status: HistoryStatus;
  progress: number;
  duration: string;
  files: Record<UploadSlot, UploadFile | null>;
  summary: string;
  rows: ReportRow[];
  reportUrl?: string;
};

const LOGO_SRC = '/workspace/assets/negative-list/gztri-logo.jpeg';
const REPORT_DOCX_SRC = '/workspace/assets/negative-list/report-demo.docx';
const WORKFLOW_ID = '440870e48aa8494181c57f59613fe822';
const INPUT_NODE_ID = 'input_fc2dc';
const FINAL_LLM_NODE_ID = 'llm_bb10a';
const REPORT_NODE_ID = 'report_78962';
const END_NODE_ID = 'end_273a4';

const reportSummary =
  '本次检查项目成果质量负面清单表中除需人工审查外的21项（负面清单第1-7项、第9项、第13-21项、第23-26项），上传项目成果共出现8项负面清单问题，分别为第2、3、6、7、9、14、15、16项，具体详见下表，请仔细核对修改完善。';

const reportRows: ReportRow[] = [
  { no: 1, name: '成果无封面', hasNegative: '无', detail: '' },
  {
    no: 2,
    name: '成果无扉页或未按照我院规范要求编写（如项目负责人与任务单不一致、项目组人员未涵盖投标文件成员），扉页项目名称、单位名称、人员姓名、职称职务等关键信息错误',
    hasNegative: '有',
    detail: '出现1个问题；<br>问题1：扉页中审定人员“汪振东”的职称与职务职称表不一致，发现“教授级高级工程师”，应为“副高级”或“高级工程师”，建议修改。',
  },
  {
    no: 3,
    name: '出现与项目明显无关内容（如直接复制其他项目内容）',
    hasNegative: '有',
    detail: '出现1个问题；<br>问题1：第18页第2章第2.2.2节第3段出现与项目明显无关内容，发现“地铁1号线：线路起于西塱站……止于广州东站……”的描述，该内容与项目（中山八地块）的交通现状及规划分析无关，建议删除。',
  },
  { no: 4, name: '报告目录与正文章节、页码不对应', hasNegative: '无', detail: '' },
  { no: 5, name: '同一层级报告格式（如字体、行间距等）前后不统一', hasNegative: '无', detail: '' },
  {
    no: 6,
    name: '背景、结论等重要章节出现错别字或任一页内出现2处及以上错别字',
    hasNegative: '有',
    detail: '出现2个问题；<br>问题1：第21页第2章第2.2.4节第1段有错别字，发现“评估估范围内”，应为“评估范围内”，建议修改；<br>问题2：第21页第2章第2.2.4节第1段有错别字，发现“前规道路”，应为“规划道路”，建议修改。',
  },
  {
    no: 7,
    name: '数据前后矛盾、单位错误或计算错误',
    hasNegative: '有',
    detail: '出现3个问题；<br>问题1：第2页第1章第2段表1-1中，数据行“公交设施”的数值单位重复标注，发现“25000㎡”，应为“25000”，建议修改；<br>问题2：第17页第2章第2段表2-2中面积数据前后不一致，建议核对；<br>问题3：第35页方案指标计算过程存在前后矛盾，建议复核。',
  },
  {
    no: 9,
    name: '图表排序错乱，图名与图形不在同一页，表格跨页未重复显示标题行',
    hasNegative: '有',
    detail: '出现2个问题；<br>问题1：第15页图名“图2-5 现状项目周边主要道路断面图（2）现状交通组织”与图形不在同一页；<br>问题2：第23页图名“图2-14 现状项目周边慢行道情况示意”与图形不在同一页，建议调整。',
  },
  {
    no: 13,
    name: '成果未按照国家强制性规范条文编制，控规及其专项等未参照市局模板编制，交评未参照我院技术指引编制',
    hasNegative: '无',
    detail: '',
  },
  {
    no: 14,
    name: '引用已过期的研究依据或标准规范，或名称表述错误。',
    hasNegative: '有',
    detail: '出现11个问题；<br>问题1：引用标准代号错误，发现“城市快速路设计规程（CJJ-2009）”，应为“CJJ 129-2009”；<br>问题2：引用标准代号错误，发现“城市道路交通组织设计规范”，建议核对现行标准名称。',
  },
  {
    no: 15,
    name: '现状描述与实际不符，数据引用过于陈旧',
    hasNegative: '有',
    detail: '出现1个问题；<br>问题1：第2章第2.2.1节表2-1中，现状描述与实际不符，发现东风西路被描述为“主干道”，根据知识库最新数据应为“快捷路”，建议修正。',
  },
  {
    no: 16,
    name: '既有规划缺失、有误或引用未经批复成果，缺少与本项目的针对性分析',
    hasNegative: '有',
    detail: '出现1个问题；<br>问题1：第2章第2.3节“地区交通规划”中，既有规划介绍缺失，未介绍项目范围内及周边的土地利用规划情况，建议补充说明规划用地性质。',
  },
  { no: 17, name: '未在背景中考虑说明地理位置邻近的已批复项目', hasNegative: '无', detail: '' },
  { no: 18, name: '项目背景只有宏观性描述，缺少与项目的针对性分析', hasNegative: '无', detail: '' },
  { no: 19, name: '项目技术路线（图）与报告内容不对应', hasNegative: '无', detail: '' },
  { no: 20, name: '现状分析、需求预测、目标策略、方案措施等内容前后不对应', hasNegative: '无', detail: '' },
  { no: 23, name: '项目涉及道路主骨架路网调整，但未提供相关分析说明或专题论证', hasNegative: '无', detail: '' },
  { no: 24, name: '项目涉及轨道线站位调整，但未进行专题论证说明', hasNegative: '无', detail: '' },
  { no: 25, name: '项目涉及永久基本农田等，但未补充相关情况说明', hasNegative: '无', detail: '' },
  { no: 26, name: '项目涉及地铁、水务、环境、文物等，但未提示征求相关部门意见', hasNegative: '无', detail: '' },
];

const workflowNodes: ReviewNode[] = [
  { id: 'start_cc7f3', name: '开始', type: 'start' },
  { id: 'input_fc2dc', name: '输入', type: 'input' },
  { id: 'agent_91463', name: '提取研究依据章节', type: 'agent' },
  { id: 'code_c09d8', name: '扉页内容提取', type: 'code' },
  { id: 'code_ee1ea', name: '封面提取', type: 'code' },
  { id: 'agent_5a048', name: '15-1现状描述内容提取（信息无损版）', type: 'agent' },
  { id: 'agent_8576d', name: '研究依据知识库查询', type: 'agent' },
  { id: 'agent_b843f', name: '19-项目技术路线与报告内容不对应', type: 'agent' },
  { id: 'agent_88e95', name: '20-现状分析、需求预测、目标策略、方案措施等内容前后不对应', type: 'agent' },
  { id: 'agent_378dd', name: '17未在背景中考虑说明地理位置邻近的已批复项目', type: 'agent' },
  { id: 'agent_b5f8a', name: '18-项目背景审查', type: 'agent' },
  { id: 'agent_9bb6a', name: '16-既有规划缺失或有误或引用未经批复成果', type: 'agent' },
  { id: 'llm_f5514', name: '封面信息提取', type: 'llm' },
  { id: 'agent_1a1ed', name: '有无扉页判断', type: 'agent' },
  { id: 'agent_cdfec', name: '6-错别字检测', type: 'agent' },
  { id: 'agent_79150', name: '14-引用内容过期或错误', type: 'agent' },
  { id: 'agent_45af0', name: '7-数据-助手', type: 'agent' },
  { id: 'agent_83192', name: '13-成果符合规范检查', type: 'agent' },
  { id: 'agent_2c5a3', name: '15-2知识库查询（仅输出知识库数据，不限格式）', type: 'agent' },
  { id: 'agent_5b0fc', name: '29-合作项目技术方案冲突检查', type: 'agent' },
  { id: 'agent_5971c', name: '判断是否封面', type: 'agent' },
  { id: 'condition_c2454', name: '条件分支2', type: 'condition' },
  { id: 'agent_559a2', name: '28-牵头合作项目成果统筹检查', type: 'agent' },
  { id: 'agent_559ad', name: '27-院内多部门合作协调检查', type: 'agent' },
  { id: 'agent_90403', name: '3-出现与项目明显无关内容', type: 'agent' },
  { id: 'agent_d4559', name: '26-涉及外部部门意见提示检查', type: 'agent' },
  { id: 'agent_5f6bd', name: '25-永久基本农田相关说明检查', type: 'agent' },
  { id: 'agent_60d00', name: '4-目录章节页码对应检查', type: 'agent' },
  { id: 'agent_24613', name: '24-轨道线站位调整检查', type: 'agent' },
  { id: 'code_8f276', name: '表名图名检查', type: 'code' },
  { id: 'agent_42472', name: '23-路网调整分析论证检查', type: 'agent' },
  { id: 'code_3d274', name: '格式解读', type: 'code' },
  { id: 'condition_f0558', name: '条件分支', type: 'condition' },
  { id: 'llm_9be5f', name: '提取成果文件中项目名称', type: 'llm' },
  { id: 'agent_2ba03', name: '15-现状描述与实际不符，数据引用过于陈旧', type: 'agent' },
  { id: 'knowledge_retriever_2adf3', name: '检索人员职务职称信息数据', type: 'knowledge_retriever' },
  { id: 'llm_80a31', name: '封面缺失结果', type: 'llm' },
  { id: 'agent_0a011', name: '封面要素分析助手', type: 'agent' },
  { id: 'agent_ce6c8', name: '筛选任务单信息', type: 'agent' },
  { id: 'llm_fe4f1', name: '扉页缺失结果', type: 'llm' },
  { id: 'code_6c375', name: '标题编号检查', type: 'code' },
  { id: 'agent_1920b', name: '扉页要素检查助手', type: 'agent' },
  { id: 'llm_e6f7b', name: '1-封面检测', type: 'llm' },
  { id: 'agent_75bd3', name: '扉页职称检查助手', type: 'agent' },
  { id: 'llm_df1fa', name: '5-排版格式检查', type: 'llm' },
  { id: 'agent_35831', name: '2-扉页检查', type: 'agent' },
  { id: 'llm_9dfc8', name: '大模型汇总', type: 'llm' },
  { id: 'llm_acc21', name: '2-扉页检查结果', type: 'llm' },
  { id: 'llm_bb10a', name: '大模型2：自相矛盾检查并输出报告内容', type: 'llm' },
  { id: 'report_78962', name: '报告生成', type: 'report' },
  { id: 'end_273a4', name: '结束', type: 'end' },
];

const historyItems: ReviewHistory[] = [
  {
    id: 'his-20260607-01',
    title: '白云片区成果负面清单审查',
    submittedAt: '2026-06-07 16:48',
    status: 'complete',
    progress: 100,
    duration: '32 分钟',
    reportUrl: REPORT_DOCX_SRC,
    files: {
      pdf: { name: '白云片区交通影响评估报告.pdf', size: 17400000 },
      docx: { name: '白云片区交通影响评估报告.docx', size: 6400000 },
    },
    summary: '本次检查项目成果质量负面清单表中除需人工审查外的21项，上传项目成果共出现3项负面清单问题，分别为第3、14、16项，具体详见下表，请仔细核对修改完善。',
    rows: reportRows.map((row) =>
      [3, 14, 16].includes(row.no)
        ? row
        : {
            ...row,
            hasNegative: '无' as NegativeFlag,
            detail: '',
          },
    ),
  },
  {
    id: 'his-20260606-02',
    title: '中山八地块成果负面清单审查',
    submittedAt: '2026-06-06 10:12',
    status: 'complete',
    progress: 100,
    duration: '36 分钟',
    reportUrl: REPORT_DOCX_SRC,
    files: {
      pdf: { name: '中山八地块交通影响评估报告.pdf', size: 18400000 },
      docx: { name: '中山八地块交通影响评估报告.docx', size: 6820000 },
    },
    summary: reportSummary,
    rows: reportRows,
  },
];

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

function computeNodeProgress(statusMap: Record<string, NodeStatus>) {
  const done = workflowNodes.filter((node) => statusMap[node.id] === 'done').length;
  const running = workflowNodes.filter((node) => statusMap[node.id] === 'running').length;
  if (!done && !running) return 0;
  return Math.min(99, Math.max(1, Math.round(((done + running * 0.35) / workflowNodes.length) * 100)));
}

function normalizeFlowPayload(flow: any) {
  if (!flow) return null;
  const graphData = flow.data && typeof flow.data === 'object' ? flow.data : {};
  const { data: _data, ...flowMeta } = flow;
  return { ...flowMeta, ...graphData };
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
      hasNegative: cells[2].includes('有') ? '有' as NegativeFlag : '无' as NegativeFlag,
      detail: cells.slice(3).join('|').trim(),
    }));

  return { summary, rows };
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
  const [selectedReportNo, setSelectedReportNo] = useState<number | null>(null);
  const [nodeStatusMap, setNodeStatusMap] = useState<Record<string, NodeStatus>>({});
  const [apiStage, setApiStage] = useState('等待上传文档');
  const [apiError, setApiError] = useState('');
  const [workflowFlow, setWorkflowFlow] = useState<any>(null);
  const [bishengConfig, setBishengConfig] = useState<any>(null);
  const [startedAt, setStartedAt] = useState('');
  const [activeReportSummary, setActiveReportSummary] = useState('');
  const [activeReportRows, setActiveReportRows] = useState<ReportRow[]>([]);
  const [reportDownloadUrl, setReportDownloadUrl] = useState('');
  const [savedHistories, setSavedHistories] = useState<ReviewHistory[]>(historyItems);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamTextRef = useRef('');
  const filesRef = useRef(files);
  const completionSavedRef = useRef(false);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!['running', 'streaming'].includes(runState)) return;
    const computed = computeNodeProgress(nodeStatusMap);
    if (computed > 0) setProgress((value) => Math.max(value, computed));
  }, [nodeStatusMap, runState]);

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
    const allDone = workflowNodes.reduce<Record<string, NodeStatus>>((map, node) => {
      map[node.id] = 'done';
      return map;
    }, {});

    setNodeStatusMap(allDone);
    setActiveReportSummary(nextSummary);
    setActiveReportRows(nextRows);
    setReportDownloadUrl((current) => downloadUrl || current);
    setProgress(100);
    setRunState('complete');
    setApiStage(downloadUrl ? '报告已生成，可下载 DOCX' : '审查已完成');
    setSelectedHistoryId('current');
    setSelectedReportNo(nextRows.find((row) => row.hasNegative === '有')?.no || null);

    if (!completionSavedRef.current) {
      completionSavedRef.current = true;
      setSavedHistories((current) => [
        {
          id: `his-${Date.now()}`,
          title: filesRef.current.docx?.name || filesRef.current.pdf?.name || '负面清单审查',
          submittedAt: startedAt || formatDateTime(new Date()),
          status: 'complete',
          progress: 100,
          duration: '已生成报告',
          files: filesRef.current,
          summary: nextSummary,
          rows: nextRows,
          reportUrl: downloadUrl || reportDownloadUrl,
        },
        ...current,
      ].slice(0, 8));
    }
  }, [activeReportRows, activeReportSummary, reportDownloadUrl, startedAt]);

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

    const reportFileUrl = extractReportFileUrl(payload);
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
      updateNodeStatus('start_cc7f3', 'done');
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
      completionSavedRef.current = false;
      streamTextRef.current = '';
      setApiError('');
      setStreamText('');
      setActiveReportSummary('');
      setActiveReportRows([]);
      setReportDownloadUrl('');
      setNodeStatusMap({ start_cc7f3: 'running' });
      setRunState('uploading');
      setProgress(3);
      setStartedAt(formatDateTime(new Date()));
      setSelectedHistoryId('current');
      setSelectedReportNo(null);
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
    setSelectedHistoryId('current');
    setSelectedReportNo(null);
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
    setSelectedHistoryId('current');
    setSelectedReportNo(null);
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
      title: '当前负面清单审查',
      submittedAt: startedAt || '-',
      status: currentStatus,
      progress,
      duration: runState === 'complete' ? '已生成报告' : apiStage,
      files,
      summary: runState === 'complete' ? activeReportSummary : '',
      rows: runState === 'complete' ? activeReportRows : [],
      reportUrl: reportDownloadUrl,
    }),
    [activeReportRows, activeReportSummary, apiStage, files, progress, reportDownloadUrl, runState, startedAt],
  );

  const histories = useMemo(() => [currentHistory, ...savedHistories], [currentHistory, savedHistories]);
  const selectedHistory = histories.find((item) => item.id === selectedHistoryId) || currentHistory;
  const canStart = Boolean(files.pdf?.raw && files.docx?.raw);
  const isBusy = runState === 'uploading' || runState === 'running' || runState === 'streaming';
  const selectedIsComplete = selectedHistory.status === 'complete';
  const selectedIsStreaming = selectedHistory.id === 'current' && (selectedHistory.status === 'streaming' || Boolean(streamText));
  const selectedReportRow = useMemo(() => {
    const negativeRows = selectedHistory.rows.filter((row) => row.hasNegative === '有');
    return negativeRows.find((row) => row.no === selectedReportNo) || negativeRows[0] || null;
  }, [selectedHistory.rows, selectedReportNo]);
  const nodeRows = workflowNodes.map((node) => ({
    ...node,
    status: selectedHistory.id === 'current' ? nodeStatusMap[node.id] || 'waiting' as NodeStatus : 'done' as NodeStatus,
  }));
  const doneCount = nodeRows.filter((node) => node.status === 'done').length;
  const runningCount = nodeRows.filter((node) => node.status === 'running').length;
  const waitingCount = nodeRows.filter((node) => node.status === 'waiting').length;
  const errorCount = nodeRows.filter((node) => node.status === 'error').length;

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
            <div className="nlr-historyList">
              {histories.map((item) => (
                <button
                  key={item.id}
                  className={`nlr-historyItem ${selectedHistory.id === item.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setSelectedHistoryId(item.id);
                    setSelectedReportNo(item.rows.find((row) => row.hasNegative === '有')?.no || null);
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
                      <span>负面清单名称</span>
                      <span>有无负面清单</span>
                      <span>情况说明</span>
                    </div>
                    {selectedHistory.rows.map((row) => {
                      const actionable = row.hasNegative === '有';
                      const selected = selectedReportRow?.no === row.no;
                      return (
                        <div
                          className={[
                            'nlr-reportRow',
                            actionable ? 'has-negative is-actionable' : 'no-negative',
                            selected ? 'is-selected' : '',
                          ].join(' ')}
                          key={row.no}
                          onClick={() => actionable && setSelectedReportNo(row.no)}
                          onKeyDown={(event) => {
                            if (actionable && (event.key === 'Enter' || event.key === ' ')) {
                              event.preventDefault();
                              setSelectedReportNo(row.no);
                            }
                          }}
                          role={actionable ? 'button' : undefined}
                          tabIndex={actionable ? 0 : undefined}
                        >
                          <span>{row.no}</span>
                          <strong>{row.name}</strong>
                          <b>{row.hasNegative}</b>
                          <div className="nlr-reportAction">{actionable ? '点击查看' : '无'}</div>
                        </div>
                      );
                    })}
                  </div>
                  <aside className="nlr-reportDetailPanel">
                    <span>情况说明</span>
                    {selectedReportRow ? (
                      <>
                        <h3>{selectedReportRow.no}. {selectedReportRow.name}</h3>
                        <div className="nlr-detailContent">{renderDetail(selectedReportRow.detail)}</div>
                      </>
                    ) : (
                      <div className="nlr-detailEmpty">该报告未发现负面清单问题。</div>
                    )}
                  </aside>
                </div>
              ) : (
                <pre className="nlr-rawReport">{streamText || '未解析到报告表格。'}</pre>
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
                  <pre>{streamText || '等待大模型开始输出...'}</pre>
                </section>
              )}
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
              </section>
            </>
          )}
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
