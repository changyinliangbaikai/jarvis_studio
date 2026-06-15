import { useEffect, useState } from 'react';
import { Braces, CircleSlash2, Files, ScanSearch } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api, formatNumber } from '../api.ts';
import { Empty, Loading, Metric, PageHeader } from '../components/Primitives.tsx';
import { TokenBreakdown } from '../components/TokenBreakdown.tsx';

interface Segment { id: string; type: string; name: string; version?: string; preview?: string; tokens: number; included: boolean; truncated: boolean; compressed: boolean; reason?: string }
interface Snapshot { id: string; runId: string; totalTokens: number; maxContextTokens: number; truncated: boolean; compressed: boolean; finalPrompt?: string; segments: Segment[]; createdAt: string }
export function ContextPage() {
  const params = useParams();
  const [items, setItems] = useState<Snapshot[]>();
  const [selectedId, setSelectedId] = useState(params.snapshotId ?? '');
  const selected = items?.find((item) => item.id === selectedId) ?? items?.[0];
  useEffect(() => { void api<Snapshot[]>('/api/context-snapshots').then((data) => { setItems(data); setSelectedId((value) => value || data[0]?.id || ''); }); }, []);
  if (!items) return <Loading />;
  return <section>
    <PageHeader eyebrow="04 / CONTEXT INSPECTOR" title="Context Anatomy" description="检查模型调用前最终上下文的来源、Token 预算、压缩和截断决策。"
      actions={<select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.runId}</option>)}</select>} />
    {!selected ? <Empty>尚未捕获 Context Snapshot。</Empty> : <>
      <div className="metric-grid compact">
        <Metric label="USED TOKENS" value={formatNumber(selected.totalTokens)} tone="cyan" />
        <Metric label="CONTEXT LIMIT" value={formatNumber(selected.maxContextTokens)} />
        <Metric label="UTILIZATION" value={`${((selected.totalTokens / selected.maxContextTokens) * 100).toFixed(1)}%`} tone="amber" />
        <Metric label="SEGMENTS" value={selected.segments.length} />
        <Metric label="EXCLUDED" value={selected.segments.filter((segment) => !segment.included).length} tone="red" />
      </div>
      <div className="panel token-panel"><div className="panel-title"><ScanSearch size={15} />TOKEN DISTRIBUTION</div><TokenBreakdown segments={selected.segments} total={selected.totalTokens} /></div>
      <div className="context-layout">
        <div className="panel"><div className="panel-title"><Files size={15} />CONTEXT SOURCE TREE <span>{selected.compressed ? 'compressed' : 'raw'}</span></div>
          <div className="segment-list">{selected.segments.map((segment) => <div className={`segment ${segment.included ? '' : 'excluded'}`} key={segment.id}>
            <div className="segment-icon">{segment.included ? <Braces size={15} /> : <CircleSlash2 size={15} />}</div>
            <div><strong>{segment.name}</strong><span>{segment.type} {segment.version && `· ${segment.version}`}</span><p>{segment.preview ?? segment.reason ?? '没有预览内容'}</p></div>
            <aside><b>{formatNumber(segment.tokens)}</b><span>tokens</span>{segment.truncated && <em>truncated</em>}{segment.compressed && <em>compressed</em>}</aside>
          </div>)}</div>
        </div>
        <div className="panel prompt-preview"><div className="panel-title"><Braces size={15} />FINAL PROMPT</div><pre>{selected.finalPrompt || selected.segments.filter((segment) => segment.included).map((segment) => segment.preview).filter(Boolean).join('\n\n')}</pre></div>
      </div>
    </>}
  </section>;
}
