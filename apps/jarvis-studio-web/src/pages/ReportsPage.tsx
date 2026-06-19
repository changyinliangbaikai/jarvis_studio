import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { Eye, FileDown, FileText, RefreshCcw } from 'lucide-react';
import { api, download, post } from '../api.ts';
import { Empty, Loading, PageHeader } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalRun } from '../evalTypes.ts';
import { formatDate } from '../utils/format.ts';

interface Report { id: string; evalRunId: string; evalRunName: string; datasetId: string; filename: string; generatedAt: string }
interface ReportPreview { evalRunId: string; filename: string; markdown: string; generatedAt: string }

export function ReportsPage() {
  const [selected, setSelected] = useState('');
  const [activeReportId, setActiveReportId] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    const [reports, runItems] = await Promise.all([api<Report[]>('/api/reports/eval', { signal }), api<EvalRun[]>('/api/eval/runs', { signal })]);
    return { reports, runs: runItems.filter((item) => item.status === 'completed') };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['reports-page'] });
  const reports = resource.data?.reports ?? [];
  const runs = resource.data?.runs ?? [];
  const loadPreview = useCallback((signal: AbortSignal) => activeReportId ? api<ReportPreview>(`/api/reports/eval/${activeReportId}`, { signal }) : Promise.resolve(undefined), [activeReportId]);
  const previewResource = useAsyncResource<ReportPreview | undefined>(loadPreview, [activeReportId], Boolean(activeReportId), { queryKey: ['report-preview', activeReportId] });
  const preview = previewResource.data;
  const setPreview = previewResource.setData;
  useEffect(() => {
    const data = resource.data;
    if (!data) return;
    setSelected((current) => current || data.runs[0]?.id || '');
    setActiveReportId((current) => data.reports.some((item) => item.evalRunId === current) ? current : data.reports[0]?.evalRunId || '');
  }, [resource.data]);
  useEffect(() => {
    if (!activeReportId) setPreview(undefined);
  }, [activeReportId, setPreview]);
  const generate = async (evalRunId: string) => {
    await post(`/api/reports/eval/${evalRunId}/generate`, {});
    await resource.reload();
    setActiveReportId(evalRunId);
  };
  const downloadReport = async (evalRunId: string, filename?: string) => {
    await download(`/api/reports/eval/${evalRunId}/download`, filename ?? `${evalRunId}.md`);
  };
  const activeReport = reports.find((item) => item.evalRunId === activeReportId);
  return <section><PageHeader eyebrow="10 / 评测报告 (Eval Reports)" title="证据档案室 (Evidence Archive)" description="生成、预览、下载并沉淀可供开发者 Review 的 Markdown 评测报告。"
    actions={<div className="report-generate"><ThemedSelect value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择评测运行</option>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect><button className="primary" disabled={!selected} onClick={() => void generate(selected)}><FileText size={14} />生成报告</button></div>} />
    {(resource.error || previewResource.error) && <div className="notice warning">{resource.error || previewResource.error}</div>}
    {reports.length ? <div className="report-workspace">
      <div className="report-list">{reports.map((item) => <article className={`panel report-card ${item.evalRunId === activeReportId ? 'active' : ''}`} key={item.id}>
        <button className="report-select" onClick={() => setActiveReportId(item.evalRunId)}><Eye size={14} />预览</button>
        <FileText size={25} /><div><span>{item.datasetId}</span><h2>{item.evalRunName}</h2><code>{item.filename}</code><p>{formatDate(item.generatedAt)}</p></div><aside><button title="重新生成报告" onClick={() => void generate(item.evalRunId)}><RefreshCcw size={13} /></button><button className="primary-link" onClick={() => void downloadReport(item.evalRunId, item.filename)}><FileDown size={13} />下载 Markdown</button></aside>
      </article>)}</div>
      <article className="panel report-preview-panel">
        <div className="panel-title"><FileText size={15} />报告预览 <span>{activeReport?.filename ?? '未选择'}</span></div>
        {previewResource.loading ? <Loading /> : preview ? <><div className="report-preview-head"><span>{activeReport?.datasetId}</span><strong>{activeReport?.evalRunName}</strong><button className="primary-link" onClick={() => void downloadReport(preview.evalRunId, activeReport?.filename)}><FileDown size={13} />下载</button></div><MarkdownPreview markdown={preview.markdown} /></> : <Empty>请选择左侧报告进行预览。</Empty>}
      </article>
    </div> : <Empty>尚未生成 Eval Report。</Empty>}
  </section>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) continue;
    if (line.startsWith('# ')) {
      nodes.push(<h1 key={index}>{formatInline(line.slice(2))}</h1>);
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(<h2 key={index}>{formatInline(line.slice(3))}</h2>);
      continue;
    }
    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (lines[index]?.startsWith('|')) {
        tableLines.push(lines[index]!);
        index += 1;
      }
      index -= 1;
      nodes.push(<MarkdownTable key={index} lines={tableLines} />);
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (lines[index]?.startsWith('- ')) {
        items.push(lines[index]!.slice(2));
        index += 1;
      }
      index -= 1;
      nodes.push(<ul key={index}>{items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{formatInline(item)}</li>)}</ul>);
      continue;
    }
    const paragraph = [line];
    while (lines[index + 1] && !lines[index + 1]!.match(/^(# |## |\||- )/) && lines[index + 1]!.trim()) {
      paragraph.push(lines[index + 1]!);
      index += 1;
    }
    nodes.push(<p key={index}>{formatInline(paragraph.join(' '))}</p>);
  }
  return <div className="markdown-preview">{nodes}</div>;
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines.filter((line) => !/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
  const [head = [], ...body] = rows;
  return <div className="markdown-table-wrap"><table><thead><tr>{head.map((cell, index) => <th key={index}>{formatInline(cell)}</th>)}</tr></thead><tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{formatInline(cell)}</td>)}</tr>)}</tbody></table></div>;
}

function formatInline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <span key={index}>{part}</span>;
  });
}
