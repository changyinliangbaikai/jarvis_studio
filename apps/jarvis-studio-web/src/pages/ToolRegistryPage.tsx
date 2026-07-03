import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { AlertTriangle, Boxes, Check, FileJson, Power, ShieldCheck, Wrench } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { useEntityList } from '../hooks/useEntityList.ts';
import type { LooseJsonObject } from '../types/json.ts';
import { toolRegistryItemSchema } from '../types/schemas.ts';
import { formatDisplayValue, formatDuration, formatNumber } from '../utils/format.ts';

interface ToolRegistryItem {
  id: string;
  name: string;
  version: string;
  category?: string;
  riskLevel: string;
  defaultPolicy: string;
  enabled: boolean;
  manifest: LooseJsonObject;
  callCount: number;
  successRate: number;
  avgLatencyMs: number;
  avgOutputTokens: number;
  errorRate: number;
  calls?: Array<{ id: string; runId: string; success: boolean; latencyMs?: number; createdAt: string }>;
  failures?: Array<{ id: string; type: string; severity: string; summary?: string }>;
}

export function ToolRegistryPage() {
  const { t } = useTranslation();
  const { items, selected, selectedId, setSelectedId, loading, error: loadError, refresh } = useEntityList<ToolRegistryItem>('/api/tools', '', { schema: toolRegistryItemSchema.array() });
  const [policyDraft, setPolicyDraft] = useState({ riskLevel: 'medium', defaultPolicy: 'approve' });
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const loadDetail = useCallback(async (signal: AbortSignal) => {
    if (!selected?.id) return undefined;
    return api<ToolRegistryItem>(`/api/tools/${selected.id}`, { signal });
  }, [selected?.id]);
  const detailResource = useAsyncResource<ToolRegistryItem | undefined>(loadDetail, [selected?.id], Boolean(selected?.id));
  const detail = detailResource.data;
  useEffect(() => {
    if (detail) setPolicyDraft({ riskLevel: detail.riskLevel, defaultPolicy: detail.defaultPolicy });
  }, [detail?.id, detail?.riskLevel, detail?.defaultPolicy]);
  const toggle = async (tool: ToolRegistryItem) => {
    setBusy(tool.id);
    setActionError('');
    try {
      await post(`/api/tools/${tool.id}/${tool.enabled ? 'disable' : 'enable'}`, {});
      await refresh(tool.id);
      await detailResource.reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t('pages.toolRegistry.string_19'));
    } finally {
      setBusy('');
    }
  };
  const savePolicy = async () => {
    if (!detail) return;
    setBusy(`policy:${detail.id}`);
    setActionError('');
    try {
      await api(`/api/tools/${detail.id}/policy`, {
        method: 'PATCH',
        body: JSON.stringify({ riskLevel: policyDraft.riskLevel, defaultPolicy: policyDraft.defaultPolicy, enabled: detail.enabled })
      });
      await refresh(detail.id);
      await detailResource.reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t('pages.toolRegistry.string_20'));
    } finally {
      setBusy('');
    }
  };
  if (loading && !items) return <Loading />;
  const displayItems = items ?? [];
  return <section>
    <PageHeader eyebrow="V0.4 / Tool Registry" title={t('pages.toolRegistry.string_1')} description={t('pages.toolRegistry.string_2')}
      actions={selected && <button onClick={() => void toggle(selected)} disabled={busy === selected.id}><Power size={15} />{selected.enabled ? t('pages.toolRegistry.string_21') : t('pages.toolRegistry.string_22')}</button>} />
    {(loadError || detailResource.error || actionError) && <div className="notice warning">{loadError || detailResource.error || actionError}</div>}
    <div className="metric-grid compact">
      <Metric label="TOOLS" value={displayItems.length} tone="cyan" />
      <Metric label="TOOL CALLS" value={formatNumber(displayItems.reduce((sum, item) => sum + item.callCount, 0))} />
      <Metric label="SUCCESS RATE" value={`${(avg(displayItems.map((item) => item.successRate)) * 100).toFixed(0)}%`} tone="green" />
      <Metric label="AVG OUTPUT TOKENS" value={formatNumber(avg(displayItems.map((item) => item.avgOutputTokens)))} />
      <Metric label="DENIED CALLS" value={displayItems.filter((item) => item.defaultPolicy === 'deny').length} tone="red" />
    </div>
    <div className="registry-layout">
      <div className="panel registry-list">
        <div className="panel-title"><Boxes size={15} />{t('pages.toolRegistry.string_3')}<span>{displayItems.length}</span></div>
        {displayItems.map((tool) => <button key={tool.id} className={selectedId === tool.id ? 'active' : ''} onClick={() => setSelectedId(tool.id)}>
          <StatusBadge status={tool.enabled ? tool.riskLevel : 'disabled'} />
          <div><strong>{tool.id}</strong><span>{tool.category} · {tool.version}</span><p>{formatDisplayValue(tool.manifest.description)}</p></div>
          <aside><b>{(tool.successRate * 100).toFixed(0)}%</b><span>{tool.defaultPolicy}</span></aside>
        </button>)}
      </div>
      {!selected ? <Empty>{t('pages.toolRegistry.string_4')}</Empty> : !detail ? <Loading /> : <div className="registry-detail">
        <div className="panel registry-hero">
          <div className="registry-orbit"><Wrench size={26} /></div>
          <div><span className="eyebrow">{detail.category} / {detail.version}</span><h2>{detail.id}</h2><p>{formatDisplayValue(detail.manifest.description)}</p></div>
          <StatusBadge status={detail.enabled ? detail.riskLevel : 'disabled'} />
        </div>
        <div className="registry-facts">
          <span>{t('pages.toolRegistry.string_5')}<b>{detail.defaultPolicy}</b></span>
          <span>{t('pages.toolRegistry.string_6')}<b>{detail.callCount}</b></span>
          <span>{t('pages.toolRegistry.string_7')}<b>{(detail.successRate * 100).toFixed(1)}%</b></span>
          <span>{t('pages.toolRegistry.string_8')}<b>{(detail.errorRate * 100).toFixed(1)}%</b></span>
          <span>{t('pages.toolRegistry.string_9')}<b>{formatDuration(detail.avgLatencyMs)}</b></span>
          <span>{t('pages.toolRegistry.string_10')}<b>{formatNumber(detail.avgOutputTokens)}</b></span>
        </div>
        <div className="governance-columns">
          <article className="panel"><div className="panel-title"><ShieldCheck size={15} />{t('pages.toolRegistry.string_11')}</div>
            <div className="policy-editor">
              <label>{t('pages.toolRegistry.string_12')}<ThemedSelect value={policyDraft.riskLevel} onChange={(event) => setPolicyDraft({ ...policyDraft, riskLevel: event.target.value })}>{['low', 'medium', 'high', 'critical'].map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect></label>
              <label>{t('pages.toolRegistry.string_13')}<ThemedSelect value={policyDraft.defaultPolicy} onChange={(event) => setPolicyDraft({ ...policyDraft, defaultPolicy: event.target.value })}>{['allow', 'approve', 'deny'].map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect></label>
              <button className="primary" disabled={busy === `policy:${detail.id}`} onClick={() => void savePolicy()}><ShieldCheck size={14} />{t('pages.toolRegistry.string_14')}</button>
            </div>
            <JsonView value={{ riskLevel: detail.riskLevel, defaultPolicy: detail.defaultPolicy, permissions: detail.manifest.permissions, runtime: detail.manifest.runtime, contextInjection: detail.manifest.contextInjection }} />
          </article>
          <article className="panel"><div className="panel-title"><FileJson size={15} />Input Schema</div><JsonView value={detail.manifest.inputSchema} /></article>
        </div>
        <div className="governance-columns">
          <article className="panel"><div className="panel-title"><Check size={15} />{t('pages.toolRegistry.string_15')}</div>
            {!detail.calls?.length ? <Empty>{t('pages.toolRegistry.string_16')}</Empty> : detail.calls.slice(0, 8).map((call) => <div className="ledger-row" key={call.id}><StatusBadge status={call.success ? 'success' : 'failed'} /><strong>{call.runId}</strong><span>{formatDuration(call.latencyMs)}</span></div>)}
          </article>
          <article className="panel"><div className="panel-title"><AlertTriangle size={15} />{t('pages.toolRegistry.string_17')}</div>
            {!detail.failures?.length ? <Empty>{t('pages.toolRegistry.string_18')}</Empty> : detail.failures.map((failure) => <div className="ledger-row" key={failure.id}><StatusBadge status={failure.severity} /><strong>{failure.type}</strong><span>{failure.summary}</span></div>)}
          </article>
        </div>
      </div>}
    </div>
  </section>;
}

function avg(values: number[]) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, item) => sum + item, 0) / clean.length : 0;
}
