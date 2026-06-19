import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { Braces, CircleSlash2, Files, ScanSearch } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatNumber } from '../utils/format.ts';
import { TokenBreakdown } from '../components/TokenBreakdown.tsx';

interface Segment { id: string; type: string; name: string; version?: string; preview?: string; tokens: number; tokensBefore?: number; tokensAfter?: number; action?: string; priority?: number; included: boolean; truncated: boolean; compressed: boolean; reason?: string }
interface Snapshot { id: string; runId: string; totalTokens: number; totalTokensBeforeBudget?: number; totalTokensAfterBudget?: number; budgetStrategy?: string; reservedOutputTokens?: number; risks?: Array<{ severity: string; message: string }>; maxContextTokens: number; truncated: boolean; compressed: boolean; finalPrompt?: string; segments: Segment[]; createdAt: string }
interface ContextDiff { changed: Array<{ type: string; leftTokens: number; rightTokens: number; leftAction?: string; rightAction?: string }> }
export function ContextPage() {
  const params = useParams();
  const [selectedId, setSelectedId] = useState(params.snapshotId ?? '');
  const [compareId, setCompareId] = useState('');
  const loadSnapshots = useCallback((signal: AbortSignal) => api<Snapshot[]>('/api/context-snapshots', { signal }), []);
  const snapshots = useAsyncResource(loadSnapshots, [], true, { queryKey: ['context-snapshots'] });
  const items = snapshots.data;
  const selected = items?.find((item) => item.id === selectedId) ?? items?.[0];
  const loadDiff = useCallback((signal: AbortSignal) => {
    if (!selected?.id || !compareId || compareId === selected.id) return Promise.resolve(undefined);
    return api<ContextDiff>(`/api/context/snapshots/${selected.id}/diff?compareTo=${encodeURIComponent(compareId)}`, { signal });
  }, [compareId, selected?.id]);
  const diffResource = useAsyncResource<ContextDiff | undefined>(loadDiff, [selected?.id, compareId], Boolean(selected?.id && compareId && compareId !== selected.id), { queryKey: ['context-diff', selected?.id, compareId] });
  const { data: diff, error: diffError, setData: setDiff } = diffResource;
  useEffect(() => {
    if (items) setSelectedId((value) => value || params.snapshotId || items[0]?.id || '');
  }, [items, params.snapshotId]);
  useEffect(() => {
    if (!compareId || compareId === selected?.id) setDiff(undefined);
  }, [compareId, selected?.id, setDiff]);
  if (!items) return <Loading />;
  return <section>
    <PageHeader eyebrow="04 / 上下文检查器 (Context Inspector)" title="上下文解剖 (Context Anatomy)" description="检查模型调用前最终上下文的来源、Token 预算、压缩和截断决策。"
      actions={<div className="context-actions">
        <ThemedSelect value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.runId}</option>)}</ThemedSelect>
        <ThemedSelect value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">选择对比快照</option>{items.filter((item) => item.id !== selected?.id).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.runId}</option>)}</ThemedSelect>
      </div>} />
    {(snapshots.error || diffError) && <div className="notice warning">{snapshots.error || diffError}</div>}
    {!selected ? <Empty>尚未捕获 Context Snapshot。</Empty> : <>
      <div className="metric-grid compact">
        <Metric label="USED TOKENS" value={formatNumber(selected.totalTokens)} tone="cyan" />
        <Metric label="TOKENS" value={`${formatNumber(selected.totalTokensBeforeBudget ?? selected.totalTokens)} → ${formatNumber(selected.totalTokensAfterBudget ?? selected.totalTokens)}`} />
        <Metric label="CONTEXT LIMIT" value={formatNumber(selected.maxContextTokens)} />
        <Metric label="UTILIZATION" value={`${(((selected.totalTokensAfterBudget ?? selected.totalTokens) / selected.maxContextTokens) * 100).toFixed(1)}%`} tone="amber" />
        <Metric label="SEGMENTS" value={selected.segments.length} />
      </div>
      {Boolean(selected.risks?.length) && <div className="risk-strip">{selected.risks?.map((risk, index) => <span key={index} className={`risk-${risk.severity}`}>{risk.message}</span>)}</div>}
      {diff && <div className="panel context-diff">
        <div className="panel-title"><ScanSearch size={15} />Context Diff <span>{selected.id} vs {compareId}</span></div>
        <table><thead><tr><th>Segment Type</th><th>当前 Token</th><th>对比 Token</th><th>当前动作</th><th>对比动作</th></tr></thead><tbody>
          {diff.changed.map((item) => <tr key={item.type}><td>{item.type}</td><td>{formatNumber(item.leftTokens)}</td><td>{formatNumber(item.rightTokens)}</td><td>{item.leftAction ?? '—'}</td><td>{item.rightAction ?? '—'}</td></tr>)}
        </tbody></table>
        <details><summary>Diff JSON</summary><JsonView value={diff} /></details>
      </div>}
      <div className="panel token-panel"><div className="panel-title"><ScanSearch size={15} />Token 分布</div><TokenBreakdown segments={selected.segments} total={selected.totalTokens} /></div>
      <div className="context-layout">
        <div className="panel"><div className="panel-title"><Files size={15} />上下文来源树 <span>{selected.compressed ? '已压缩' : '原始'}</span></div>
          <div className="segment-list">{selected.segments.map((segment) => <div className={`segment ${segment.included ? '' : 'excluded'}`} key={segment.id}>
            <div className="segment-icon">{segment.included ? <Braces size={15} /> : <CircleSlash2 size={15} />}</div>
            <div><strong>{segment.name}</strong><span>{segment.type} · P{segment.priority ?? '-'} {segment.version && `· ${segment.version}`}</span><p>{segment.preview ?? segment.reason ?? '没有预览内容'}</p></div>
            <aside><b>{formatNumber(segment.tokensAfter ?? segment.tokens)}</b><span>{formatNumber(segment.tokensBefore ?? segment.tokens)} before</span><em>{segment.action ?? 'keep'}</em></aside>
          </div>)}</div>
        </div>
        <div className="panel prompt-preview"><div className="panel-title"><Braces size={15} />最终 Prompt</div><pre>{selected.finalPrompt || selected.segments.filter((segment) => segment.included).map((segment) => segment.preview).filter(Boolean).join('\n\n')}</pre></div>
      </div>
    </>}
  </section>;
}
