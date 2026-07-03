import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ClipboardList, FileOutput, GitBranch, MessageSquareText, RotateCcw, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { TraceTree } from '../components/TraceTree.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDuration, formatNumber } from '../utils/format.ts';

interface Span { id: string; parentId?: string; type: string; name: string; status: string; input?: unknown; output?: unknown; latencyMs?: number; metadata?: Record<string, unknown> }
interface Run { id: string; name: string; status: string; model?: string; promptVersion?: string; promptVersionId?: string; source?: string; agentId?: string; agentName?: string; userInput?: string; finalOutput?: string; skillVersions?: string[]; toolSchemaVersion?: string; runtimeVersion?: string; contextStrategyVersion?: string; latencyMs?: number; totalTokens?: number; score?: number; sessionId?: string; toolCallCount: number; artifactCount: number; metadata?: { finalOutput?: string; promptSnapshot?: unknown } }
interface Artifact { id: string; type: string; path: string; sizeBytes?: number }
interface RawTraceEvent { eventId: string; eventType: string; timestamp: string; raw: unknown }
interface Governance {
  skill?: { selectedSkillId: string; candidates: Array<{ skillId: string; score: number; matchedBy: string[]; status: string }> };
  permissions: { total: number; allow: number; approve: number; deny: number; decisions: Array<{ id: string; toolId: string; decision: string; riskLevel: string; reason?: string }> };
  context?: { snapshotId: string; budgetStrategy: string; beforeTokens: number; afterTokens: number; maxContextTokens: number; risks: Array<{ severity: string; message: string }> };
  failures: Array<{ id: string; type: string; severity: string; status: string; summary?: string }>;
  replay?: { snapshotId: string; createdAt: string };
}
type ReplayOverrides = { modelProviderId: string; modelName: string; promptVersion: string; skillVersion: string; contextStrategy: string; toolPolicy: string };

