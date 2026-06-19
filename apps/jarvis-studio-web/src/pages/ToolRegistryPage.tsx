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
      setActionError(caught instanceof Error ? caught.message : '更新工具状态失败');
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
      setActionError(caught instanceof Error ? caught.message : '保存工具策略失败');
    } finally {
      setBusy('');
    }
  };
  if (loading && !items) return <Loading />;
  const displayItems = items ?? [];
  return <section>
    <PageHeader eyebrow="V0.4 / Tool Registry" title="工具治理台 (Tool Registry)" description="管理工具 Schema、风险等级、默认策略、权限需求、调用统计、错误分析和上下文注入策略。"
      actions={selected && <button onClick={() => void toggle(selected)} disabled={busy === selected.id}><Power size={15} />{selected.enabled ? '停用 Tool' : '启用 Tool'}</button>} />
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
        <div className="panel-title"><Boxes size={15} />工具清单 <span>{displayItems.length}</span></div>
        {displayItems.map((tool) => <button key={tool.id} className={selectedId === tool.id ? 'active' : ''} onClick={() => setSelectedId(tool.id)}>
          <StatusBadge status={tool.enabled ? tool.riskLevel : 'disabled'} />
          <div><strong>{tool.id}</strong><span>{tool.category} · {tool.version}</span><p>{formatDisplayValue(tool.manifest.description)}</p></div>
          <aside><b>{(tool.successRate * 100).toFixed(0)}%</b><span>{tool.defaultPolicy}</span></aside>
        </button>)}
      </div>
      {!selected ? <Empty>尚未注册工具 manifest。</Empty> : !detail ? <Loading /> : <div className="registry-detail">
        <div className="panel registry-hero">
          <div className="registry-orbit"><Wrench size={26} /></div>
          <div><span className="eyebrow">{detail.category} / {detail.version}</span><h2>{detail.id}</h2><p>{formatDisplayValue(detail.manifest.description)}</p></div>
          <StatusBadge status={detail.enabled ? detail.riskLevel : 'disabled'} />
        </div>
        <div className="registry-facts">
          <span>默认策略<b>{detail.defaultPolicy}</b></span>
          <span>调用次数<b>{detail.callCount}</b></span>
          <span>成功率<b>{(detail.successRate * 100).toFixed(1)}%</b></span>
          <span>错误率<b>{(detail.errorRate * 100).toFixed(1)}%</b></span>
          <span>平均耗时<b>{formatDuration(detail.avgLatencyMs)}</b></span>
          <span>平均输出 Token<b>{formatNumber(detail.avgOutputTokens)}</b></span>
        </div>
        <div className="governance-columns">
          <article className="panel"><div className="panel-title"><ShieldCheck size={15} />权限策略</div>
            <div className="policy-editor">
              <label>风险等级<ThemedSelect value={policyDraft.riskLevel} onChange={(event) => setPolicyDraft({ ...policyDraft, riskLevel: event.target.value })}>{['low', 'medium', 'high', 'critical'].map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect></label>
              <label>默认策略<ThemedSelect value={policyDraft.defaultPolicy} onChange={(event) => setPolicyDraft({ ...policyDraft, defaultPolicy: event.target.value })}>{['allow', 'approve', 'deny'].map((item) => <option value={item} key={item}>{item}</option>)}</ThemedSelect></label>
              <button className="primary" disabled={busy === `policy:${detail.id}`} onClick={() => void savePolicy()}><ShieldCheck size={14} />保存策略</button>
            </div>
            <JsonView value={{ riskLevel: detail.riskLevel, defaultPolicy: detail.defaultPolicy, permissions: detail.manifest.permissions, runtime: detail.manifest.runtime, contextInjection: detail.manifest.contextInjection }} />
          </article>
          <article className="panel"><div className="panel-title"><FileJson size={15} />Input Schema</div><JsonView value={detail.manifest.inputSchema} /></article>
        </div>
        <div className="governance-columns">
          <article className="panel"><div className="panel-title"><Check size={15} />最近调用</div>
            {!detail.calls?.length ? <Empty>暂无调用记录。</Empty> : detail.calls.slice(0, 8).map((call) => <div className="ledger-row" key={call.id}><StatusBadge status={call.success ? 'success' : 'failed'} /><strong>{call.runId}</strong><span>{formatDuration(call.latencyMs)}</span></div>)}
          </article>
          <article className="panel"><div className="panel-title"><AlertTriangle size={15} />错误分析</div>
            {!detail.failures?.length ? <Empty>暂无关联 Failure。</Empty> : detail.failures.map((failure) => <div className="ledger-row" key={failure.id}><StatusBadge status={failure.severity} /><strong>{failure.type}</strong><span>{failure.summary}</span></div>)}
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
