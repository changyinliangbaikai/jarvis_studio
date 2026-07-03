import { randomUUID } from 'node:crypto';
import { traceEventSchema, type TraceEvent } from '@jarvis/trace-sdk';
import { db, json, run, get } from '../db/database.ts';

const spanEventTypes = new Set([
  'context.build', 'skill.select', 'prompt.render', 'llm.call', 'llm.stream', 'llm.parse',
  'llm.request.start', 'llm.usage', 'assistant.message', 'tool.batch.start', 'tool.call.start', 'tool.call.end',
  'permission.check', 'tool.policy.check', 'context.budget.apply', 'context.segment',
  'tool.call', 'tool.result', 'artifact.write', 'memory.retrieve',
  'memory.write', 'eval.score', 'failure.detected', 'replay.snapshot.created',
  'run.pause_for_approval', 'run.resume_after_approval', 'run.stop_after_rejection',
  'error'
]);

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
function firstNum(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = num(value);
    if (parsed !== null) return parsed;
  }
  return null;
}
function bool(value: unknown): number {
  return value ? 1 : 0;
}
function array(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
    if (p.agentId) {
      const now = event.timestamp;
      run(`INSERT OR IGNORE INTO agents (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`,
        text(p.agentId), text(p.agentName, text(p.agentId)), text(p.agentDescription, ''), now, now);
    }
    run(`UPDATE runs SET session_id=?, name=?, status='running', model=?, model_provider=?,
      prompt_version=?, skill_versions_json=?, tool_schema_version=?, runtime_version=?,
      context_strategy_version=?, metadata_json=? WHERE id=?`,
      event.sessionId ?? null, text(p.name, `Run ${event.runId}`), text(p.model) || null,
      text(p.modelProvider) || null, text(p.promptVersion) || null, json(p.skillVersions ?? []),
      text(p.toolSchemaVersion) || null, text(p.runtimeVersion) || null,
      text(p.contextStrategyVersion) || null, json(p), event.runId);
  }
  if (event.eventType === 'run.end' && event.runId) {
    const stats = object(p.stats);
    const tokenUsage = object(p.tokenUsage);
    const metadata = mergeRunMetadata(event.runId, p);
    run(`UPDATE runs SET status=?, ended_at=?, latency_ms=?, prompt_tokens=?, completion_tokens=?,
      total_tokens=?, score=COALESCE(?, score), error=?, metadata_json=? WHERE id=?`,
      text(p.status, 'success'), event.timestamp, firstNum(p.latencyMs, stats.totalDurationMs),
      firstNum(p.promptTokens, tokenUsage.promptTokens), firstNum(p.completionTokens, tokenUsage.completionTokens),
      firstNum(p.totalTokens, tokenUsage.totalTokens), num(p.score), text(p.error) || null, json(metadata), event.runId);
    if (event.sessionId) {
      run(`UPDATE sessions SET status=?, ended_at=? WHERE id=?`, text(p.status, 'success'), event.timestamp, event.sessionId);
    }
  }
}

function mergeRunMetadata(runId: string, payload: Record<string, unknown>): Record<string, unknown> {
  const row = get<{ metadata_json?: string }>(`SELECT metadata_json FROM runs WHERE id = ?`, runId);
  const previous = row?.metadata_json ? parseMetadata(row.metadata_json) : {};
  const previousNested = object(previous.metadata);
  const payloadNested = object(payload.metadata);
  return {
    ...previous,
    ...payload,
    ...(Object.keys(previousNested).length > 0 || Object.keys(payloadNested).length > 0
      ? { metadata: { ...previousNested, ...payloadNested } }
      : {}),
  };
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    return object(JSON.parse(raw));
  } catch (_) {
    return {};
  }
}