export function TracePage() {
  const { t } = useTranslation();
  const { runId = '' } = useParams();
  const [selected, setSelected] = useState<Span>();
  const [message, setMessage] = useState('');
  const [replayOverrides, setReplayOverrides] = useState<ReplayOverrides>({ modelProviderId: '', modelName: '', promptVersion: '', skillVersion: '', contextStrategy: '', toolPolicy: '' });
  const load = useCallback(async (signal: AbortSignal) => {
    const [run, spans, artifacts, governance, rawTrace] = await Promise.all([
      api<Run>(`/api/runs/${runId}`, { signal }), api<Span[]>(`/api/runs/${runId}/spans`, { signal }), api<Artifact[]>(`/api/runs/${runId}/artifacts`, { signal }), api<Governance>(`/api/runs/${runId}/governance`, { signal }), api<RawTraceEvent[]>(`/api/runs/${runId}/trace`, { signal })
    ]);
    return { run, spans, artifacts, governance, rawTrace };
  }, [runId]);
  const resource = useAsyncResource(load, [runId], Boolean(runId), { queryKey: ['trace-page', runId] });
  const run = resource.data?.run;
  const spans = resource.data?.spans ?? [];
  const artifacts = resource.data?.artifacts ?? [];
  const governance = resource.data?.governance;
  const rawTrace = resource.data?.rawTrace ?? [];
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
  const convertToCase = async () => {
    const item = await post<{ id: string }>(`/api/runs/${runId}/convert-to-case`, {
      name: `Trace Case · ${run?.userInput?.slice(0, 24) ?? runId}`,
      expectedOutput: run?.finalOutput ?? run?.metadata?.finalOutput,
      assertionType: 'manual',
      priority: 'P1',
      tags: ['from-trace']
    });
    setMessage(t('pages.trace.string_23'));
  };
  if (!run && !resource.error) return <Loading />;
  if (!run) return <section>
    <Link to="/runs" className="back-link"><ChevronLeft size={14} />{t('pages.trace.string_5')}</Link>
    <PageHeader eyebrow={t('pages.trace.string_1')} title={t('pages.trace.string_2')} description={`Run ID · ${runId}`} />
    <div className="notice warning">{resource.error}</div>
  </section>;
  return <section>
    <Link to="/runs" className="back-link"><ChevronLeft size={14} />{t('pages.trace.string_6')}</Link>
    <PageHeader eyebrow={t('pages.trace.string_3')} title={run.name} description={`Run ID · ${run.id}`}
      actions={<><button onClick={() => void convertToCase()}><ClipboardList size={14} />{t('pages.trace.string_7')}</button><StatusBadge status={run.status} /></>} />
    {message && <div className="notice">{message}</div>}
    <div className="metric-grid compact">
      <Metric label="MODEL" value={run.model ?? '—'} tone="cyan" /><Metric label="PROMPT" value={run.promptVersion ?? '—'} />
      <Metric label="LATENCY" value={formatDuration(run.latencyMs)} tone="amber" /><Metric label="TOKENS" value={formatNumber(run.totalTokens)} />
      <Metric label="SCORE" value={run.score ?? '—'} tone="green" />
    </div>
    <div className="version-bindings">
      <span>Agent <b>{run.agentName ?? run.agentId ?? t('common.unbound')}</b></span>
      <span>{t('pages.trace.string_8')}<b>{run.source ?? 'runtime'}</b></span>
      <span>{t('pages.trace.string_9')}<b>{run.skillVersions?.join(', ') || t('common.unbound')}</b></span>
      <span>{t('pages.trace.string_10')}<b>{run.toolSchemaVersion ?? t('common.unbound')}</b></span>
      <span>Runtime <b>{run.runtimeVersion ?? t('common.unbound')}</b></span>
      <span>{t('pages.trace.string_11')}<b>{run.contextStrategyVersion ?? t('common.unbound')}</b></span>
    </div>
    {governance && <div className="governance-summary">
      <article><span>Skill Debugger</span><strong>{governance.skill?.selectedSkillId ?? t('pages.trace.string_24')}</strong><p>{governance.skill?.candidates?.slice(0, 3).map((item) => `${item.skillId} ${item.score}`).join(' · ') || t('pages.trace.string_25')}</p></article>
      <article><span>Permission Chain</span><strong>{governance.permissions.allow}/{governance.permissions.approve}/{governance.permissions.deny}</strong><p>allow / approve / deny，共 {governance.permissions.total} 条决策</p></article>
      <article><span>Context Budget</span><strong>{formatNumber(governance.context?.afterTokens ?? 0)}</strong><p>{governance.context ? `${formatNumber(governance.context.beforeTokens)} → ${formatNumber(governance.context.afterTokens)} · ${governance.context.risks.length} risks` : t('pages.trace.string_26')}</p></article>
      <article><span>Failures</span><strong>{governance.failures.length}</strong><p>{governance.failures[0]?.summary ?? t('pages.trace.string_27')}</p></article>
      <article><span>Replay Snapshot</span><strong>{governance.replay?.snapshotId ? 'ready' : 'missing'}</strong><p>{governance.replay?.snapshotId ?? t('pages.trace.string_28')}</p></article>
      <aside><button onClick={() => void snapshot()}><ShieldCheck size={14} />{t('pages.trace.string_12')}</button><button className="primary" onClick={() => void replay()}><RotateCcw size={14} />{t('pages.trace.string_13')}</button></aside>
    </div>}
    {governance && <div className="panel replay-override-panel">
      <div className="panel-title"><RotateCcw size={15} />Replay Overrides <span>Model / Prompt / Skill / Context / Tool Policy</span></div>
      <div className="replay-override-grid">
        <label>Provider ID<input value={replayOverrides.modelProviderId} onChange={(event) => setReplayOverrides({ ...replayOverrides, modelProviderId: event.target.value })} placeholder={t('pages.trace.string_4')} /></label>
        <label>Model<input value={replayOverrides.modelName} onChange={(event) => setReplayOverrides({ ...replayOverrides, modelName: event.target.value })} placeholder={run.model ?? 'model'} /></label>
        <label>Prompt<input value={replayOverrides.promptVersion} onChange={(event) => setReplayOverrides({ ...replayOverrides, promptVersion: event.target.value })} placeholder={run.promptVersion ?? 'prompt'} /></label>
        <label>Skill<input value={replayOverrides.skillVersion} onChange={(event) => setReplayOverrides({ ...replayOverrides, skillVersion: event.target.value })} placeholder={run.skillVersions?.[0] ?? 'skill'} /></label>
        <label>Context Strategy<input value={replayOverrides.contextStrategy} onChange={(event) => setReplayOverrides({ ...replayOverrides, contextStrategy: event.target.value })} placeholder={run.contextStrategyVersion ?? 'balanced-v1'} /></label>
        <label>Tool Policy<input value={replayOverrides.toolPolicy} onChange={(event) => setReplayOverrides({ ...replayOverrides, toolPolicy: event.target.value })} placeholder="default-local-policy@0.4.0" /></label>
      </div>
      <div className="provider-actions"><button className="primary" onClick={() => void replayWithOverrides()}><RotateCcw size={14} />{t('pages.trace.string_14')}</button></div>
    </div>}
    <div className="trace-layout">
      <div className="panel trace-panel"><div className="panel-title"><GitBranch size={15} />{t('pages.trace.string_15')}<span>{spans.length} 个 span</span></div><TraceTree spans={spans} selected={selected?.id} onSelect={setSelected} /></div>
      <div className="panel detail-panel">
        <div className="panel-title"><MessageSquareText size={15} />{t('pages.trace.string_16')}<span>{selected?.type ?? t('pages.trace.string_29')}</span></div>
        {selected && <div className="detail-content">
          <div className="detail-head"><div><span className="eyebrow">{selected.type}</span><h2>{selected.name}</h2></div><StatusBadge status={selected.status} /></div>
          <div className="detail-stat"><span>{t('pages.trace.string_17')}</span><strong>{formatDuration(selected.latencyMs)}</strong><span>Span ID</span><code>{selected.id}</code></div>
          <h3>{t('pages.trace.string_18')}</h3><TraceInputView value={selected.input ?? { message: t('pages.trace.string_30') }} />
          <h3>{t('pages.trace.string_19')}</h3><JsonView value={selected.output ?? selected.metadata} />
          <h3>{t('pages.trace.string_20')}</h3><JsonView value={selected.metadata} />
        </div>}
      </div>
    </div>
    {Boolean(run.metadata?.promptSnapshot) && <div className="panel final-output"><div className="panel-title"><MessageSquareText size={15} />Prompt Snapshot</div><JsonView value={run.metadata?.promptSnapshot} /></div>}
    <div className="panel artifacts"><div className="panel-title"><FileOutput size={15} />{t('pages.trace.string_21')}<span>{artifacts.length}</span></div>
      <div className="artifact-grid">{artifacts.map((artifact) => <div key={artifact.id}><b>{artifact.type}</b><strong>{artifact.path}</strong><span>{formatNumber(artifact.sizeBytes)} bytes</span></div>)}</div>
    </div>
    {(run.finalOutput || run.metadata?.finalOutput) && <div className="panel final-output"><div className="panel-title"><MessageSquareText size={15} />{t('pages.trace.string_22')}</div><pre>{run.finalOutput ?? run.metadata?.finalOutput}</pre></div>}
    <div className="panel final-output"><div className="panel-title"><GitBranch size={15} />Raw Trace Events <span>{rawTrace.length}</span></div><JsonView value={rawTrace} /></div>
  </section>;
}

