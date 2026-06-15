import { useEffect, useState } from 'react';
import { ChevronLeft, FileOutput, GitBranch, MessageSquareText } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDuration, formatNumber } from '../api.ts';
import { JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { TraceTree } from '../components/TraceTree.tsx';

interface Span { id: string; parentId?: string; type: string; name: string; status: string; input?: unknown; output?: unknown; latencyMs?: number; metadata?: Record<string, unknown> }
interface Run { id: string; name: string; status: string; model?: string; promptVersion?: string; skillVersions?: string[]; toolSchemaVersion?: string; runtimeVersion?: string; contextStrategyVersion?: string; latencyMs?: number; totalTokens?: number; score?: number; sessionId?: string; toolCallCount: number; artifactCount: number; metadata?: { finalOutput?: string } }
interface Artifact { id: string; type: string; path: string; sizeBytes?: number }

export function TracePage() {
  const { runId = '' } = useParams();
  const [run, setRun] = useState<Run>();
  const [spans, setSpans] = useState<Span[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<Span>();
  useEffect(() => { void Promise.all([
    api<Run>(`/api/runs/${runId}`), api<Span[]>(`/api/runs/${runId}/spans`), api<Artifact[]>(`/api/runs/${runId}/artifacts`)
  ]).then(([runData, spanData, artifactData]) => { setRun(runData); setSpans(spanData); setArtifacts(artifactData); setSelected(spanData[0]); }); }, [runId]);
  if (!run) return <Loading />;
  return <section>
    <Link to="/" className="back-link"><ChevronLeft size={14} />返回 Runs</Link>
    <PageHeader eyebrow="02 / TRACE VIEWER" title={run.name} description={`Run ID · ${run.id}`}
      actions={<StatusBadge status={run.status} />} />
    <div className="metric-grid compact">
      <Metric label="MODEL" value={run.model ?? '—'} tone="cyan" /><Metric label="PROMPT" value={run.promptVersion ?? '—'} />
      <Metric label="LATENCY" value={formatDuration(run.latencyMs)} tone="amber" /><Metric label="TOKENS" value={formatNumber(run.totalTokens)} />
      <Metric label="SCORE" value={run.score ?? '—'} tone="green" />
    </div>
    <div className="version-bindings">
      <span>SKILL <b>{run.skillVersions?.join(', ') || 'unbound'}</b></span>
      <span>TOOL SCHEMA <b>{run.toolSchemaVersion ?? 'unbound'}</b></span>
      <span>RUNTIME <b>{run.runtimeVersion ?? 'unbound'}</b></span>
      <span>CONTEXT STRATEGY <b>{run.contextStrategyVersion ?? 'unbound'}</b></span>
    </div>
    <div className="trace-layout">
      <div className="panel trace-panel"><div className="panel-title"><GitBranch size={15} />TRACE TREE <span>{spans.length} spans</span></div><TraceTree spans={spans} selected={selected?.id} onSelect={setSelected} /></div>
      <div className="panel detail-panel">
        <div className="panel-title"><MessageSquareText size={15} />SPAN DETAIL <span>{selected?.type ?? 'select a node'}</span></div>
        {selected && <div className="detail-content">
          <div className="detail-head"><div><span className="eyebrow">{selected.type}</span><h2>{selected.name}</h2></div><StatusBadge status={selected.status} /></div>
          <div className="detail-stat"><span>Latency</span><strong>{formatDuration(selected.latencyMs)}</strong><span>Span ID</span><code>{selected.id}</code></div>
          <h3>Input</h3><JsonView value={selected.input ?? { message: 'No structured input captured.' }} />
          <h3>Output</h3><JsonView value={selected.output ?? selected.metadata} />
          <h3>Full Metadata</h3><JsonView value={selected.metadata} />
        </div>}
      </div>
    </div>
    <div className="panel artifacts"><div className="panel-title"><FileOutput size={15} />ARTIFACTS <span>{artifacts.length}</span></div>
      <div className="artifact-grid">{artifacts.map((artifact) => <div key={artifact.id}><b>{artifact.type}</b><strong>{artifact.path}</strong><span>{formatNumber(artifact.sizeBytes)} bytes</span></div>)}</div>
    </div>
    {run.metadata?.finalOutput && <div className="panel final-output"><div className="panel-title"><MessageSquareText size={15} />FINAL OUTPUT</div><pre>{run.metadata.finalOutput}</pre></div>}
  </section>;
}
