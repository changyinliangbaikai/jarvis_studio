import { useEffect, useState } from 'react';
import { FileDown, FileText, RefreshCcw } from 'lucide-react';
import { api, formatDate, post } from '../api.ts';
import { Empty, PageHeader } from '../components/Primitives.tsx';
import type { EvalRun } from '../evalTypes.ts';

interface Report { id: string; evalRunId: string; evalRunName: string; datasetId: string; filename: string; generatedAt: string }
export function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selected, setSelected] = useState('');
  const load = async () => { const [a, b] = await Promise.all([api<Report[]>('/api/reports/eval'), api<EvalRun[]>('/api/eval/runs')]); setReports(a); setRuns(b.filter((item) => item.status === 'completed')); setSelected((current) => current || b.find((item) => item.status === 'completed')?.id || ''); };
  useEffect(() => { void load(); }, []);
  return <section><PageHeader eyebrow="10 / EVAL REPORTS" title="Evidence Archive" description="生成、下载并沉淀可供开发者 Review 的 Markdown 评测报告。" actions={<div className="report-generate"><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择 Eval Run</option>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="primary" disabled={!selected} onClick={() => void post(`/api/reports/eval/${selected}/generate`, {}).then(load)}><FileText size={14} />生成报告</button></div>} />
    {reports.length ? <div className="report-grid">{reports.map((item) => <article className="panel report-card" key={item.id}><FileText size={25} /><div><span>{item.datasetId}</span><h2>{item.evalRunName}</h2><code>{item.filename}</code><p>{formatDate(item.generatedAt)}</p></div><aside><button onClick={() => void post(`/api/reports/eval/${item.evalRunId}/generate`, {}).then(load)}><RefreshCcw size={13} /></button><a className="primary-link" href={`/api/reports/eval/${item.evalRunId}/download`}><FileDown size={13} />下载 Markdown</a></aside></article>)}</div> : <Empty>尚未生成 Eval Report。</Empty>}
  </section>;
}
