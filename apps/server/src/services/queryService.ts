import { type SQLInputValue } from 'node:sqlite';
import { all, get, parseJson } from '../db/database.ts';

export function listRuns(filters: Record<string, unknown> = {}) {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  for (const [column, key] of [['status', 'status'], ['model', 'model'], ['prompt_version', 'promptVersion']] as const) {
    if (typeof filters[key] === 'string' && filters[key]) {
      clauses.push(`r.${column} = ?`);
      params.push(filters[key]);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(
    `SELECT r.*, s.title AS session_title,
      (SELECT COUNT(*) FROM tool_calls t WHERE t.run_id=r.id) AS tool_call_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.run_id=r.id) AS artifact_count
    FROM runs r LEFT JOIN sessions s ON s.id=r.session_id ${where}
    ORDER BY r.started_at DESC`, ...params
  ).map(normalizeRun);
}

export function normalizeRun(row: Record<string, unknown>) {
  return {
    id: row.id, sessionId: row.session_id, sessionTitle: row.session_title, turnId: row.turn_id,
    name: row.name, status: row.status, model: row.model, modelProvider: row.model_provider,
    promptVersion: row.prompt_version, skillVersions: parseJson(row.skill_versions_json, []),
    toolSchemaVersion: row.tool_schema_version, runtimeVersion: row.runtime_version,
    contextStrategyVersion: row.context_strategy_version, startedAt: row.started_at, endedAt: row.ended_at,
    latencyMs: row.latency_ms, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens, score: row.score, error: row.error,
    toolCallCount: Number(row.tool_call_count ?? 0), artifactCount: Number(row.artifact_count ?? 0),
    metadata: parseJson(row.metadata_json, {})
  };
}

export function getRun(runId: string) {
  const row = get<Record<string, unknown>>(
    `SELECT r.*, s.title AS session_title,
      (SELECT COUNT(*) FROM tool_calls t WHERE t.run_id=r.id) AS tool_call_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.run_id=r.id) AS artifact_count
    FROM runs r LEFT JOIN sessions s ON s.id=r.session_id WHERE r.id=?`, runId);
  return row ? normalizeRun(row) : undefined;
}

export function listSpans(runId: string) {
  return all<Record<string, unknown>>(`SELECT * FROM spans WHERE run_id=? ORDER BY started_at`, runId).map((row) => ({
    id: row.id, runId: row.run_id, parentId: row.parent_id, type: row.type, name: row.name,
    status: row.status, input: parseJson(row.input_json, null), output: parseJson(row.output_json, null),
    startedAt: row.started_at, endedAt: row.ended_at, latencyMs: row.latency_ms,
    error: row.error, metadata: parseJson(row.metadata_json, {})
  }));
}

export function listTools(runId?: string) {
  const rows = runId
    ? all<Record<string, unknown>>(`SELECT * FROM tool_calls WHERE run_id=? ORDER BY created_at`, runId)
    : all<Record<string, unknown>>(`SELECT * FROM tool_calls ORDER BY created_at DESC LIMIT 200`);
  return rows.map((row) => ({
    id: row.id, runId: row.run_id, turnId: row.turn_id, spanId: row.span_id, toolName: row.tool_name,
    reason: row.reason, arguments: parseJson(row.arguments_json, {}), permission: parseJson(row.permission_json, {}),
    latencyMs: row.latency_ms, success: Boolean(row.success), exitCode: row.exit_code,
    stdoutRef: row.stdout_ref, stderrRef: row.stderr_ref,
    result: parseJson(row.result_json, {}), contextInjection: parseJson(row.context_injection_json, {}),
    createdAt: row.created_at
  }));
}

export function listArtifacts(runId: string) {
  return all<Record<string, unknown>>(`SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at`, runId).map((row) => ({
    id: row.id, runId: row.run_id, turnId: row.turn_id, type: row.type, path: row.path,
    sha256: row.sha256, sizeBytes: row.size_bytes, createdAt: row.created_at
  }));
}
