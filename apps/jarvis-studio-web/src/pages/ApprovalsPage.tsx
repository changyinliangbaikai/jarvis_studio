import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, LockKeyhole, ShieldAlert, X } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate } from '../utils/format.ts';

interface Approval {
  id: string;
  workspaceId: string;
  taskId?: string;
  runId?: string;
  toolCallId?: string;
  riskLevel?: string;
  actionType?: string;
  requestedAction?: string;
  reason?: string;
  args?: unknown;
  status: string;
  approvedBy?: string;
  decisionNote?: string;
  createdAt?: string;
  decidedAt?: string;
}

export function ApprovalsPage() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback((signal: AbortSignal) => api<Approval[]>('/api/approvals', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['approvals'] });
  const items = resource.data;
  const selected = useMemo(() => items?.find((item) => item.id === selectedId) ?? items?.[0], [items, selectedId]);
  useEffect(() => {
    if (items) setSelectedId((current) => current || items[0]?.id || '');
  }, [items]);
  const decide = async (decision: 'approve' | 'reject' | 'approve-with-changes') => {
    if (!selected) return;
    await post(`/api/approvals/${selected.id}/${decision}`, { note, approvedBy: 'local-user' });
    setNote('');
    await resource.reload();
  };
  if (!items) return <Loading />;
  return <section>
    <PageHeader eyebrow="V0.5 / Runtime Approval" title={t('pages.approvals.string_1')} description={t('pages.approvals.string_2')} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="metric-grid compact">
      <Metric label="PENDING RUNTIME APPROVALS" value={items.filter((item) => item.status === 'pending').length} tone="amber" />
      <Metric label="DENIED CALLS" value={items.filter((item) => item.status === 'rejected').length} tone="red" />
      <Metric label="SUCCESS RATE" value={`${items.length ? (items.filter((item) => item.status.startsWith('approved')).length / items.length * 100).toFixed(0) : 0}%`} tone="green" />
      <Metric label="TOOL CALLS" value={items.length} />
      <Metric label="STATUS" value="approval-v0.5" />
    </div>
    {items.length === 0 ? <Empty>{t('pages.approvals.string_4')}</Empty> : <div className="approval-layout">
      <div className="panel registry-list">
        <div className="panel-title"><LockKeyhole size={15} />{t('pages.approvals.string_5')}<span>{items.length}</span></div>
        {items.map((item) => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
          <StatusBadge status={item.status} />
          <div><strong>{item.requestedAction ?? item.actionType ?? 'tool_call'}</strong><span>{item.riskLevel ?? 'unknown'} · {formatDate(item.createdAt)}</span><p>{item.reason}</p></div>
          <aside><b>{item.runId?.slice(0, 12) ?? item.workspaceId}</b><span>{item.taskId ?? 'no task'}</span></aside>
        </button>)}
      </div>
      {selected && <div className="panel approval-detail">
        <div className="registry-hero inline">
          <div className="registry-orbit"><ShieldAlert size={25} /></div>
          <div><span className="eyebrow">{selected.riskLevel ?? 'risk'} / {selected.status}</span><h2>{selected.requestedAction ?? selected.actionType}</h2><p>{selected.reason}</p></div>
          <StatusBadge status={selected.status} />
        </div>
        <div className="provider-actions">
          <button className="primary" disabled={selected.status !== 'pending'} onClick={() => void decide('approve')}><Check size={14} />{t('pages.approvals.string_6')}</button>
          <button disabled={selected.status !== 'pending'} onClick={() => void decide('approve-with-changes')}>{t('pages.approvals.string_7')}</button>
          <button className="danger" disabled={selected.status !== 'pending'} onClick={() => void decide('reject')}><X size={14} />{t('pages.approvals.string_8')}</button>
        </div>
        <textarea rows={3} placeholder={t('pages.approvals.string_3')} value={note} onChange={(event) => setNote(event.target.value)} />
        <div className="registry-facts">
          <span>Eval Workspace<b>{selected.workspaceId}</b></span>
          <span>Test Task<b>{selected.taskId ?? '—'}</b></span>
          <span>Run<b>{selected.runId ?? '—'}</b></span>
          <span>Tool Call<b>{selected.toolCallId ?? '—'}</b></span>
        </div>
        <h3>{t('pages.approvals.string_9')}</h3>
        <JsonView value={{ args: selected.args, decisionNote: selected.decisionNote, approvedBy: selected.approvedBy, decidedAt: selected.decidedAt }} />
      </div>}
    </div>}
  </section>;
}
