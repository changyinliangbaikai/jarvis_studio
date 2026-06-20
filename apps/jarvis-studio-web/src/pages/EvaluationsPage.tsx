import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Beaker, ExternalLink } from 'lucide-react';
import { api } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface EvalRun {
  id: string;
  name?: string;
  datasetName?: string;
  status: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  avgScore: number;
  promptVersion?: string;
  createdAt: string;
}

export function EvaluationsPage() {
  const load = useCallback((signal: AbortSignal) => api<EvalRun[]>('/api/eval/runs', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['eval-runs-light'] });
  const runs = resource.data;
  if (!runs) return <Loading />;
  const latest = runs[0];
  return <section>
    <PageHeader eyebrow="06 / Evaluations" title="轻量评测" description="v0.6 将评测收敛为 Case 集合的回归结果视图。复杂能力保留在 Settings / Advanced。" actions={<Link className="primary-link" to="/evals/advanced"><Beaker size={14} />高级评测</Link>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="metric-grid compact"><Metric label="EVAL RUNS" value={runs.length} tone="cyan" /><Metric label="LATEST PASS RATE" value={latest ? `${Math.round(latest.passRate * 100)}%` : '-'} tone="green" /><Metric label="AVG SCORE" value={latest?.avgScore?.toFixed?.(2) ?? '-'} tone="amber" /><Metric label="PROMPT" value={latest?.promptVersion ?? '-'} /><Metric label="VERSIONED CASES" value={latest?.totalCases ?? 0} /></div>
    {runs.length === 0 ? <Empty>还没有评测运行。可以先沉淀 Case，再在高级评测中批量运行。</Empty> : <div className="table-wrap"><table><thead><tr><th>评测运行</th><th>状态</th><th>通过率</th><th>用例</th><th>Prompt</th><th>操作</th></tr></thead><tbody>{runs.map((item) => <tr key={item.id}>
      <td className="run-name"><strong>{item.name || item.datasetName || item.id}</strong><span>{item.createdAt?.slice(0, 19)}</span></td>
      <td><StatusBadge status={item.status} /></td>
      <td className="score">{Math.round(item.passRate * 100)}%</td>
      <td>{item.passedCases}/{item.totalCases} 通过 · {item.failedCases} 失败</td>
      <td>{item.promptVersion || '-'}</td>
      <td><Link className="icon-link" to={`/evals/runs/${item.id}`}><ExternalLink size={14} /></Link></td>
    </tr>)}</tbody></table></div>}
  </section>;
}
