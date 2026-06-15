import { useEffect, useState } from 'react';
import { ArrowUpRight, DatabaseZap, FileInput, Gauge, TimerReset, Waypoints } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatDate, formatDuration, formatNumber, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';

interface Run {
  id: string; name: string; sessionTitle?: string; status: string; model?: string; promptVersion?: string;
  skillVersions?: string[]; toolSchemaVersion?: string;
  latencyMs?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number; score?: number;
  toolCallCount: number; artifactCount: number; startedAt: string;
}
interface Dashboard { runs: number; successRate: number; avgLatencyMs: number; totalTokens: number; recent: Run[] }

export function RunsPage() {
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const load = async () => {
    const query = status ? `?status=${status}` : '';
    const [summary, items] = await Promise.all([api<Dashboard>('/api/dashboard'), api<Run[]>(`/api/runs${query}`)]);
    setDashboard(summary); setRuns(items);
  };
  useEffect(() => { void load(); }, [status]);
  const submitImport = async () => {
    const result = await post<{ importedEvents: number }>('/api/runs/import-jsonl', { content });
    setMessage(`已导入 ${result.importedEvents} 个事件`); setShowImport(false); setContent(''); await load();
  };
  if (!dashboard) return <Loading />;
  return <section>
    <PageHeader eyebrow="01 / OBSERVE" title="Runs Registry" description="所有 Agent 执行记录、性能信号和版本绑定的统一入口。"
      actions={<button className="primary" onClick={() => setShowImport(true)}><FileInput size={16} />导入 Trace JSONL</button>} />
    {message && <div className="notice">{message}</div>}
    <div className="metric-grid">
      <Metric label="RUNS CAPTURED" value={formatNumber(dashboard.runs)} tone="cyan" />
      <Metric label="SUCCESS RATE" value={`${(dashboard.successRate * 100).toFixed(1)}%`} tone="green" />
      <Metric label="AVG LATENCY" value={formatDuration(dashboard.avgLatencyMs)} tone="amber" />
      <Metric label="TOKENS OBSERVED" value={formatNumber(dashboard.totalTokens)} />
    </div>
    <div className="section-bar">
      <div><Waypoints size={16} /><strong>Execution Log</strong><span>{runs.length} records</span></div>
      <select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option><option value="success">success</option><option value="failed">failed</option><option value="running">running</option>
      </select>
    </div>
    {runs.length === 0 ? <Empty>还没有 Run。导入设计文档中的 trace.jsonl 开始观察。</Empty> :
      <div className="table-wrap"><table>
        <thead><tr><th>Run / Session</th><th>Binding</th><th>Status</th><th>Latency</th><th>Tokens</th><th>Tools</th><th>Score</th><th /></tr></thead>
        <tbody>{runs.map((run) => <tr key={run.id}>
          <td><div className="run-name"><strong>{run.name}</strong><span>{run.sessionTitle ?? run.id} · {formatDate(run.startedAt)}</span></div></td>
          <td><div className="binding"><span>{run.model ?? 'unbound'}</span><b>{run.promptVersion ?? 'no prompt'}</b><em>{run.skillVersions?.join(', ') || run.toolSchemaVersion || 'no skill binding'}</em></div></td>
          <td><StatusBadge status={run.status} /></td>
          <td><span className="data-cell"><TimerReset size={13} />{formatDuration(run.latencyMs)}</span></td>
          <td><span className="data-cell"><Gauge size={13} />{formatNumber(run.totalTokens)}</span></td>
          <td><span className="data-cell"><DatabaseZap size={13} />{run.toolCallCount} / {run.artifactCount}</span></td>
          <td><strong className="score">{run.score ?? '—'}</strong></td>
          <td><Link className="icon-link" to={`/runs/${run.id}`}><ArrowUpRight size={16} /></Link></td>
        </tr>)}</tbody>
      </table></div>}
    {showImport && <div className="modal-backdrop" onClick={() => setShowImport(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <span className="eyebrow">TRACE COLLECTOR</span><h2>导入 JSONL</h2>
        <p>每行一个 Trace Event。所有原始事件会完整保留，便于后续调试。</p>
        <textarea rows={14} value={content} onChange={(event) => setContent(event.target.value)} placeholder='{"eventId":"...","eventType":"run.start",...}' />
        <div className="modal-actions"><button onClick={() => setShowImport(false)}>取消</button><button className="primary" disabled={!content.trim()} onClick={() => void submitImport()}>导入事件</button></div>
      </div>
    </div>}
  </section>;
}
