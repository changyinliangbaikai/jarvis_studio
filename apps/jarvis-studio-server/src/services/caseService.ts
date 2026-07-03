import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';
import { getAgent } from './agentService.ts';
import { getPrompt, testPrompt } from './promptService.ts';
import { getRun, listTools } from './queryService.ts';

type AssertionType = 'manual' | 'keyword' | 'json_schema' | 'tool_call' | 'llm_judge';
type CaseStatus = 'active' | 'disabled' | 'archived';
type CasePriority = 'P0' | 'P1' | 'P2';

export interface CaseInput {
  agentId: string;
  sourceRunId?: string;
  sourceTraceId?: string;
  promptVersionId?: string;
  name: string;
  description?: string;
  input: string;
  context?: unknown;
  expectedOutput?: string;
  assertionType?: AssertionType;
  assertionConfig?: unknown;
  priority?: CasePriority;
  status?: CaseStatus;
  tags?: string[];
}

export interface CaseFromRunInput extends Partial<Omit<CaseInput, 'agentId' | 'input'>> {
  agentId?: string;
  input?: string;
}

export interface CaseRunInput {
  promptVersionId?: string;
  modelProviderId?: string;
  modelName?: string;
  contextStrategy?: string;
  toolPolicy?: string;
}

let caseSchemaEnsured = false;

function ensureCaseSchema() {
  if (caseSchemaEnsured) return;
  run(`CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    source_run_id TEXT,
    source_trace_id TEXT,
    prompt_version_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    input TEXT NOT NULL,
    context_json TEXT,
    expected_output TEXT,
    assertion_type TEXT NOT NULL DEFAULT 'manual',
    assertion_config_json TEXT,
    priority TEXT NOT NULL DEFAULT 'P1',
    status TEXT NOT NULL DEFAULT 'active',
    tags_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS case_run_results (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    passed INTEGER,
    assertion_type TEXT NOT NULL,
    assertion_summary_json TEXT,
    output TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_cases_agent ON cases(agent_id, status, updated_at DESC)`);
  run(`CREATE INDEX IF NOT EXISTS idx_cases_source_run ON cases(source_run_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_case_results_case ON case_run_results(case_id, created_at DESC)`);
  caseSchemaEnsured = true;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeCase(row: Record<string, unknown>) {
  const latest = get<Record<string, unknown>>(
    `SELECT * FROM case_run_results WHERE case_id=? ORDER BY created_at DESC LIMIT 1`,
    String(row.id)
  );
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    agentName: text(row.agent_name),
    sourceRunId: text(row.source_run_id),
    sourceTraceId: text(row.source_trace_id),
    promptVersionId: text(row.prompt_version_id),
    name: String(row.name),
    description: text(row.description),
    input: String(row.input ?? ''),
    context: parseJson(row.context_json, {}),
    expectedOutput: text(row.expected_output),
    assertionType: String(row.assertion_type) as AssertionType,
    assertionConfig: parseJson(row.assertion_config_json, {}),
    priority: String(row.priority) as CasePriority,
    status: String(row.status) as CaseStatus,
    tags: parseJson<string[]>(row.tags_json, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    latestResult: latest ? normalizeCaseRunResult(latest) : undefined
  };
}

function normalizeCaseRunResult(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    runId: String(row.run_id),
    status: String(row.status),
    passed: row.passed == null ? null : Boolean(row.passed),
    assertionType: String(row.assertion_type),
    assertionSummary: parseJson(row.assertion_summary_json, {}),
    output: text(row.output),
    error: text(row.error),
    createdAt: String(row.created_at)
  };
}

