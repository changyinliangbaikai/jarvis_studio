import { randomUUID } from 'node:crypto';
import { traceEventSchema, type TraceEvent } from '../../../../packages/trace-schema/src/events.ts';
import { db, json, run } from '../db/database.ts';

const spanEventTypes = new Set([
  'context.build', 'skill.select', 'prompt.render', 'llm.call', 'llm.stream', 'llm.parse',
  'permission.check', 'tool.call', 'tool.result', 'artifact.write', 'memory.retrieve',
  'memory.write', 'eval.score', 'error'
]);

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
function bool(value: unknown): number {
  return value ? 1 : 0;
}
function array(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
}

function ensureParents(event: TraceEvent) {
  const now = event.timestamp;
  if (event.projectId) {
    run(`INSERT OR IGNORE INTO projects VALUES (?, ?, ?, ?, ?, ?)`,
      event.projectId, event.projectId, null, null, now, now);
  }
  if (event.sessionId) {
    run(`INSERT OR IGNORE INTO sessions (id, project_id, title, status, started_at) VALUES (?, ?, ?, ?, ?)`,
      event.sessionId, event.projectId ?? null, `Session ${event.sessionId}`, 'running', now);
  }
  if (event.runId) {
    run(`INSERT OR IGNORE INTO runs (id, session_id, turn_id, name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
      event.runId, event.sessionId ?? null, event.turnId ?? null, `Run ${event.runId}`, 'running', now);
  }
}

function mapRun(event: TraceEvent) {
  const p = event.payload;
  if (event.eventType === 'run.start' && event.runId) {
    run(`UPDATE runs SET session_id=?, name=?, status='running', model=?, model_provider=?,
      prompt_version=?, skill_versions_json=?, tool_schema_version=?, runtime_version=?,
      context_strategy_version=?, metadata_json=? WHERE id=?`,
      event.sessionId ?? null, text(p.name, `Run ${event.runId}`), text(p.model) || null,
      text(p.modelProvider) || null, text(p.promptVersion) || null, json(p.skillVersions ?? []),
      text(p.toolSchemaVersion) || null, text(p.runtimeVersion) || null,
      text(p.contextStrategyVersion) || null, json(p), event.runId);
  }
  if (event.eventType === 'run.end' && event.runId) {
    run(`UPDATE runs SET status=?, ended_at=?, latency_ms=?, prompt_tokens=?, completion_tokens=?,
      total_tokens=?, score=COALESCE(?, score), error=?, metadata_json=? WHERE id=?`,
      text(p.status, 'success'), event.timestamp, num(p.latencyMs), num(p.promptTokens),
      num(p.completionTokens), num(p.totalTokens), num(p.score), text(p.error) || null, json(p), event.runId);
    if (event.sessionId) {
      run(`UPDATE sessions SET status=?, ended_at=? WHERE id=?`, text(p.status, 'success'), event.timestamp, event.sessionId);
    }
  }
}

function mapTurn(event: TraceEvent) {
  if (!event.turnId || !event.sessionId) return;
  const p = event.payload;
  if (event.eventType === 'turn.start') {
    run(`INSERT OR REPLACE INTO turns (id, session_id, turn_index, user_message, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)`,
      event.turnId, event.sessionId, num(p.index) ?? 0, text(p.userMessage), event.timestamp);
    run(`UPDATE runs SET turn_id=? WHERE id=?`, event.turnId, event.runId ?? '');
  }
  if (event.eventType === 'turn.end') {
    run(`UPDATE turns SET assistant_message=?, status=?, ended_at=? WHERE id=?`,
      text(p.assistantMessage), text(p.status, 'success'), event.timestamp, event.turnId);
  }
}

function mapSpan(event: TraceEvent) {
  if (!event.runId || !spanEventTypes.has(event.eventType)) return;
  const p = event.payload;
  const id = event.spanId ?? `${event.eventId}_span`;
  run(`INSERT OR REPLACE INTO spans (id, run_id, parent_id, type, name, status, input_json,
    output_json, started_at, ended_at, latency_ms, error, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, event.runId, event.parentSpanId ?? null, event.eventType, text(p.name, event.eventType),
    text(p.status, event.eventType === 'error' ? 'failed' : 'success'), json(p.input ?? p.arguments),
    json(p.output ?? p.result ?? p), event.timestamp, event.timestamp, num(p.latencyMs) ?? num((p.execution as Record<string, unknown> | undefined)?.latencyMs),
    text(p.error) || null, json(p));
}

function mapContext(event: TraceEvent) {
  if (event.eventType !== 'context.build' || !event.runId) return;
  const p = event.payload;
  const snapshotId = text(p.contextSnapshotId, `${event.eventId}_context`);
  run(`INSERT OR REPLACE INTO context_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    snapshotId, event.runId, event.turnId ?? null, text(p.llmCallId) || null, num(p.totalTokens),
    num(p.maxContextTokens), bool(p.truncated), bool(p.compressed), text(p.finalPromptRef) || null,
    text(p.finalPrompt) || null, event.timestamp);
  for (const segment of array(p.segments)) {
    run(`INSERT OR REPLACE INTO context_segments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      text(segment.id, randomUUID()), snapshotId, text(segment.type, 'unknown'), text(segment.name, 'Untitled'),
      text(segment.version) || null, text(segment.contentRef) || null, text(segment.preview) || null,
      num(segment.tokens) ?? 0, bool(segment.included), bool(segment.truncated), bool(segment.compressed),
      num(segment.priority), text(segment.reason) || null);
  }
}

function mapLLM(event: TraceEvent) {
  if (event.eventType !== 'llm.call' || !event.runId) return;
  const p = event.payload;
  run(`INSERT OR REPLACE INTO llm_calls (
    id, run_id, turn_id, span_id, model, provider, temperature, max_output_tokens,
    prompt_tokens, completion_tokens, total_tokens, latency_ms, first_token_latency_ms,
    prefill_ms, decode_ms, tokens_per_second, context_snapshot_id, input_ref, output_json, cost, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    text(p.llmCallId, event.eventId), event.runId, event.turnId ?? null, event.spanId ?? null,
    text(p.model, 'unknown'), text(p.provider) || null, num(p.temperature), num(p.maxOutputTokens),
    num(p.promptTokens), num(p.completionTokens), num(p.totalTokens), num(p.latencyMs),
    num(p.firstTokenLatencyMs), num(p.prefillMs), num(p.decodeMs), num(p.tokensPerSecond),
    text(p.contextSnapshotId) || null, text(p.inputRef) || null, json(p.output), num(p.cost), event.timestamp);
}

function mapTool(event: TraceEvent) {
  if (event.eventType !== 'tool.call' || !event.runId) return;
  const p = event.payload;
  const execution = (p.execution ?? {}) as Record<string, unknown>;
  run(`INSERT OR REPLACE INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    text(p.toolCallId, event.eventId), event.runId, event.turnId ?? null, event.spanId ?? null,
    text(p.tool, 'unknown'), text(p.reason) || null, json(p.arguments), json(p.permission),
    num(execution.latencyMs), bool(execution.success), num(execution.exitCode), text(p.stdoutRef) || null,
    text(p.stderrRef) || null, json(p.result), json(p.contextInjection), event.timestamp);
}

function mapArtifacts(event: TraceEvent) {
  if (event.eventType !== 'artifact.write' || !event.runId) return;
  for (const artifact of array(event.payload.artifacts)) {
    run(`INSERT OR REPLACE INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      text(artifact.id, randomUUID()), event.runId, event.turnId ?? null, text(artifact.type, 'unknown'),
      text(artifact.path), text(artifact.sha256) || null, num(artifact.sizeBytes), event.timestamp);
  }
}

export function importTraceJsonl(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const events = lines.map((line, index) => {
    try {
      return traceEventSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`第 ${index + 1} 行不是有效 Trace Event: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  });
  db.exec('BEGIN');
  try {
    for (const event of events) {
      ensureParents(event);
      run(`INSERT OR REPLACE INTO raw_trace_events VALUES (?, ?, ?, ?, ?, ?)`,
        event.eventId, event.eventType, event.runId ?? null, event.timestamp, JSON.stringify(event), new Date().toISOString());
      mapRun(event);
      mapTurn(event);
      mapSpan(event);
      mapContext(event);
      mapLLM(event);
      mapTool(event);
      mapArtifacts(event);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { importedEvents: events.length, runIds: [...new Set(events.flatMap((event) => event.runId ? [event.runId] : []))] };
}
