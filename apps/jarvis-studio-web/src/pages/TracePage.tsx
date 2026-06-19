import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, FileOutput, GitBranch, MessageSquareText, RotateCcw, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { TraceTree } from '../components/TraceTree.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDuration, formatNumber } from '../utils/format.ts';

interface Span { id: string; parentId?: string; type: string; name: string; status: string; input?: unknown; output?: unknown; latencyMs?: number; metadata?: Record<string, unknown> }
interface Run { id: string; name: string; status: string; model?: string; promptVersion?: string; skillVersions?: string[]; toolSchemaVersion?: string; runtimeVersion?: string; contextStrategyVersion?: string; latencyMs?: number; totalTokens?: number; score?: number; sessionId?: string; toolCallCount: number; artifactCount: number; metadata?: { finalOutput?: string } }
interface Artifact { id: string; type: string; path: string; sizeBytes?: number }
interface Governance {
  skill?: { selectedSkillId: string; candidates: Array<{ skillId: string; score: number; matchedBy: string[]; status: string }> };
  permissions: { total: number; allow: number; approve: number; deny: number; decisions: Array<{ id: string; toolId: string; decision: string; riskLevel: string; reason?: string }> };
  context?: { snapshotId: string; budgetStrategy: string; beforeTokens: number; afterTokens: number; maxContextTokens: number; risks: Array<{ severity: string; message: string }> };
  failures: Array<{ id: string; type: string; severity: string; status: string; summary?: string }>;
  replay?: { snapshotId: string; createdAt: string };
}
type ReplayOverrides = { modelProviderId: string; modelName: string; promptVersion: string; skillVersion: string; contextStrategy: string; toolPolicy: string };

