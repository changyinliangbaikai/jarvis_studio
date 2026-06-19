import { useCallback, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { ArrowUpRight, DatabaseZap, FileInput, Gauge, TimerReset, Waypoints } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { formatDate, formatDuration, formatNumber } from '../utils/format.ts';

interface Run {
  id: string; name: string; sessionTitle?: string; status: string; model?: string; promptVersion?: string;
  skillVersions?: string[]; toolSchemaVersion?: string;
  latencyMs?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number; score?: number;
  toolCallCount: number; artifactCount: number; startedAt: string;
}
interface Dashboard { runs: number; successRate: number; avgLatencyMs: number; totalTokens: number; recent: Run[] }

export function RunsPage() {
  const [status, setStatus] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const debouncedStatus = useDebouncedValue(status);
  const load = useCallback(async (signal: AbortSignal) => {
    const query = debouncedStatus ? `?status=${debouncedStatus}` : '';
    const [dashboard, runs] = await Promise.all([api<Dashboard>('/api/dashboard', { signal }), api<Run[]>(`/api/runs${query}`, { signal })]);
    return { dashboard, runs };
  }, [debouncedStatus]);
  const resource = useAsyncResource(load, [debouncedStatus], true, { queryKey: ['runs-page', debouncedStatus] });
  const submitImport = async () => {
    const result = await post<{ importedEvents: number }>('/api/runs/import-jsonl', { content });
    setMessage(`已导入 ${result.importedEvents} 个事件`); setShowImport(false); setContent(''); await resource.reload();
  };
  const dashboard = resource.data?.dashboard;
  const runs = resource.data?.runs ?? [];
  if (!dashboard) return <Loading />;
  return <section>
    <PageHeader eyebrow="01 / 运行观测 (Observe)" title="运行记录 (Runs Registry)" description="所有 Agent 执行记录、性能信号和版本绑定的统一入口。"
      actions={<button className="primary" onClick={() => setShowImport(true)}><FileInput size={16} />导入 Trace JSONL</button>} />
    {message && <div className="notice">{message}</div>}
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="metric-grid">
      <Metric label="RUNS CAPTURED" value={formatNumber(dashboard.runs)} tone="cyan" />
      <Metric label="SUCCESS RATE" value={`${(dashboard.successRate * 100).toFixed(1)}%`} tone="green" />
      <Metric label="AVG LATENCY" value={formatDuration(dashboard.avgLatencyMs)} tone="amber" />
      <Metric label="TOKENS OBSERVED" value={formatNumber(dashboard.totalTokens)} />
    </div>
    <div className="section-bar">
      <div><Waypoints size={16} /><strong>执行日志</strong><span>{runs.length} 条记录</span></div>
      <ThemedSelect value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option><option value="success">成功</option><option value="failed">失败</option><option value="running">运行中</option>
      </ThemedSelect>
    </div>
    {runs.length === 0 ? <Empty>还没有 Run。导入设计文档中的 trace.jsonl 开始观察。</Empty> :
      <div className="table-wrap"><table>
        <thead><tr><th>运行 / 会话</th><th>绑定信息</th><th>状态</th><th>耗时</th><th>Token</th><th>工具 / 产物</th><th>评分</th><th /></tr></thead>
        <tbody>{runs.map((run) => <tr key={run.id}>
          <td><div className="run-name"><strong>{run.name}</strong><span>{run.sessionTitle ?? run.id} · {formatDate(run.startedAt)}</span></div></td>
          <td><div className="binding"><span>{run.model ?? '未绑定模型'}</span><b>{run.promptVersion ?? '无 Prompt'}</b><em>{run.skillVersions?.join(', ') || run.toolSchemaVersion || '无 Skill 绑定'}</em></div></td>
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
        <span className="eyebrow">Trace 采集器 (Trace Collector)</span><h2>导入 JSONL</h2>
        <p>每行一个 Trace Event。所有原始事件会完整保留，便于后续调试。</p>
        <textarea rows={14} value={content} onChange={(event) => setContent(event.target.value)} placeholder='{"eventId":"...","eventType":"run.start",...}' />
        <div className="modal-actions"><button onClick={() => setShowImport(false)}>取消</button><button className="primary" disabled={!content.trim()} onClick={() => void submitImport()}>导入事件</button></div>
      </div>
    </div>}
  </section>;
}
