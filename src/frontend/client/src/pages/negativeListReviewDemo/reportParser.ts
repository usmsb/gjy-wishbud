import * as mammoth from 'mammoth';

export type NegativeFlag = '有' | '无';

export type ReportRow = {
  no: number;
  name: string;
  hasNegative: NegativeFlag;
  detail: string;
};

export type ParsedReport = {
  summary: string;
  rows: ReportRow[];
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeFileUrl(url: string) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url.replace(/https?:\/\/[^/]+/, __APP_ENV__.BASE_URL);
  if (url.startsWith('/api/')) return `${__APP_ENV__.BASE_URL}${url}`;
  if (url.startsWith('files/') || url.startsWith('outputs/')) return `${__APP_ENV__.BASE_URL}/api/${url}`;
  return url;
}

export function parseReportHtml(html: string): ParsedReport {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs = Array.from(doc.querySelectorAll('p'))
    .map((item) => normalizeText(item.textContent || ''))
    .filter(Boolean);
  const summary = paragraphs.find((item) => item.includes('本次检查') && item.includes('负面清单')) || paragraphs[0] || '';

  const table = Array.from(doc.querySelectorAll('table')).find((item) => item.querySelectorAll('tr').length > 1);
  const rows: ReportRow[] = [];

  table?.querySelectorAll('tr').forEach((tr, index) => {
    if (index === 0) return;
    const cells = Array.from(tr.querySelectorAll('td,th')).map((cell) => normalizeText(cell.textContent || ''));
    const [noText, name, hasNegative, detail] = cells;
    const no = Number(noText);
    if (!no || !name) return;
    rows.push({
      no,
      name,
      hasNegative: hasNegative === '有' ? '有' : '无',
      detail: detail || '',
    });
  });

  return { summary, rows };
}

export async function parseReportDocx(reportUrl: string): Promise<ParsedReport> {
  const response = await fetch(normalizeFileUrl(reportUrl));
  if (!response.ok) throw new Error(`报告文件下载失败：${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return parseReportHtml(result.value);
}

export function parseReportText(text: string): ParsedReport {
  const lines = text.split(/\r?\n/).map(normalizeText).filter(Boolean);
  const summary = lines.find((line) => line.includes('本次检查') && line.includes('负面清单')) || '';
  return { summary, rows: [] };
}

function collectFiles(value: any, result: any[] = []) {
  if (!value) return result;
  if (Array.isArray(value)) {
    value.forEach((item) => collectFiles(item, result));
    return result;
  }
  if (typeof value !== 'object') return result;

  if (value.file_url || value.file_path || value.path || value.url) {
    result.push(value);
  }

  ['files', 'file_list', 'final_files', 'all_from_session_files'].forEach((key) => {
    if (value[key]) collectFiles(value[key], result);
  });

  if (value.output_result) collectFiles(value.output_result, result);
  if (value.message) collectFiles(value.message, result);
  return result;
}

export function extractDocxReportUrl(data: any) {
  const files = collectFiles(data);
  const docxFile = files.find((file) => {
    const name = file.file_name || file.name || file.filename || file.original_filename || file.file_url || file.file_path || file.path || file.url || '';
    return String(name).toLowerCase().includes('.docx');
  });
  if (!docxFile) return '';
  return docxFile.file_url || docxFile.file_path || docxFile.path || docxFile.url || '';
}

export function extractMessageText(data: any) {
  const message = data?.message;
  if (typeof message === 'string') return message;
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.output === 'string') return message.output;
  if (typeof data?.content === 'string') return data.content;
  return '';
}
