import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';
import { getAgent } from './agentService.ts';
import { getPrompt } from './promptService.ts';
import { getCase, runCase } from './caseService.ts';

export interface EvalSuiteInput {
  agentId: string;
  name: string;
  description?: string;
  caseIds: string[];
  defaultAssertionMode?: string;
  tags?: string[];
}

export interface RunEvalSuiteInput {
  promptVersionId: string;
  modelProviderId?: string;
  modelName?: string;
  runScope?: 'all' | 'p0' | 'custom';
  caseIds?: string[];
  continueOnFailure?: boolean;
  maxParallel?: number;
}

let lightEvalSchemaEnsured = false;

function ensureLightEvalSchema() {
  if (lightEvalSchemaEnsured) return;
  run(`CREATE TABLE IF NOT EXISTS eval_suites (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    case_ids_json TEXT NOT NULL,
    default_assertion_mode TEXT,
    tags_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS eval_runs_light (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    prompt_version_id TEXT NOT NULL,
    model_provider_id TEXT,
    model TEXT,
    status TEXT NOT NULL,
    total_cases INTEGER NOT NULL DEFAULT 0,
    passed_cases INTEGER NOT NULL DEFAULT 0,
    failed_cases INTEGER NOT NULL DEFAULT 0,
    pass_rate REAL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    error TEXT
  )`);
  run(`CREATE TABLE IF NOT EXISTS eval_run_results_light (
    id TEXT PRIMARY KEY,
    eval_run_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL,
    passed INTEGER DEFAULT 0,
    assertion_type TEXT,
    output TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_eval_suites_agent ON eval_suites(agent_id, updated_at DESC)`);
  run(`CREATE INDEX IF NOT EXISTS idx_eval_runs_light_suite ON eval_runs_light(suite_id, started_at DESC)`);
  run(`CREATE INDEX IF NOT EXISTS idx_eval_results_light_run ON eval_run_results_light(eval_run_id, case_id)`);
  lightEvalSchemaEnsured = true;
}

function normalizeSuite(row: Record<string, unknown>) {
  const caseIds = parseJson<string[]>(row.case_ids_json, []);
  const latestRun = get<Record<string, unknown>>(
    `SELECT * FROM eval_runs_light WHERE suite_id=? ORDER BY started_at DESC LIMIT 1`,
    String(row.id)
  );
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    agentName: row.agent_name ? String(row.agent_name) : undefined,
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    caseIds,
    caseCount: caseIds.length,
    defaultAssertionMode: row.default_assertion_mode ? String(row.default_assertion_mode) : undefined,
    tags: parseJson<string[]>(row.tags_json, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    latestRun: latestRun ? normalizeEvalRun(latestRun, false) : undefined
  };
}

function normalizeEvalRun(row: Record<string, unknown>, includeResults = true) {
  const output = {
    id: String(row.id),
    suiteId: String(row.suite_id),
    agentId: String(row.agent_id),
    promptVersionId: String(row.prompt_version_id),
    modelProviderId: row.model_provider_id ? String(row.model_provider_id) : undefined,
    model: row.model ? String(row.model) : undefined,
    status: String(row.status),
    totalCases: Number(row.total_cases ?? 0),
    passedCases: Number(row.passed_cases ?? 0),
    failedCases: Number(row.failed_cases ?? 0),
    passRate: Number(row.pass_rate ?? 0),
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
    error: row.error ? String(row.error) : undefined
  };
  return {
    ...output,
    results: includeResults ? listEvalRunResults(output.id) : undefined
  };
}

function normalizeEvalRunResult(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    evalRunId: String(row.eval_run_id),
    caseId: String(row.case_id),
    runId: row.run_id ? String(row.run_id) : undefined,
    status: String(row.status),
    passed: Boolean(row.passed),
    assertionType: row.assertion_type ? String(row.assertion_type) : undefined,
    output: row.output ? String(row.output) : undefined,
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at)
  };
}

