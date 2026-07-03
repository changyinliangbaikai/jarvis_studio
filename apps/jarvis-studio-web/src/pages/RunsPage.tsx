import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, ClipboardList, DatabaseZap, FileInput, Gauge, RotateCw, Search, TimerReset, Trash2, Waypoints } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate, formatDuration, formatNumber } from '../utils/format.ts';

interface Agent { id: string; name: string }
interface Run {
  id: string;
  name: string;
  agentId?: string;
  agentName?: string;
  source?: string;
  status: string;
  model?: string;
  modelProvider?: string;
  promptVersion?: string;
  promptVersionId?: string;
  userInput?: string;
  finalOutput?: string;
  latencyMs?: number;
  totalTokens?: number;
  toolCallCount: number;
  artifactCount: number;
  startedAt: string;
  sessionId?: string;
}
interface Dashboard { runs: number; successRate: number; avgLatencyMs: number; totalTokens: number; recent: Run[] }

export function RunsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [agentId, setAgentId] = useState(searchParams.get('agentId') ?? '');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sessionId, setSessionId] = useState(searchParams.get('sessionId') ?? '');
  const [showImport, setShowImport] = useState(false);
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    const query = new URLSearchParams();
    if (agentId) query.set('agentId', agentId);
    if (status) query.set('status', status);
    if (source) query.set('source', source);
    if (keyword) query.set('keyword', keyword);
    if (sessionId) query.set('sessionId', sessionId);
    const [dashboard, runs, agents] = await Promise.all([
      api<Dashboard>('/api/dashboard', { signal }),
      api<Run[]>(`/api/runs${query.size ? `?${query}` : ''}`, { signal }),
      api<Agent[]>('/api/agents', { signal })
    ]);
    return { dashboard, runs, agents };
  }, [agentId, status, source, keyword, sessionId]);
  const resource = useAsyncResource(load, [agentId, status, source, keyword, sessionId], true, { queryKey: ['runs-page-v06', agentId, status, source, keyword, sessionId] });
  const dashboard = resource.data?.dashboard;
  const runs = resource.data?.runs ?? [];
  const agents = resource.data?.agents ?? [];
  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === agentId), [agents, agentId]);
  const submitImport = async () => {
    const result = await post<{ importedEvents: number }>('/api/runs/import-jsonl', { content });
    setMessage(t('pages.runs.string_19'));
    setShowImport(false);
    setContent('');
    await resource.reload();
  };
  const handleClear = useCallback(async () => {
    if (window.confirm('您确定要清空所有运行日志吗？该操作不可逆，但不会影响您的智能体或评测用例配置。')) {
      try {
        await post('/api/runs/clear', {});
        setMessage('运行日志清空成功');
        await resource.reload();
      } catch (err) {
        setMessage('清空日志失败: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
  }, [resource]);
  const convert = async (run: Run) => {
    const item = await post<{ id: string }>(`/api/runs/${run.id}/convert-to-case`, {
      name: `Case · ${(run.userInput || run.name).slice(0, 24)}`,
      expectedOutput: run.finalOutput,
      assertionType: 'manual',
      priority: 'P1',
      tags: ['from-run']
    });
    setMessage(t('pages.runs.string_20'));
  };

  if (!dashboard) return <Loading />;
  return <section>
    <PageHeader
      eyebrow="04 / Runs"
      title={t('pages.runs.string_1')}
      description={t('pages.runs.string_2')}
      actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="secondary" onClick={() => void handleClear()}><Trash2 size={16} />清空日志</button>
          <button className="primary" onClick={() => setShowImport(true)}><FileInput size={16} />{t('pages.runs.string_5')}</button>
        </div>
      }
    />
    {message && <div className="notice">{message}</div>}
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="metric-grid">
      <Metric label="RUNS CAPTURED" value={formatNumber(dashboard.runs)} tone="cyan" />
      <Metric label="SUCCESS RATE" value={`${(dashboard.successRate * 100).toFixed(1)}%`} tone="green" />
      <Metric label="AVG LATENCY" value={formatDuration(dashboard.avgLatencyMs)} tone="amber" />
      <Metric label="TOKENS OBSERVED" value={formatNumber(dashboard.totalTokens)} />
    </div>
    <div className="section-bar">
      <div><Waypoints size={16} /><strong>{t('pages.runs.string_6')}</strong><span>{selectedAgent?.name ?? t('pages.runs.string_21')} · {runs.length} 条记录</span></div>
      <div className="filter-row">
        <select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">{t('pages.runs.string_7')}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t('pages.runs.string_8')}</option><option value="success">{t('common.success')}</option><option value="failed">{t('common.failed')}</option><option value="running">{t('common.running')}</option></select>
        <select value={source} onChange={(event) => setSource(event.target.value)}><option value="">{t('pages.runs.string_9')}</option><option value="playground">Playground</option><option value="case">Case</option><option value="eval">Eval</option><option value="runtime">Runtime</option><option value="replay">Replay</option></select>
        <input className="input-field" type="text" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="会话 ID (Session ID)" />
        <label className="search-box"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('pages.runs.string_3')} /></label>
        <button className="icon-link" onClick={() => void resource.reload()} title="刷新运行记录"><RotateCw size={16} /></button>
      </div>
    </div>
    {runs.length === 0 ? <Empty>{t('pages.runs.string_10')}</Empty> :
      <div className="table-wrap"><table>
        <thead><tr><th>{t('pages.runs.string_11')}</th><th>{t('pages.runs.string_12')}</th><th>{t('pages.runs.string_13')}</th><th>{t('common.status')}</th><th>Prompt / Model</th><th>{t('pages.runs.string_14')}</th><th>Token</th><th>{t('pages.runs.string_15')}</th><th>{t('common.actions')}</th></tr></thead>
        <tbody>{runs.map((run) => <tr key={run.id}>
          <td>
            <div className="run-name">
              <strong>{formatDate(run.startedAt)}</strong>
              <span>{run.agentName ?? run.agentId ?? run.source ?? run.id}</span>
              {run.sessionId && (
                <span
                  onClick={() => setSessionId(run.sessionId!)}
                  title="点击筛选当前会话的所有运行记录"
                  style={{
                    cursor: 'pointer',
                    fontSize: '10px',
                    color: 'var(--cyan)',
                    textDecoration: 'underline',
                    marginTop: '2px',
                    display: 'block'
                  }}
                >
                  Session: {run.sessionId.slice(0, 8)}...
                </span>
              )}
            </div>
          </td>
          <td>{run.userInput?.slice(0, 80) || run.name}</td>
          <td>{run.finalOutput?.slice(0, 80) || '-'}</td>
          <td><StatusBadge status={run.status} /></td>
          <td><div className="binding"><span>{run.modelProvider ? `${run.modelProvider} / ${run.model}` : run.model ?? t('pages.runs.string_22')}</span><b>{run.promptVersion ?? run.promptVersionId ?? t('pages.runs.string_23')}</b></div></td>
          <td><span className="data-cell"><TimerReset size={13} />{formatDuration(run.latencyMs)}</span></td>
          <td><span className="data-cell"><Gauge size={13} />{formatNumber(run.totalTokens)}</span></td>
          <td><span className="data-cell"><DatabaseZap size={13} />{run.toolCallCount} / {run.artifactCount}</span></td>
          <td><div className="page-actions"><Link className="icon-link" to={`/runs/${run.id}`} title="查看执行 Trace 详情"><ArrowUpRight size={16} /></Link><button className="icon-link" onClick={() => void convert(run)} title={t('pages.runs.string_4')}><ClipboardList size={16} /></button></div></td>
        </tr>)}</tbody>
      </table></div>}
    {showImport && <div className="modal-backdrop" onClick={() => setShowImport(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <span className="eyebrow">Trace Collector</span><h2>{t('pages.runs.string_16')}</h2>
        <p>{t('pages.runs.string_17')}</p>
        <textarea rows={14} value={content} onChange={(event) => setContent(event.target.value)} placeholder='{"eventId":"...","eventType":"run.start",...}' />
        <div className="modal-actions"><button onClick={() => setShowImport(false)}>{t('common.cancel')}</button><button className="primary" disabled={!content.trim()} onClick={() => void submitImport()}><Activity size={14} />{t('pages.runs.string_18')}</button></div>
      </div>
    </div>}
  </section>;
}