export function TracePage() {
  const { runId = '' } = useParams();
  const [selected, setSelected] = useState<Span>();
  const [replayOverrides, setReplayOverrides] = useState<ReplayOverrides>({ modelProviderId: '', modelName: '', promptVersion: '', skillVersion: '', contextStrategy: '', toolPolicy: '' });
  const load = useCallback(async (signal: AbortSignal) => {
    const [run, spans, artifacts, governance] = await Promise.all([
      api<Run>(`/api/runs/${runId}`, { signal }), api<Span[]>(`/api/runs/${runId}/spans`, { signal }), api<Artifact[]>(`/api/runs/${runId}/artifacts`, { signal }), api<Governance>(`/api/runs/${runId}/governance`, { signal })
    ]);
    return { run, spans, artifacts, governance };
  }, [runId]);
  const resource = useAsyncResource(load, [runId], Boolean(runId), { queryKey: ['trace-page', runId] });
  const run = resource.data?.run;
  const spans = resource.data?.spans ?? [];
  const artifacts = resource.data?.artifacts ?? [];
  const governance = resource.data?.governance;
  useEffect(() => {
    setSelected((current) => spans.find((span) => span.id === current?.id) ?? spans[0]);
  }, [spans]);
  const snapshot = async () => {
    await post<Governance>(`/api/runs/${runId}/snapshot`, {});
    await resource.reload();
  };
  const replay = async () => {
    await post(`/api/runs/${runId}/replay`, {});
    await resource.reload();
  };
  const replayWithOverrides = async () => {
    const overrides = Object.fromEntries(Object.entries(replayOverrides).filter(([, value]) => value.trim()));
    await post(`/api/runs/${runId}/replay-with-overrides`, overrides);
    await resource.reload();
  };
  if (!run && !resource.error) return <Loading />;
  if (!run) return <section>
    <Link to="/" className="back-link"><ChevronLeft size={14} />返回运行记录</Link>
    <PageHeader eyebrow="02 / Trace 查看器 (Trace Viewer)" title="Trace 加载失败" description={`Run ID · ${runId}`} />
    <div className="notice warning">{resource.error}</div>
  </section>;
  return <section>
    <Link to="/" className="back-link"><ChevronLeft size={14} />返回运行记录</Link>
    <PageHeader eyebrow="02 / Trace 查看器 (Trace Viewer)" title={run.name} description={`Run ID · ${run.id}`}
      actions={<StatusBadge status={run.status} />} />
    <div className="metric-grid compact">
      <Metric label="MODEL" value={run.model ?? '—'} tone="cyan" /><Metric label="PROMPT" value={run.promptVersion ?? '—'} />
      <Metric label="LATENCY" value={formatDuration(run.latencyMs)} tone="amber" /><Metric label="TOKENS" value={formatNumber(run.totalTokens)} />
      <Metric label="SCORE" value={run.score ?? '—'} tone="green" />
    </div>
    <div className="version-bindings">
      <span>技能 (Skill) <b>{run.skillVersions?.join(', ') || '未绑定'}</b></span>
      <span>工具 Schema <b>{run.toolSchemaVersion ?? '未绑定'}</b></span>
      <span>Runtime <b>{run.runtimeVersion ?? '未绑定'}</b></span>
      <span>上下文策略 <b>{run.contextStrategyVersion ?? '未绑定'}</b></span>
    </div>
    {governance && <div className="governance-summary">
      <article><span>Skill Debugger</span><strong>{governance.skill?.selectedSkillId ?? '未捕获'}</strong><p>{governance.skill?.candidates?.slice(0, 3).map((item) => `${item.skillId} ${item.score}`).join(' · ') || '暂无候选分数'}</p></article>
      <article><span>Permission Chain</span><strong>{governance.permissions.allow}/{governance.permissions.approve}/{governance.permissions.deny}</strong><p>allow / approve / deny，共 {governance.permissions.total} 条决策</p></article>
      <article><span>Context Budget</span><strong>{formatNumber(governance.context?.afterTokens ?? 0)}</strong><p>{governance.context ? `${formatNumber(governance.context.beforeTokens)} → ${formatNumber(governance.context.afterTokens)} · ${governance.context.risks.length} risks` : '暂无快照'}</p></article>
      <article><span>Failures</span><strong>{governance.failures.length}</strong><p>{governance.failures[0]?.summary ?? '暂无 Failure Record'}</p></article>
      <article><span>Replay Snapshot</span><strong>{governance.replay?.snapshotId ? 'ready' : 'missing'}</strong><p>{governance.replay?.snapshotId ?? '生成快照后可重放'}</p></article>
      <aside><button onClick={() => void snapshot()}><ShieldCheck size={14} />生成快照</button><button className="primary" onClick={() => void replay()}><RotateCcw size={14} />原配置重放</button></aside>
    </div>}
    {governance && <div className="panel replay-override-panel">
      <div className="panel-title"><RotateCcw size={15} />Replay Overrides <span>Model / Prompt / Skill / Context / Tool Policy</span></div>
      <div className="replay-override-grid">
        <label>Provider ID<input value={replayOverrides.modelProviderId} onChange={(event) => setReplayOverrides({ ...replayOverrides, modelProviderId: event.target.value })} placeholder="留空使用快照配置" /></label>
        <label>Model<input value={replayOverrides.modelName} onChange={(event) => setReplayOverrides({ ...replayOverrides, modelName: event.target.value })} placeholder={run.model ?? 'model'} /></label>
        <label>Prompt<input value={replayOverrides.promptVersion} onChange={(event) => setReplayOverrides({ ...replayOverrides, promptVersion: event.target.value })} placeholder={run.promptVersion ?? 'prompt'} /></label>
        <label>Skill<input value={replayOverrides.skillVersion} onChange={(event) => setReplayOverrides({ ...replayOverrides, skillVersion: event.target.value })} placeholder={run.skillVersions?.[0] ?? 'skill'} /></label>
        <label>Context Strategy<input value={replayOverrides.contextStrategy} onChange={(event) => setReplayOverrides({ ...replayOverrides, contextStrategy: event.target.value })} placeholder={run.contextStrategyVersion ?? 'balanced-v1'} /></label>
        <label>Tool Policy<input value={replayOverrides.toolPolicy} onChange={(event) => setReplayOverrides({ ...replayOverrides, toolPolicy: event.target.value })} placeholder="default-local-policy@0.4.0" /></label>
      </div>
      <div className="provider-actions"><button className="primary" onClick={() => void replayWithOverrides()}><RotateCcw size={14} />按 Override 重放</button></div>
    </div>}
    <div className="trace-layout">
      <div className="panel trace-panel"><div className="panel-title"><GitBranch size={15} />Trace 树 <span>{spans.length} 个 span</span></div><TraceTree spans={spans} selected={selected?.id} onSelect={setSelected} /></div>
      <div className="panel detail-panel">
        <div className="panel-title"><MessageSquareText size={15} />Span 详情 <span>{selected?.type ?? '选择节点'}</span></div>
        {selected && <div className="detail-content">
          <div className="detail-head"><div><span className="eyebrow">{selected.type}</span><h2>{selected.name}</h2></div><StatusBadge status={selected.status} /></div>
          <div className="detail-stat"><span>耗时</span><strong>{formatDuration(selected.latencyMs)}</strong><span>Span ID</span><code>{selected.id}</code></div>
          <h3>输入 (Input)</h3><JsonView value={selected.input ?? { message: '未捕获结构化输入' }} />
          <h3>输出 (Output)</h3><JsonView value={selected.output ?? selected.metadata} />
          <h3>完整元数据</h3><JsonView value={selected.metadata} />
        </div>}
      </div>
    </div>
    <div className="panel artifacts"><div className="panel-title"><FileOutput size={15} />产物 (Artifacts) <span>{artifacts.length}</span></div>
      <div className="artifact-grid">{artifacts.map((artifact) => <div key={artifact.id}><b>{artifact.type}</b><strong>{artifact.path}</strong><span>{formatNumber(artifact.sizeBytes)} bytes</span></div>)}</div>
    </div>
    {run.metadata?.finalOutput && <div className="panel final-output"><div className="panel-title"><MessageSquareText size={15} />最终输出 (Final Output)</div><pre>{run.metadata.finalOutput}</pre></div>}
  </section>;
}