type InputRecord = Record<string, unknown>;
type MessageSummary = { role?: unknown; content?: unknown; contentChars?: unknown; contentTruncated?: unknown; toolCalls?: unknown; toolCallId?: unknown; name?: unknown };
type ToolSummary = { name?: unknown; description?: unknown };

function TraceInputView({ value }: { value: unknown }) {
  const input = asRecord(value);
  const messages = asRecord(input?.messages);
  const messageItems = Array.isArray(messages?.shown) ? messages.shown.filter(isRecord) as MessageSummary[] : [];
  const tools = asRecord(input?.tools);
  const toolItems = Array.isArray(tools?.shown) ? tools.shown.filter(isRecord) as ToolSummary[] : [];
  const systemPrompt = asRecord(input?.systemPrompt);
  const systemPromptPreview = typeof systemPrompt?.preview === 'string' ? systemPrompt.preview : undefined;
  const hasStructuredInput = messageItems.length > 0 || toolItems.length > 0 || Boolean(systemPromptPreview);
  if (!input || !hasStructuredInput) return <JsonView value={value} />;

  return <div className="trace-input-view">
    {systemPromptPreview && <article className="trace-input-card system">
      <div><b>system</b><span>{formatChars(systemPrompt?.chars)}{systemPrompt?.truncated ? ' · truncated' : ''}</span></div>
      <pre>{systemPromptPreview}</pre>
    </article>}
    {messageItems.length > 0 && <article className="trace-input-card">
      <div><b>messages</b><span>{formatSummaryCount(messages?.total, messageItems.length, messages?.omitted)}</span></div>
      <div className="trace-message-list">
        {messageItems.map((message, index) => <section key={`${String(message.role ?? 'message')}-${index}`}>
          <header><b>{String(message.role ?? 'unknown')}</b><span>{formatChars(message.contentChars)}{message.contentTruncated ? ' · truncated' : ''}</span></header>
          <p>{String(message.content ?? '') || '—'}</p>
          {Array.isArray(message.toolCalls) && message.toolCalls.length > 0 && <div className="trace-tool-call-list">
            {message.toolCalls.filter(isRecord).map((toolCall, toolIndex) => <code key={toolIndex}>{String(toolCall.name ?? toolCall.id ?? 'tool_call')}</code>)}
          </div>}
          {message.toolCallId ? <code className="trace-tool-result">{String(message.name ?? message.toolCallId)}</code> : null}
        </section>)}
      </div>
    </article>}
    {toolItems.length > 0 && <article className="trace-input-card">
      <div><b>tools</b><span>{formatSummaryCount(tools?.total, toolItems.length, tools?.omitted)}</span></div>
      <div className="trace-tool-list">
        {toolItems.map((tool, index) => {
          const description = typeof tool.description === 'string' ? tool.description : '';
          return <span key={`${String(tool.name ?? 'tool')}-${index}`}><b>{String(tool.name ?? 'unknown')}</b>{description ? <em>{description}</em> : null}</span>;
        })}
      </div>
    </article>}
    <JsonView value={compactInputMetadata(input)} />
  </div>;
}

function asRecord(value: unknown): InputRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InputRecord : undefined;
}

function isRecord(value: unknown): value is InputRecord {
  return Boolean(asRecord(value));
}

function formatChars(value: unknown) {
  return typeof value === 'number' ? `${formatNumber(value)} chars` : '—';
}

function formatSummaryCount(total: unknown, shown: number, omitted: unknown) {
  const totalText = typeof total === 'number' ? `${formatNumber(total)} total` : `${shown} shown`;
  const omittedText = typeof omitted === 'number' && omitted > 0 ? ` · ${formatNumber(omitted)} omitted` : '';
  return `${totalText} · ${shown} shown${omittedText}`;
}

function compactInputMetadata(input: InputRecord) {
  const { messages: _messages, tools: _tools, systemPrompt: _systemPrompt, ...metadata } = input;
  return Object.keys(metadata).length > 0 ? metadata : { input: 'structured' };
}
