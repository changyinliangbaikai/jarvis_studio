import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, Search, Wrench, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate } from '../utils/format.ts';

interface Failure {
  id: string;
  runId: string;
  evalCaseId?: string;
  type: string;
  severity: string;
  summary?: string;
  evidence: unknown[];
  suggestedFix?: string;
  status: 'open' | 'investigating' | 'fixed' | 'ignored';
  skillId?: string;
  toolId?: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  fixLinks?: Array<{ promptVersion?: string; skillVersion?: string; toolVersion?: string; runId?: string; note?: string; linkedAt: string }>;
}

export function FailuresPage() {
  const { t } = useTranslation();
  const { failureId } = useParams();
  const [filters, setFilters] = useState({ type: '', severity: '', skillId: '', toolId: '' });
  const load = useCallback((signal: AbortSignal) => api<Failure[]>('/api/failures', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['failures'] });
  const items = resource.data;
  const filteredItems = useMemo(() => (items ?? []).filter((item) =>
    (!filters.type || item.type === filters.type)
      && (!filters.severity || item.severity === filters.severity)
      && (!filters.skillId || item.skillId === filters.skillId)
      && (!filters.toolId || item.toolId === filters.toolId)
  ), [items, filters]);
  const selected = useMemo(() => items?.find((item) => item.id === failureId) ?? filteredItems[0], [items, filteredItems, failureId]);
  const loadDetail = useCallback((signal: AbortSignal) => selected ? api<Failure>(`/api/failures/${selected.id}`, { signal }) : Promise.resolve(undefined), [selected?.id]);
  const detailResource = useAsyncResource<Failure | undefined>(loadDetail, [selected?.id], Boolean(selected?.id), { queryKey: ['failure-detail', selected?.id] });
  const detail = detailResource.data;
  const setStatus = async (status: Failure['status']) => {
    if (!selected) return;
    await api(`/api/failures/${selected.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await resource.reload();
    await detailResource.reload();
  };
  const linkFix = async () => {
    if (!detail) return;
    await post(`/api/failures/${detail.id}/link-fix`, { runId: detail.runId, note: t('pages.failures.string_21') });
    await resource.reload();
    await detailResource.reload();
  };
  if (!items) return <Loading />;
  const open = filteredItems.filter((item) => item.status === 'open');
  const typeOptions = unique(items.map((item) => item.type));
  const severityOptions = unique(items.map((item) => item.severity));
  const skillOptions = unique(items.map((item) => item.skillId).filter(Boolean) as string[]);
  const toolOptions = unique(items.map((item) => item.toolId).filter(Boolean) as string[]);
  return <section>
    {failureId && <Link className="back-link" to="/failures"><ChevronLeft size={14} />{t('pages.failures.string_3')}</Link>}
    <PageHeader eyebrow="V0.4 / Failure Diagnosis" title={t('pages.failures.string_1')} description={t('pages.failures.string_2')} />
    {(resource.error || detailResource.error) && <div className="notice warning">{resource.error || detailResource.error}</div>}
    <div className="metric-grid compact">
      <Metric label="OPEN FAILURES" value={open.length} tone="red" />
      <Metric label="STATUS" value={`${items.filter((item) => item.status === 'fixed').length} fixed`} tone="green" />
      <Metric label="DENIED CALLS" value={items.filter((item) => item.type === 'permission_denied').length} tone="amber" />
      <Metric label="TOOL CALLS" value={items.filter((item) => item.type.includes('tool')).length} />
      <Metric label="RUN" value={new Set(items.map((item) => item.runId)).size} />
    </div>
    <div className="filter-strip panel">
      <Search size={14} /><span className="flow-label">{t('pages.failures.string_4')}</span>
      <ThemedSelect value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">{t('pages.failures.string_5')}</option>{typeOptions.map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect>
      <ThemedSelect value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}><option value="">{t('pages.failures.string_6')}</option>{severityOptions.map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect>
      <ThemedSelect value={filters.skillId} onChange={(event) => setFilters({ ...filters, skillId: event.target.value })}><option value="">{t('pages.failures.string_7')}</option>{skillOptions.map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect>
      <ThemedSelect value={filters.toolId} onChange={(event) => setFilters({ ...filters, toolId: event.target.value })}><option value="">{t('pages.failures.string_8')}</option>{toolOptions.map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect>
      <span>{filteredItems.length} / {items.length} records</span>
    </div>
    {items.length === 0 ? <Empty>{t('pages.failures.string_9')}</Empty> : filteredItems.length === 0 ? <Empty>{t('pages.failures.string_10')}</Empty> : <div className="registry-layout">
      <div className="panel registry-list">
        <div className="panel-title"><AlertTriangle size={15} />{t('pages.failures.string_11')}<span>{filteredItems.length}</span></div>
        {filteredItems.map((item) => <Link key={item.id} to={`/failures/${item.id}`} className={selected?.id === item.id ? 'active' : ''}>
          <StatusBadge status={item.severity} />
          <div><strong>{item.type}</strong><span>{item.status} · {formatDate(item.lastSeenAt)}</span><p>{item.summary}</p></div>
          <aside><b>{item.occurrenceCount}x</b><span>{item.skillId ?? item.toolId ?? item.evalCaseId ?? 'runtime'}</span></aside>
        </Link>)}
      </div>
      {!detail ? <Loading /> : <div className="registry-detail">
        <div className="panel registry-hero">
          <div className="registry-orbit"><Search size={25} /></div>
          <div><span className="eyebrow">{detail.severity} / {detail.status}</span><h2>{detail.type}</h2><p>{detail.summary}</p></div>
          <StatusBadge status={detail.status} />
        </div>
        <div className="provider-actions">
          <button onClick={() => void setStatus('investigating')}><Search size={14} />{t('pages.failures.string_12')}</button>
          <button onClick={() => void linkFix()}><Wrench size={14} />{t('pages.failures.string_13')}</button>
          <button className="primary" onClick={() => void setStatus('fixed')}><CheckCircle2 size={14} />{t('pages.failures.string_14')}</button>
          <button className="danger" onClick={() => void setStatus('ignored')}><XCircle size={14} />{t('pages.failures.string_15')}</button>
        </div>
        <div className="registry-facts">
          <span>Run<b>{detail.runId}</b></span>
          <span>Eval Case<b>{detail.evalCaseId ?? '—'}</b></span>
          <span>Skill<b>{detail.skillId ?? '—'}</b></span>
          <span>Tool<b>{detail.toolId ?? '—'}</b></span>
          <span>{t('pages.failures.string_16')}<b>{formatDate(detail.firstSeenAt)}</b></span>
          <span>{t('pages.failures.string_17')}<b>{formatDate(detail.lastSeenAt)}</b></span>
        </div>
        <div className="governance-columns">
          <article className="panel"><div className="panel-title"><AlertTriangle size={15} />{t('pages.failures.string_18')}</div><JsonView value={detail.evidence} /></article>
          <article className="panel"><div className="panel-title"><Wrench size={15} />{t('pages.failures.string_19')}</div><div className="diagnosis-note">{detail.suggestedFix ?? t('pages.failures.string_22')}</div></article>
        </div>
        {!!detail.fixLinks?.length && <article className="panel"><div className="panel-title"><Wrench size={15} />{t('pages.failures.string_20')}</div>
          {detail.fixLinks.map((link, index) => <div className="ledger-row" key={`${link.linkedAt}-${index}`}><strong>{link.runId ?? link.skillVersion ?? link.toolVersion ?? link.promptVersion}</strong><span>{link.note ?? 'manual link'}</span><em>{formatDate(link.linkedAt)}</em></div>)}
        </article>}
      </div>}
    </div>}
  </section>;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}