export function listCases(filters: Record<string, unknown> = {}) {
  ensureCaseSchema();
  const clauses: string[] = [];
  const params: string[] = [];
  if (typeof filters.agentId === 'string' && filters.agentId) {
    clauses.push('c.agent_id = ?');
    params.push(filters.agentId);
  }
  if (typeof filters.priority === 'string' && filters.priority) {
    clauses.push('c.priority = ?');
    params.push(filters.priority);
  }
  if (typeof filters.status === 'string' && filters.status) {
    clauses.push('c.status = ?');
    params.push(filters.status);
  }
  if (typeof filters.assertionType === 'string' && filters.assertionType) {
    clauses.push('c.assertion_type = ?');
    params.push(filters.assertionType);
  }
  if (typeof filters.keyword === 'string' && filters.keyword) {
    clauses.push('(c.name LIKE ? OR c.description LIKE ? OR c.input LIKE ? OR c.expected_output LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(
    `SELECT c.*, a.name AS agent_name FROM cases c LEFT JOIN agents a ON a.id=c.agent_id ${where} ORDER BY c.updated_at DESC`,
    ...params
  ).map(normalizeCase);
}

export function getCase(id: string) {
  ensureCaseSchema();
  const row = get<Record<string, unknown>>(
    `SELECT c.*, a.name AS agent_name FROM cases c LEFT JOIN agents a ON a.id=c.agent_id WHERE c.id=?`,
    id
  );
  return row ? normalizeCase(row) : undefined;
}

export function createCase(input: CaseInput) {
  ensureCaseSchema();
  if (!getAgent(input.agentId)) throw new Error('Agent 不存在');
  const now = new Date().toISOString();
  const id = `case_${randomUUID()}`;
  run(`INSERT INTO cases (
    id, agent_id, source_run_id, source_trace_id, prompt_version_id, name, description,
    input, context_json, expected_output, assertion_type, assertion_config_json,
    priority, status, tags_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.agentId,
    input.sourceRunId ?? null,
    input.sourceTraceId ?? null,
    input.promptVersionId ?? null,
    input.name,
    input.description ?? null,
    input.input,
    json(input.context ?? {}),
    input.expectedOutput ?? null,
    input.assertionType ?? 'manual',
    json(input.assertionConfig ?? {}),
    input.priority ?? 'P1',
    input.status ?? 'active',
    json(input.tags ?? []),
    now,
    now
  );
  return getCase(id)!;
}

export function updateCase(id: string, input: Partial<CaseInput>) {
  ensureCaseSchema();
  const current = getCase(id);
  if (!current) throw new Error('Case 不存在');
  const now = new Date().toISOString();
  run(`UPDATE cases SET agent_id=?, source_run_id=?, source_trace_id=?, prompt_version_id=?,
    name=?, description=?, input=?, context_json=?, expected_output=?, assertion_type=?,
    assertion_config_json=?, priority=?, status=?, tags_json=?, updated_at=? WHERE id=?`,
    input.agentId ?? current.agentId,
    input.sourceRunId ?? current.sourceRunId ?? null,
    input.sourceTraceId ?? current.sourceTraceId ?? null,
    input.promptVersionId ?? current.promptVersionId ?? null,
    input.name ?? current.name,
    input.description ?? current.description ?? null,
    input.input ?? current.input,
    json(input.context ?? current.context ?? {}),
    input.expectedOutput ?? current.expectedOutput ?? null,
    input.assertionType ?? current.assertionType,
    json(input.assertionConfig ?? current.assertionConfig ?? {}),
    input.priority ?? current.priority,
    input.status ?? current.status,
    json(input.tags ?? current.tags ?? []),
    now,
    id
  );
  return getCase(id)!;
}

export function archiveCase(id: string) {
  return updateCase(id, { status: 'disabled' });
}

function summarizeInput(input: string) {
  const compact = input.replace(/\s+/g, ' ').trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || '未命名 Case';
}

export function createCaseFromRun(runId: string, input: CaseFromRunInput = {}) {
  ensureCaseSchema();
  const sourceRun = getRun(runId);
  if (!sourceRun) throw new Error('Run 不存在');
  const agentId = input.agentId ?? text(sourceRun.agentId) ?? text(sourceRun.metadata?.agentId);
  if (!agentId) throw new Error('Run 未记录 Agent，无法自动转 Case');
  const userInput = input.input ?? text(sourceRun.userInput) ?? text(sourceRun.metadata?.userInput);
  if (!userInput) throw new Error('Run 未记录用户输入，无法自动转 Case');
  const finalOutput = input.expectedOutput ?? text(sourceRun.finalOutput) ?? text(sourceRun.metadata?.finalOutput);
  return createCase({
    agentId,
    sourceRunId: runId,
    sourceTraceId: input.sourceTraceId ?? runId,
    promptVersionId: input.promptVersionId ?? text(sourceRun.promptVersionId) ?? text(sourceRun.metadata?.promptVersionId),
    name: input.name ?? `Trace Case · ${summarizeInput(userInput)}`,
    description: input.description ?? `由 Run ${runId} 转换`,
    input: userInput,
    context: input.context ?? { source: 'run', promptVersion: sourceRun.promptVersion },
    expectedOutput: finalOutput,
    assertionType: input.assertionType ?? 'manual',
    assertionConfig: input.assertionConfig ?? {},
    priority: input.priority ?? 'P1',
    status: input.status ?? 'active',
    tags: input.tags ?? []
  });
}

export function runCase(caseId: string, options: CaseRunInput = {}) {
  ensureCaseSchema();
  const item = getCase(caseId);
  if (!item) throw new Error('Case 不存在');
  const agent = getAgent(item.agentId);
  if (!agent) throw new Error('Agent 不存在');
  const promptVersionId = options.promptVersionId ?? item.promptVersionId ?? agent.defaultPromptVersionId ?? agent.defaultPromptId;
  if (!promptVersionId || !getPrompt(promptVersionId)) throw new Error('Case 运行前需要可用 Prompt Version');
  const result = testPrompt(promptVersionId, {}, item.input, {
    ...options,
    source: 'case'
  });
  const assertion = evaluateAssertion(item, result.runId, result.response);
  const now = new Date().toISOString();
  const id = `case_result_${randomUUID()}`;
  run(`INSERT INTO case_run_results (
    id, case_id, run_id, status, passed, assertion_type, assertion_summary_json,
    output, error, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    item.id,
    result.runId,
    assertion.status,
    assertion.passed == null ? null : assertion.passed ? 1 : 0,
    item.assertionType,
    json(assertion.summary),
    result.response,
    assertion.error ?? null,
    now
  );
  return normalizeCaseRunResult(get<Record<string, unknown>>(`SELECT * FROM case_run_results WHERE id=?`, id)!);
}

function evaluateAssertion(item: ReturnType<typeof getCase> extends infer T ? NonNullable<T> : never, runId: string, output: string) {
  if (item.assertionType === 'manual' || item.assertionType === 'llm_judge') {
    return { status: 'pending_review', passed: null, summary: { message: '需要人工复核' } };
  }
  if (item.assertionType === 'keyword') {
    const config = item.assertionConfig as { mustInclude?: string[]; mustNotInclude?: string[]; caseSensitive?: boolean; matchMode?: 'all' | 'any' };
    const haystack = config.caseSensitive ? output : output.toLowerCase();
    const normalize = (value: string) => config.caseSensitive ? value : value.toLowerCase();
    const mustInclude = (config.mustInclude ?? []).filter(Boolean);
    const mustNotInclude = (config.mustNotInclude ?? []).filter(Boolean);
    const includeHits = mustInclude.filter((keyword) => haystack.includes(normalize(keyword)));
    const excludeHits = mustNotInclude.filter((keyword) => haystack.includes(normalize(keyword)));
    const includePassed = config.matchMode === 'any' && mustInclude.length
      ? includeHits.length > 0
      : includeHits.length === mustInclude.length;
    const passed = includePassed && excludeHits.length === 0;
    return {
      status: passed ? 'passed' : 'failed',
      passed,
      summary: { mustInclude, includeHits, mustNotInclude, excludeHits }
    };
  }
  if (item.assertionType === 'json_schema') {
    try {
      JSON.parse(output);
      return { status: 'passed', passed: true, summary: { validJson: true } };
    } catch (error) {
      return { status: 'failed', passed: false, summary: { validJson: false }, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (item.assertionType === 'tool_call') {
    const config = item.assertionConfig as { mustCall?: string[]; mustNotCall?: string[]; minCalls?: number; maxCalls?: number };
    const tools = listTools(runId);
    const names = tools.map((tool) => tool.toolName);
    const mustCall = config.mustCall ?? [];
    const mustNotCall = config.mustNotCall ?? [];
    const missing = mustCall.filter((tool) => !names.includes(tool));
    const forbidden = mustNotCall.filter((tool) => names.includes(tool));
    const count = names.length;
    const passed = missing.length === 0
      && forbidden.length === 0
      && (config.minCalls == null || count >= config.minCalls)
      && (config.maxCalls == null || count <= config.maxCalls);
    return { status: passed ? 'passed' : 'failed', passed, summary: { names, missing, forbidden, count } };
  }
  return { status: 'failed', passed: false, summary: {}, error: `不支持的断言类型: ${item.assertionType}` };
}