export function listEvalSuites(filters: Record<string, unknown> = {}) {
  ensureLightEvalSchema();
  const clauses: string[] = [];
  const params: string[] = [];
  if (typeof filters.agentId === 'string' && filters.agentId) {
    clauses.push('s.agent_id = ?');
    params.push(filters.agentId);
  }
  if (typeof filters.keyword === 'string' && filters.keyword) {
    clauses.push('(s.name LIKE ? OR s.description LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(
    `SELECT s.*, a.name AS agent_name FROM eval_suites s LEFT JOIN agents a ON a.id=s.agent_id ${where} ORDER BY s.updated_at DESC`,
    ...params
  ).map(normalizeSuite);
}

export function getEvalSuite(id: string) {
  ensureLightEvalSchema();
  const row = get<Record<string, unknown>>(
    `SELECT s.*, a.name AS agent_name FROM eval_suites s LEFT JOIN agents a ON a.id=s.agent_id WHERE s.id=?`,
    id
  );
  if (!row) return undefined;
  const suite = normalizeSuite(row);
  return {
    ...suite,
    cases: suite.caseIds.flatMap((caseId) => {
      const item = getCase(caseId);
      return item ? [item] : [];
    }),
    runs: listLightEvalRuns({ suiteId: suite.id })
  };
}

export function createEvalSuite(input: EvalSuiteInput) {
  ensureLightEvalSchema();
  if (!getAgent(input.agentId)) throw new Error('Agent 不存在');
  for (const caseId of input.caseIds) {
    const item = getCase(caseId);
    if (!item) throw new Error(`Case 不存在: ${caseId}`);
    if (item.agentId !== input.agentId) throw new Error(`Case 不属于当前 Agent: ${caseId}`);
  }
  const now = new Date().toISOString();
  const id = `suite_${randomUUID()}`;
  run(`INSERT INTO eval_suites (
    id, agent_id, name, description, case_ids_json, default_assertion_mode,
    tags_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.agentId,
    input.name,
    input.description ?? null,
    json(input.caseIds),
    input.defaultAssertionMode ?? 'manual',
    json(input.tags ?? []),
    now,
    now
  );
  return getEvalSuite(id)!;
}

export function updateEvalSuite(id: string, input: Partial<EvalSuiteInput>) {
  ensureLightEvalSchema();
  const current = getEvalSuite(id);
  if (!current) throw new Error('Eval Suite 不存在');
  const nextCaseIds = input.caseIds ?? current.caseIds;
  for (const caseId of nextCaseIds) {
    if (!getCase(caseId)) throw new Error(`Case 不存在: ${caseId}`);
  }
  const now = new Date().toISOString();
  run(`UPDATE eval_suites SET agent_id=?, name=?, description=?, case_ids_json=?,
    default_assertion_mode=?, tags_json=?, updated_at=? WHERE id=?`,
    input.agentId ?? current.agentId,
    input.name ?? current.name,
    input.description ?? current.description ?? null,
    json(nextCaseIds),
    input.defaultAssertionMode ?? current.defaultAssertionMode ?? 'manual',
    json(input.tags ?? current.tags ?? []),
    now,
    id
  );
  return getEvalSuite(id)!;
}

export function runEvalSuite(suiteId: string, input: RunEvalSuiteInput) {
  ensureLightEvalSchema();
  const suite = getEvalSuite(suiteId);
  if (!suite) throw new Error('Eval Suite 不存在');
  if (!getPrompt(input.promptVersionId)) throw new Error('Prompt Version 不存在');
  const now = new Date().toISOString();
  const evalRunId = `eval_light_${randomUUID()}`;
  const selectedCases = selectCasesForRun(suite.caseIds, input);
  run(`INSERT INTO eval_runs_light (
    id, suite_id, agent_id, prompt_version_id, model_provider_id, model, status,
    total_cases, passed_cases, failed_cases, pass_rate, started_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, 0, 0, 0, ?)`,
    evalRunId,
    suite.id,
    suite.agentId,
    input.promptVersionId,
    input.modelProviderId ?? null,
    input.modelName ?? null,
    selectedCases.length,
    now
  );
  let passedCases = 0;
  let failedCases = 0;
  for (const item of selectedCases) {
    try {
      const caseResult = runCase(item.id, {
        promptVersionId: input.promptVersionId,
        modelProviderId: input.modelProviderId,
        modelName: input.modelName
      });
      const passed = caseResult.passed === true;
      if (passed) passedCases += 1;
      else failedCases += 1;
      insertEvalRunResult(evalRunId, item.id, caseResult.runId, caseResult.status, passed, caseResult.assertionType, caseResult.output, caseResult.error);
      if (!passed && input.continueOnFailure === false) break;
    } catch (error) {
      failedCases += 1;
      insertEvalRunResult(evalRunId, item.id, undefined, 'error', false, item.assertionType, undefined, error instanceof Error ? error.message : String(error));
      if (input.continueOnFailure === false) break;
    }
  }
  const endedAt = new Date().toISOString();
  const passRate = selectedCases.length ? passedCases / selectedCases.length : 0;
  run(`UPDATE eval_runs_light SET status='completed', passed_cases=?, failed_cases=?,
    pass_rate=?, ended_at=? WHERE id=?`,
    passedCases,
    failedCases,
    passRate,
    endedAt,
    evalRunId
  );
  return getEvalRun(evalRunId)!;
}

function selectCasesForRun(caseIds: string[], input: RunEvalSuiteInput) {
  const selected = input.runScope === 'custom' && input.caseIds?.length ? input.caseIds : caseIds;
  return selected.flatMap((caseId) => {
    const item = getCase(caseId);
    if (!item || item.status !== 'active') return [];
    if (input.runScope === 'p0' && item.priority !== 'P0') return [];
    return [item];
  });
}

function insertEvalRunResult(evalRunId: string, caseId: string, runId: string | undefined, status: string, passed: boolean, assertionType?: string, output?: string, error?: string) {
  const now = new Date().toISOString();
  run(`INSERT INTO eval_run_results_light (
    id, eval_run_id, case_id, run_id, status, passed, assertion_type,
    output, error, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `eval_light_result_${randomUUID()}`,
    evalRunId,
    caseId,
    runId ?? null,
    status,
    passed ? 1 : 0,
    assertionType ?? null,
    output ?? null,
    error ?? null,
    now
  );
}

export function listLightEvalRuns(filters: Record<string, unknown> = {}) {
  ensureLightEvalSchema();
  const clauses: string[] = [];
  const params: string[] = [];
  if (typeof filters.suiteId === 'string' && filters.suiteId) {
    clauses.push('suite_id = ?');
    params.push(filters.suiteId);
  }
  if (typeof filters.agentId === 'string' && filters.agentId) {
    clauses.push('agent_id = ?');
    params.push(filters.agentId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(`SELECT * FROM eval_runs_light ${where} ORDER BY started_at DESC`, ...params)
    .map((row) => normalizeEvalRun(row, false));
}

export function getEvalRun(id: string) {
  ensureLightEvalSchema();
  const row = get<Record<string, unknown>>(`SELECT * FROM eval_runs_light WHERE id=?`, id);
  return row ? normalizeEvalRun(row) : undefined;
}

export function listEvalRunResults(evalRunId: string) {
  ensureLightEvalSchema();
  return all<Record<string, unknown>>(
    `SELECT * FROM eval_run_results_light WHERE eval_run_id=? ORDER BY created_at`,
    evalRunId
  ).map(normalizeEvalRunResult);
}