function getAgentIdForRun(runId: string, runToAgent: Map<string, string>): string | null {
  if (runToAgent.has(runId)) {
    return runToAgent.get(runId)!;
  }
  const row = get<{ metadata_json?: string }>(`SELECT metadata_json FROM runs WHERE id = ?`, runId);
  if (row?.metadata_json) {
    try {
      const meta = JSON.parse(row.metadata_json);
      if (meta && meta.agentId) {
        return String(meta.agentId);
      }
    } catch (_) {}
  }
  return null;
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

function mapContext(event: TraceEvent, runToAgent: Map<string, string>) {
  if (event.eventType !== 'context.build' || !event.runId) return;
  const p = event.payload;
  const snapshotId = text(p.contextSnapshotId, `${event.eventId}_context`);
  run(`INSERT OR REPLACE INTO context_snapshots (
    id, run_id, turn_id, llm_call_id, total_tokens, max_context_tokens, truncated, compressed,
    total_tokens_before_budget, total_tokens_after_budget, budget_strategy, reserved_output_tokens,
    risk_json, final_prompt_ref, final_prompt, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    snapshotId, event.runId, event.turnId ?? null, text(p.llmCallId) || null, num(p.totalTokens),
    num(p.maxContextTokens), bool(p.truncated), bool(p.compressed),
    num(p.totalTokensBeforeBudget), num(p.totalTokensAfterBudget), text(p.budgetStrategy) || null,
    num(p.reservedOutputTokens), json(p.risks ?? []), text(p.finalPromptRef) || null,
    text(p.finalPrompt) || null, event.timestamp);

  const agentId = getAgentIdForRun(event.runId, runToAgent);

  for (const segment of array(p.segments)) {
    run(`INSERT OR REPLACE INTO context_segments (
      id, snapshot_id, type, name, version, content_ref, preview, tokens, included, truncated,
      compressed, priority, reason, tokens_before, tokens_after, action, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      text(segment.id, randomUUID()), snapshotId, text(segment.type, 'unknown'), text(segment.name, 'Untitled'),
      text(segment.version) || null, text(segment.contentRef) || null, text(segment.preview) || null,
      num(segment.tokensAfter) ?? num(segment.tokens) ?? 0, bool(segment.included), bool(segment.truncated), bool(segment.compressed),
      num(segment.priority), text(segment.reason) || null, num(segment.tokensBefore) ?? num(segment.tokens),
      num(segment.tokensAfter) ?? num(segment.tokens), text(segment.action) || null, json(segment));

    if (segment.type === 'system_prompt') {
      const name = text(segment.name);
      const version = text(segment.version, '1.0.0');
      const content = text(segment.preview);
      if (name && name !== 'system-prompt') {
        const promptId = `${name}@${version}`;
        const now = event.timestamp;
        run(`INSERT OR IGNORE INTO prompts (id, name, version, content, created_at, agent_id, status, system_prompt, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)`,
          promptId, name, version, content, now, agentId, content, now);

        if (agentId) {
          run(`UPDATE agents SET default_prompt_id = ?, default_prompt_version_id = ? WHERE id = ? AND (default_prompt_id IS NULL OR default_prompt_id = '')`,
            name, promptId, agentId);
        }
      }
    }
  }
}

function mapSkillSelection(event: TraceEvent) {
  if (event.eventType !== 'skill.select' || !event.runId) return;
  const p = event.payload;
  run(`INSERT OR REPLACE INTO skill_selection_events VALUES (?, ?, ?, ?, ?, ?)`,
    event.eventId, event.runId, event.turnId ?? null,
    text(p.selectedSkillId) || text(p.selected_skill_id) || text(p.selected).replace(/@.*$/, ''),
    json(p.candidates ?? []), event.timestamp);
}

function mapPermissionDecision(event: TraceEvent) {
  if (event.eventType !== 'tool.policy.check' || !event.runId) return;
  const p = event.payload;
  run(`INSERT OR REPLACE INTO permission_decisions (
    id, run_id, tool_call_id, tool_id, risk_level, requested_permissions_json, decision,
    reason, policy_id, approved_by, arguments_summary_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    text(p.decisionId) || text(p.decision_id) || event.eventId, event.runId,
    text(p.toolCallId) || text(p.tool_call_id) || null, text(p.toolId) || text(p.tool_id) || 'unknown',
    text(p.riskLevel) || text(p.risk_level) || null, json(p.requestedPermissions ?? p.requested_permissions ?? []),
    text(p.decision, 'allow'), text(p.reason) || null, text(p.policyId) || text(p.policy_id) || null,
    text(p.approvedBy) || text(p.approved_by) || null, json(p.argumentsSummary ?? p.arguments_summary ?? {}),
    event.timestamp);
  if (text(p.decision) === 'approve') {
    run(`INSERT OR IGNORE INTO approvals (
      id, workspace_id, task_id, run_id, tool_call_id, risk_level, action_type,
      requested_action, reason, args_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      text(p.decisionId) || text(p.decision_id) || event.eventId,
      text(p.workspaceId) || text(p.workspace_id) || 'workspace_demo',
      text(p.taskId) || text(p.task_id) || null,
      event.runId,
      text(p.toolCallId) || text(p.tool_call_id) || null,
      text(p.riskLevel) || text(p.risk_level) || null,
      'tool_call',
      text(p.toolId) || text(p.tool_id) || 'unknown',
      text(p.reason) || null,
      json(p.argumentsSummary ?? p.arguments_summary ?? {}),
      'pending',
      event.timestamp);
  }
}

function mapFailure(event: TraceEvent) {
  if (event.eventType !== 'failure.detected' || !event.runId) return;
  const p = event.payload;
  const now = event.timestamp;
  run(`INSERT OR REPLACE INTO failures (
    id, run_id, eval_case_id, type, severity, summary, evidence_json, suggested_fix, status,
    skill_id, tool_id, first_seen_at, last_seen_at, occurrence_count, fixed_by_run_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    text(p.failureId) || text(p.failure_id) || event.eventId, event.runId,
    text(p.evalCaseId) || text(p.eval_case_id) || null, text(p.failureType) || text(p.failure_type) || 'model_reasoning_error',
    text(p.severity, 'medium'), text(p.summary) || text(p.error) || null, json(p.evidence ?? []),
    text(p.suggestedFix) || text(p.suggested_fix) || null, text(p.status, 'open'),
    text(p.skillId) || text(p.skill_id) || null, text(p.toolId) || text(p.tool_id) || null,
    now, now, 1, null, now, now);
}

function mapReplaySnapshot(event: TraceEvent) {
  if (event.eventType !== 'replay.snapshot.created' || !event.runId) return;
  const p = event.payload;
  run(`INSERT OR REPLACE INTO replay_snapshots VALUES (?, ?, ?, ?, ?)`,
    text(p.snapshotId) || text(p.snapshot_id) || event.eventId,
    event.runId, text(p.originalRunId) || text(p.original_run_id) || null,
    json(p.snapshot ?? p), event.timestamp);
}

interface SplitLLMState {
  request?: TraceEvent;
  usage?: TraceEvent;
}

interface SplitToolState {
  tool?: string;
  arguments?: unknown;
}

function splitKey(event: TraceEvent): string {
  return `${event.runId ?? ''}:${event.spanId ?? ''}`;
}

function toolKey(runId: string | undefined, toolCallId: string): string {
  return `${runId ?? ''}:${toolCallId}`;
}

function mapLLM(event: TraceEvent, splitLLM: Map<string, SplitLLMState>) {
  if (!event.runId) return;
  if (event.eventType === 'llm.call') {
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
    return;
  }
  if (event.eventType !== 'assistant.message') return;
  const p = event.payload;
  const split = splitLLM.get(splitKey(event));
  const requestPayload = object(split?.request?.payload);
  const usagePayload = object(object(split?.usage?.payload).usage);
  const promptTokens = firstNum(p.promptTokens, usagePayload.promptTokens);
  const completionTokens = firstNum(p.completionTokens, usagePayload.completionTokens);
  const totalTokens = firstNum(p.totalTokens, usagePayload.totalTokens,
    promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);
  const requestStartedAt = split?.request ? Date.parse(split.request.timestamp) : NaN;
  const assistantCompletedAt = Date.parse(event.timestamp);
  const latencyMs = Number.isFinite(requestStartedAt) && Number.isFinite(assistantCompletedAt)
    ? Math.max(0, assistantCompletedAt - requestStartedAt)
    : null;
  run(`INSERT OR REPLACE INTO llm_calls (
    id, run_id, turn_id, span_id, model, provider, temperature, max_output_tokens,
    prompt_tokens, completion_tokens, total_tokens, latency_ms, first_token_latency_ms,
    prefill_ms, decode_ms, tokens_per_second, context_snapshot_id, input_ref, output_json, cost, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    text(p.llmCallId) || `llm_${event.spanId ?? event.eventId}`, event.runId, event.turnId ?? null, event.spanId ?? null,
    text(requestPayload.model, 'unknown'), text(p.provider) || null, num(p.temperature), num(p.maxOutputTokens),
    promptTokens, completionTokens, totalTokens, latencyMs,
    num(p.firstTokenLatencyMs), num(p.prefillMs), num(p.decodeMs), num(p.tokensPerSecond),
    text(p.contextSnapshotId) || null, text(p.inputRef) || null, json({
      type: num(p.toolCallCount) && Number(p.toolCallCount) > 0 ? 'tool_call' : 'text',
      content: p.content,
      reasoning: p.reasoning,
      finishReason: p.finishReason,
      toolCallCount: p.toolCallCount
    }), num(p.cost), event.timestamp);
}

function mapTool(event: TraceEvent, splitTools: Map<string, SplitToolState>) {
  if (!event.runId) return;
  if (event.eventType !== 'tool.call' && event.eventType !== 'tool.call.end') return;
  const p = event.payload;
  const toolCallId = text(p.toolCallId, event.eventId);
  const split = splitTools.get(toolKey(event.runId, toolCallId));
  const execution = event.eventType === 'tool.call.end'
    ? { latencyMs: p.latencyMs, success: p.success, exitCode: p.success ? 0 : 1 }
    : object(p.execution);
  run(`INSERT OR REPLACE INTO tool_calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    toolCallId, event.runId, event.turnId ?? null, event.spanId ?? null,
    text(p.tool) || split?.tool || 'unknown', text(p.reason) || null, json(p.arguments ?? split?.arguments ?? {}), json(p.permission),
    num(execution.latencyMs), bool(execution.success), num(execution.exitCode), text(p.stdoutRef) || null,
    text(p.stderrRef) || null, json(p.result ?? p.output ?? p.error), json(p.contextInjection), event.timestamp);
}

function buildSplitLLMIndex(events: TraceEvent[]): Map<string, SplitLLMState> {
  const result = new Map<string, SplitLLMState>();
  for (const event of events) {
    if (!event.runId || !event.spanId) continue;
    if (event.eventType !== 'llm.request.start' && event.eventType !== 'llm.usage') continue;
    const key = splitKey(event);
    const current = result.get(key) ?? {};
    if (event.eventType === 'llm.request.start') current.request = event;
    if (event.eventType === 'llm.usage') current.usage = event;
    result.set(key, current);
  }
  return result;
}

function buildSplitToolIndex(events: TraceEvent[]): Map<string, SplitToolState> {
  const result = new Map<string, SplitToolState>();
  for (const event of events) {
    if (!event.runId) continue;
    if (event.eventType === 'tool.batch.start') {
      for (const toolCall of array(event.payload.toolCalls)) {
        const id = text(toolCall.id);
        if (!id) continue;
        result.set(toolKey(event.runId, id), {
          tool: text(toolCall.name) || undefined,
          arguments: toolCall.arguments
        });
      }
    }
    if (event.eventType === 'tool.call.start') {
      const id = text(event.payload.toolCallId);
      if (!id) continue;
      const key = toolKey(event.runId, id);
      result.set(key, { ...(result.get(key) ?? {}), tool: text(event.payload.tool) || undefined });
    }
  }
  return result;
}

function mapArtifacts(event: TraceEvent) {
  if (event.eventType !== 'artifact.write' || !event.runId) return;
  for (const artifact of array(event.payload.artifacts)) {
    run(`INSERT OR REPLACE INTO artifacts (
      id, run_id, turn_id, workspace_id, task_id, tool_call_id, type, name, path,
      mime_type, sha256, checksum, size_bytes, generated_by, preview_available, is_final, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      text(artifact.id, randomUUID()), event.runId, event.turnId ?? null,
      text(artifact.workspaceId) || text(artifact.workspace_id) || null,
      text(artifact.taskId) || text(artifact.task_id) || null,
      text(artifact.toolCallId) || text(artifact.tool_call_id) || null,
      text(artifact.type, 'unknown'),
      text(artifact.name) || text(artifact.path).split('/').at(-1) || null,
      text(artifact.path),
      text(artifact.mimeType) || text(artifact.mime_type) || null,
      text(artifact.sha256) || null,
      text(artifact.checksum) || text(artifact.sha256) || null,
      num(artifact.sizeBytes),
      text(artifact.generatedBy) || text(artifact.generated_by) || 'runtime',
      bool(artifact.previewAvailable ?? artifact.preview_available ?? true),
      bool(artifact.isFinal ?? artifact.is_final ?? false),
      event.timestamp);
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
    const runToAgent = new Map<string, string>();
    const splitLLM = buildSplitLLMIndex(events);
    const splitTools = buildSplitToolIndex(events);
    for (const event of events) {
      if (event.eventType === 'run.start' && event.runId && event.payload?.agentId) {
        runToAgent.set(event.runId, String(event.payload.agentId));
      }
    }
    for (const event of events) {
      ensureParents(event);
      run(`INSERT OR REPLACE INTO raw_trace_events VALUES (?, ?, ?, ?, ?, ?)`,
        event.eventId, event.eventType, event.runId ?? null, event.timestamp, JSON.stringify(event), new Date().toISOString());
      mapRun(event);
      mapTurn(event);
      mapSpan(event);
      mapContext(event, runToAgent);
      mapSkillSelection(event);
      mapPermissionDecision(event);
      mapFailure(event);
      mapReplaySnapshot(event);
      mapLLM(event, splitLLM);
      mapTool(event, splitTools);
      mapArtifacts(event);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { importedEvents: events.length, runIds: [...new Set(events.flatMap((event) => event.runId ? [event.runId] : []))] };
}
