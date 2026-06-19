import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';

export type FailureStatus = 'open' | 'investigating' | 'fixed' | 'ignored';

export interface FailureInput {
  runId: string;
  evalCaseId?: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary?: string;
  evidence?: unknown[];
  suggestedFix?: string;
  skillId?: string;
  toolId?: string;
}

export function recordFailure(input: FailureInput) {
  const now = new Date().toISOString();
  const existing = get<{ id: string; occurrence_count: number }>(
    `SELECT id, occurrence_count FROM failures WHERE run_id=? AND IFNULL(eval_case_id, '')=? AND type=? AND IFNULL(tool_id, '')=? AND status IN ('open', 'investigating')`,
    input.runId, input.evalCaseId ?? '', input.type, input.toolId ?? ''
  );
  if (existing) {
    run(`UPDATE failures SET severity=?, summary=COALESCE(?, summary), evidence_json=?, suggested_fix=COALESCE(?, suggested_fix),
      skill_id=COALESCE(?, skill_id), last_seen_at=?, occurrence_count=?, updated_at=? WHERE id=?`,
    input.severity, input.summary ?? null, json(input.evidence ?? []), input.suggestedFix ?? null,
    input.skillId ?? null, now, Number(existing.occurrence_count ?? 1) + 1, now, existing.id);
    return getFailure(existing.id);
  }
  const id = `fail_${randomUUID()}`;
  run(`INSERT INTO failures (
    id, run_id, eval_case_id, type, severity, summary, evidence_json, suggested_fix, status,
    skill_id, tool_id, first_seen_at, last_seen_at, occurrence_count, fixed_by_run_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, 1, NULL, ?, ?)`,
  id, input.runId, input.evalCaseId ?? null, input.type, input.severity, input.summary ?? null,
  json(input.evidence ?? []), input.suggestedFix ?? null, input.skillId ?? null, input.toolId ?? null,
  now, now, now, now);
  return getFailure(id);
}

export function listFailures(filters: Record<string, unknown> = {}) {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [column, key] of [['status', 'status'], ['severity', 'severity'], ['type', 'type'], ['skill_id', 'skillId'], ['tool_id', 'toolId']] as const) {
    if (typeof filters[key] === 'string' && filters[key]) {
      clauses.push(`${column}=?`);
      params.push(filters[key]);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(`SELECT * FROM failures ${where} ORDER BY updated_at DESC`, ...params).map(normalizeFailure);
}

export function getFailure(id: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM failures WHERE id=?`, id);
  return row ? normalizeFailure(row) : undefined;
}

export function updateFailureStatus(id: string, status: FailureStatus, fixedByRunId?: string) {
  if (!['open', 'investigating', 'fixed', 'ignored'].includes(status)) throw new Error('不支持的 Failure 状态');
  if (!getFailure(id)) throw new Error('Failure 不存在');
  run(`UPDATE failures SET status=?, fixed_by_run_id=?, updated_at=? WHERE id=?`, status, fixedByRunId ?? null, new Date().toISOString(), id);
  return getFailure(id);
}

export function linkFailureFix(id: string, input: { promptVersion?: string; skillVersion?: string; toolVersion?: string; runId?: string; note?: string }) {
  const current = getFailure(id);
  if (!current) throw new Error('Failure 不存在');
  const links = [...(current.fixLinks ?? []), { ...input, linkedAt: new Date().toISOString() }];
  run(`UPDATE failures SET fix_links_json=?, fixed_by_run_id=COALESCE(?, fixed_by_run_id), status=CASE WHEN status='open' THEN 'investigating' ELSE status END, updated_at=? WHERE id=?`,
    json(links), input.runId ?? null, new Date().toISOString(), id);
  return getFailure(id);
}

export function failureStats() {
  const rows = all<{ status: string; severity: string; type: string; count: number }>(
    `SELECT status, severity, type, COUNT(*) AS count FROM failures GROUP BY status, severity, type ORDER BY count DESC`
  );
  return {
    total: rows.reduce((sum, item) => sum + Number(item.count ?? 0), 0),
    open: rows.filter((item) => item.status === 'open').reduce((sum, item) => sum + Number(item.count ?? 0), 0),
    byStatus: group(rows, 'status'),
    bySeverity: group(rows, 'severity'),
    byType: group(rows, 'type')
  };
}

function normalizeFailure(row: Record<string, unknown>) {
  return {
    id: row.id,
    runId: row.run_id,
    evalCaseId: row.eval_case_id,
    type: row.type,
    severity: row.severity,
    summary: row.summary,
    evidence: parseJson(row.evidence_json, []),
    suggestedFix: row.suggested_fix,
    status: row.status,
    skillId: row.skill_id,
    toolId: row.tool_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    occurrenceCount: Number(row.occurrence_count ?? 1),
    fixedByRunId: row.fixed_by_run_id,
    fixLinks: parseJson(row.fix_links_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function group(rows: Array<Record<string, unknown>>, key: string) {
  const result: Record<string, number> = {};
  for (const row of rows) result[String(row[key] ?? 'unknown')] = (result[String(row[key] ?? 'unknown')] ?? 0) + Number(row.count ?? 0);
  return result;
}
