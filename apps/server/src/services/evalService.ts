import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import YAML from 'yaml';
import { callModel, type ModelProfile, type RuntimeResult, type SkillDefinition } from '../../../../packages/jarvis-runtime-lite/src/index.ts';
import {
  evalCaseSchema,
  evalDatasetSchema,
  type EvalCase,
  type EvalDataset
} from '../../../../packages/eval-runner/src/evalCase.ts';
import { evaluateReleaseGate, issueTags, scoreRules, type RuleScore } from '../../../../packages/eval-runner/src/ruleScorer.ts';
import { all, get, json, parseJson, run, storageRoot } from '../db/database.ts';
import { executeRuntimeRun } from '../runtime/runtimeService.ts';
import { resolveModelProvider } from './modelProviderService.ts';
import { getRun } from './queryService.ts';

const reportsRoot = resolve(storageRoot, 'reports');
mkdirSync(reportsRoot, { recursive: true });

export interface CreateEvalRunInput {
  datasetId: string;
  name?: string;
  caseIds?: string[];
  modelProviderId?: string;
  modelName?: string;
  promptVersion?: string;
  skillVersion?: string;
  maxParallel?: number;
  retryCount?: number;
  timeoutSeconds?: number;
  enableLlmJudge?: boolean;
  judgeModelProviderId?: string;
  judgePromptVersion?: string;
  releaseGateId?: string;
  temperature?: number;
  matrix?: {
    modelProviderIds?: string[];
    modelNames?: string[];
    promptVersions?: string[];
    temperatures?: number[];
  };
}

interface EvalRunRow extends Record<string, unknown> {
  id: string;
  dataset_id: string;
  status: string;
  config_json: string;
}

interface CaseResultRow extends Record<string, unknown> {
  id: string;
  eval_run_id: string;
  eval_case_id: string;
}

function normalizeDatasetRow(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, version: row.version, category: row.category,
    description: row.description, owner: row.owner, filePath: row.file_path,
    caseCount: Number(row.case_count ?? 0), defaultRuntime: parseJson(row.default_runtime_json, {}),
    scoringProfile: row.scoring_profile, releaseGateId: row.release_gate_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
    latestRun: row.latest_run_id ? {
      id: row.latest_run_id, status: row.latest_run_status, passRate: row.latest_pass_rate,
      avgScore: row.latest_avg_score, createdAt: row.latest_run_created_at
    } : undefined
  };
}

function normalizeCase(row: Record<string, unknown>): EvalCase {
  return evalCaseSchema.parse({
    id: row.id,
    datasetId: row.dataset_id ?? undefined,
    name: row.name,
    category: row.category,
    priority: row.priority ?? 'p1',
    version: row.version ?? '1.0.0',
    tags: parseJson(row.tags_json, []),
    input: parseJson(row.input_json, {}),
    runtimeOverrides: parseJson(row.config_json, {}),
    expected: parseJson(row.expected_json, {}),
    scoring: parseJson(row.scoring_json, {}),
    passCriteria: parseJson(row.pass_criteria_json, { minTotalScore: 4, requiredChecks: [] }),
    filePath: row.file_path ?? undefined
  });
}

function normalizeEvalRun(row: Record<string, unknown>) {
  return {
    id: row.id, datasetId: row.dataset_id, datasetVersion: row.dataset_version, datasetName: row.dataset_name,
    name: row.name, status: row.status, modelProviderId: row.model_provider_id, modelName: row.model_name,
    modelConfig: parseJson(row.model_config_json, {}), promptVersion: row.prompt_version,
    skillVersion: row.skill_version, runtimeVersion: row.runtime_version, toolSchemaVersion: row.tool_schema_version,
    contextStrategyVersion: row.context_strategy_version, codeCommitHash: row.code_commit_hash,
    totalCases: Number(row.total_cases ?? 0), passedCases: Number(row.passed_cases ?? 0),
    failedCases: Number(row.failed_cases ?? 0), passRate: Number(row.pass_rate ?? 0),
    avgScore: Number(row.avg_score ?? 0), avgLatencyMs: Number(row.avg_latency_ms ?? 0),
    avgTotalTokens: Number(row.avg_total_tokens ?? 0), totalCost: Number(row.total_cost ?? 0),
    avgCostPerCase: Number(row.avg_cost_per_case ?? 0), currency: row.currency ?? 'USD',
    enableLlmJudge: Boolean(row.enable_llm_judge), judgeModelProviderId: row.judge_model_provider_id,
    judgePromptVersion: row.judge_prompt_version, releaseGateResultId: row.release_gate_result_id,
    reportPath: row.report_path, config: parseJson(row.config_json, {}), versionHashes: parseJson(row.version_hashes_json, {}),
    startedAt: row.started_at,
    endedAt: row.ended_at, error: row.error, createdAt: row.created_at
  };
}

function normalizeCaseResult(row: Record<string, unknown>) {
  return {
    id: row.id, evalRunId: row.eval_run_id, evalCaseId: row.eval_case_id, evalCaseName: row.eval_case_name,
    priority: row.priority, category: row.category, runId: row.run_id, status: row.status,
    passed: Boolean(row.passed), totalScore: Number(row.total_score ?? 0), ruleScore: Number(row.rule_score ?? 0),
    llmJudgeScore: row.llm_judge_score === null ? undefined : Number(row.llm_judge_score),
    humanScore: row.human_score === null ? undefined : Number(row.human_score),
    latencyMs: Number(row.latency_ms ?? 0), promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0), totalTokens: Number(row.total_tokens ?? 0),
    cost: Number(row.cost ?? 0), toolCallCount: Number(row.tool_call_count ?? 0),
    artifactCount: Number(row.artifact_count ?? 0), issueTags: parseJson<string[]>(row.issue_tags_json, []),
    ruleResults: parseJson<RuleScore | null>(row.rule_results_json, null),
    judgeResult: parseJson<Record<string, any> | null>(row.judge_result_json, null),
    humanReview: parseJson<Record<string, any> | null>(row.human_review_json, null), finalOutput: row.final_output,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function listEvalDatasets() {
  return all<Record<string, unknown>>(`SELECT d.*,
    (SELECT id FROM eval_runs r WHERE r.dataset_id=d.id ORDER BY r.created_at DESC LIMIT 1) AS latest_run_id,
    (SELECT status FROM eval_runs r WHERE r.dataset_id=d.id ORDER BY r.created_at DESC LIMIT 1) AS latest_run_status,
    (SELECT pass_rate FROM eval_runs r WHERE r.dataset_id=d.id ORDER BY r.created_at DESC LIMIT 1) AS latest_pass_rate,
    (SELECT avg_score FROM eval_runs r WHERE r.dataset_id=d.id ORDER BY r.created_at DESC LIMIT 1) AS latest_avg_score,
    (SELECT created_at FROM eval_runs r WHERE r.dataset_id=d.id ORDER BY r.created_at DESC LIMIT 1) AS latest_run_created_at
    FROM eval_datasets d ORDER BY d.updated_at DESC`).map(normalizeDatasetRow);
}

export function getEvalDataset(id: string) {
  const dataset = listEvalDatasets().find((item) => item.id === id);
  return dataset ? { ...dataset, cases: listEvalCases(id) } : undefined;
}

export function listEvalCases(datasetId?: string) {
  const rows = datasetId
    ? all<Record<string, unknown>>(`SELECT ec.*,
      (SELECT status FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_status,
      (SELECT passed FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_passed,
      (SELECT total_score FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_score,
      (SELECT issue_tags_json FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_issue_tags
      FROM eval_cases ec WHERE ec.dataset_id=? ORDER BY ec.priority, ec.id`, datasetId)
    : all<Record<string, unknown>>(`SELECT ec.*,
      (SELECT status FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_status,
      (SELECT passed FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_passed,
      (SELECT total_score FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_score,
      (SELECT issue_tags_json FROM eval_case_results r WHERE r.eval_case_id=ec.id ORDER BY r.created_at DESC LIMIT 1) AS latest_issue_tags
      FROM eval_cases ec ORDER BY ec.dataset_id, ec.priority, ec.id`);
  return rows.map((row) => ({
    ...normalizeCase(row),
    latestResult: row.latest_status ? {
      status: row.latest_status,
      passed: Boolean(row.latest_passed),
      score: Number(row.latest_score ?? 0),
      issueTags: parseJson<string[]>(row.latest_issue_tags, [])
    } : undefined
  }));
}

export function getEvalCase(id: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM eval_cases WHERE id=?`, id);
  if (!row) return undefined;
  const item = normalizeCase(row);
  const latest = get<Record<string, unknown>>(`SELECT ecr.*, er.name AS eval_run_name
    FROM eval_case_results ecr JOIN eval_runs er ON er.id=ecr.eval_run_id
    WHERE ecr.eval_case_id=? ORDER BY ecr.created_at DESC LIMIT 1`, id);
  return { ...item, latestResult: latest ? normalizeCaseResult(latest) : undefined };
}

export function saveEvalCase(raw: unknown, datasetId?: string, filePath?: string) {
  const item = evalCaseSchema.parse({ ...(raw as Record<string, unknown>), datasetId: datasetId ?? (raw as Record<string, unknown>)?.datasetId, filePath });
  const now = new Date().toISOString();
  run(`INSERT INTO eval_cases (
    id, dataset_id, name, category, priority, version, tags_json, input_json, config_json,
    expected_json, scoring_json, pass_criteria_json, file_path, release_gate_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  ON CONFLICT(id) DO UPDATE SET dataset_id=excluded.dataset_id, name=excluded.name,
    category=excluded.category, priority=excluded.priority, version=excluded.version,
    tags_json=excluded.tags_json, input_json=excluded.input_json, config_json=excluded.config_json,
    expected_json=excluded.expected_json, scoring_json=excluded.scoring_json,
    pass_criteria_json=excluded.pass_criteria_json, file_path=excluded.file_path, updated_at=excluded.updated_at`,
  item.id, item.datasetId ?? datasetId ?? null, item.name, item.category, item.priority, item.version,
  json(item.tags), json(item.input), json(item.runtimeOverrides), json(item.expected), json(item.scoring),
  json(item.passCriteria), item.filePath ?? filePath ?? null, now, now);
  return item;
}

export function importEvalYaml(content: string, datasetId = 'legacy_regression_v1') {
  ensureLegacyDataset(datasetId);
  const parsed = YAML.parse(content) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const saved = items.map((item) => saveEvalCase(item, datasetId));
  updateDatasetCaseCount(datasetId);
  return saved;
}

export function importEvalDatasetYaml(content: string, caseContents: string[] = [], filePath?: string) {
  const dataset = evalDatasetSchema.parse(YAML.parse(content)) as EvalDataset;
  const now = new Date().toISOString();
  run(`INSERT INTO eval_datasets (
    id, name, version, category, description, owner, file_path, case_count, default_runtime_json,
    scoring_profile, release_gate_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, category=excluded.category,
    description=excluded.description, owner=excluded.owner, file_path=excluded.file_path,
    default_runtime_json=excluded.default_runtime_json, scoring_profile=excluded.scoring_profile,
    release_gate_id=excluded.release_gate_id, updated_at=excluded.updated_at`,
  dataset.id, dataset.name, dataset.version, dataset.category, dataset.description, dataset.owner,
  filePath ?? null, json(dataset.defaultRuntime), dataset.scoringProfile ?? null, dataset.releaseGate ?? null, now, now);
  const rawCases: unknown[] = [...dataset.cases];
  for (const caseContent of caseContents) {
    const parsed = YAML.parse(caseContent) as unknown;
    rawCases.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const cases = rawCases.map((item) => saveEvalCase(item, dataset.id));
  updateDatasetCaseCount(dataset.id);
  return { dataset: getEvalDataset(dataset.id), cases };
}

export function importEvalDatasetDirectory(directory: string) {
  const datasetPath = resolve(directory, 'dataset.yaml');
  if (!existsSync(datasetPath)) throw new Error(`未找到 dataset.yaml: ${directory}`);
  const casesDirectory = resolve(directory, 'cases');
  const caseContents = existsSync(casesDirectory)
    ? readdirSync(casesDirectory).filter((name) => /\.ya?ml$/i.test(name)).sort()
      .map((name) => readFileSync(resolve(casesDirectory, name), 'utf8'))
    : [];
  return importEvalDatasetYaml(readFileSync(datasetPath, 'utf8'), caseContents, datasetPath);
}

export function reloadEvalDataset(id: string) {
  const row = get<{ file_path: string | null }>(`SELECT file_path FROM eval_datasets WHERE id=?`, id);
  if (!row?.file_path) throw new Error('此 Dataset 没有关联可重新加载的本地 dataset.yaml');
  return importEvalDatasetDirectory(resolve(row.file_path, '..'));
}

export function listEvalRuns() {
  return all<Record<string, unknown>>(`SELECT er.*, d.name AS dataset_name
    FROM eval_runs er LEFT JOIN eval_datasets d ON d.id=er.dataset_id ORDER BY er.created_at DESC`).map(normalizeEvalRun);
}

export function getEvalRun(id: string) {
  const row = get<Record<string, unknown>>(`SELECT er.*, d.name AS dataset_name
    FROM eval_runs er LEFT JOIN eval_datasets d ON d.id=er.dataset_id WHERE er.id=?`, id);
  if (!row) return undefined;
  return {
    ...normalizeEvalRun(row),
    results: listEvalRunResults(id),
    gateResult: getLatestGateResultForRun(id),
    failureStats: failureStats(id)
  };
}

export function listEvalRunResults(evalRunId: string) {
  return all<Record<string, unknown>>(`SELECT ecr.*, ec.name AS eval_case_name, ec.priority, ec.category
    FROM eval_case_results ecr JOIN eval_cases ec ON ec.id=ecr.eval_case_id
    WHERE ecr.eval_run_id=? ORDER BY ec.priority, ec.id`, evalRunId).map(normalizeCaseResult);
}

export function getEvalCaseResult(id: string) {
  const row = get<Record<string, unknown>>(`SELECT ecr.*, ec.name AS eval_case_name, ec.priority, ec.category
    FROM eval_case_results ecr JOIN eval_cases ec ON ec.id=ecr.eval_case_id WHERE ecr.id=?`, id);
  if (!row) return undefined;
  const result = normalizeCaseResult(row);
  return { ...result, evalCase: getEvalCase(String(row.eval_case_id)), evalRun: getEvalRunSummary(String(row.eval_run_id)) };
}

export function createEvalRuns(input: CreateEvalRunInput) {
  const combinations = matrixCombinations(input);
  if (combinations.length > 20) throw new Error(`矩阵组合数 ${combinations.length} 超过 max_matrix_runs=20`);
  const created = combinations.map((config) => createEvalRunRecord(config));
  for (const item of created) void executeEvalRun(String(item.id));
  return created;
}

function createEvalRunRecord(input: CreateEvalRunInput) {
  const dataset = get<Record<string, unknown>>(`SELECT * FROM eval_datasets WHERE id=?`, input.datasetId);
  if (!dataset) throw new Error('Eval Dataset 不存在');
  const selectedCases = input.caseIds?.length
    ? input.caseIds.length
    : Number(get<{ count: number }>(`SELECT COUNT(*) AS count FROM eval_cases WHERE dataset_id=?`, input.datasetId)?.count ?? 0);
  if (!selectedCases) throw new Error('Dataset 中没有可运行的 Eval Case');
  const provider = resolveModelProvider(input.modelProviderId);
  const id = `eval_run_${randomUUID()}`;
  const now = new Date().toISOString();
  const promptVersion = input.promptVersion ?? 'base-agent@v0.3';
  const modelName = input.modelName ?? provider.profile.model;
  const config = normalizedRunConfig(input);
  run(`INSERT INTO eval_runs (
    id, dataset_id, dataset_version, name, status, model_provider_id, model_name, model_config_json,
    prompt_version, skill_version, runtime_version, tool_schema_version, context_strategy_version,
    code_commit_hash, total_cases, currency, enable_llm_judge, judge_model_provider_id,
    judge_prompt_version, config_json, version_hashes_json, created_at
  ) VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  id, input.datasetId, String(dataset.version), input.name ?? `${String(dataset.name)} · ${modelName}`, provider.id, modelName,
  json({ ...provider.profile, apiKey: undefined, temperature: input.temperature ?? 0.2 }),
  promptVersion, input.skillVersion ?? null, 'jarvis-runtime-lite@0.3.0', 'jarvis-runtime-tools@v0.2',
  'segmented-snapshot@v0.2', process.env.CODE_COMMIT_HASH ?? null, selectedCases, provider.pricing.currency,
  input.enableLlmJudge ? 1 : 0, input.judgeModelProviderId ?? null, input.judgePromptVersion ?? 'category-auto@v1',
  json(config), json({
    modelConfigHash: versionHash({ ...provider.profile, apiKey: undefined, model: modelName, temperature: input.temperature ?? 0.2 }),
    promptHash: versionHash(promptVersion),
    skillHash: versionHash(input.skillVersion ?? 'case-defined'),
    toolSchemaHash: versionHash('jarvis-runtime-tools@v0.2'),
    contextStrategyHash: versionHash('segmented-snapshot@v0.2'),
    datasetHash: versionHash({ id: input.datasetId, version: dataset.version })
  }), now);
  return getEvalRunSummary(id)!;
}

export async function executeEvalRun(evalRunId: string) {
  const row = get<EvalRunRow>(`SELECT * FROM eval_runs WHERE id=?`, evalRunId);
  if (!row) throw new Error('Eval Run 不存在');
  if (!['created', 'failed'].includes(row.status)) return getEvalRun(evalRunId);
  const config = parseJson<CreateEvalRunInput>(row.config_json, { datasetId: row.dataset_id });
  const caseRows = config.caseIds?.length
    ? config.caseIds.map((id) => get<Record<string, unknown>>(`SELECT * FROM eval_cases WHERE id=? AND dataset_id=?`, id, row.dataset_id)).filter(Boolean)
    : all<Record<string, unknown>>(`SELECT * FROM eval_cases WHERE dataset_id=? ORDER BY priority, id`, row.dataset_id);
  const cases = caseRows.map((item) => normalizeCase(item!));
  run(`UPDATE eval_runs SET status='running', started_at=?, ended_at=NULL, error=NULL WHERE id=?`, new Date().toISOString(), evalRunId);
  try {
    await runWithConcurrency(cases, Math.min(Math.max(Number(config.maxParallel ?? 2), 1), 5), async (evalCase) => {
      if (get<{ status: string }>(`SELECT status FROM eval_runs WHERE id=?`, evalRunId)?.status === 'cancelled') return;
      await executeEvalCase(evalRunId, evalCase, config);
    });
    const status = get<{ status: string }>(`SELECT status FROM eval_runs WHERE id=?`, evalRunId)?.status;
    if (status !== 'cancelled') {
      run(`UPDATE eval_runs SET status='scoring' WHERE id=?`, evalRunId);
      recomputeEvalRunSummary(evalRunId);
      run(`UPDATE eval_runs SET status='completed', ended_at=? WHERE id=?`, new Date().toISOString(), evalRunId);
      if (config.releaseGateId) evaluateGate(config.releaseGateId, evalRunId);
    }
  } catch (error) {
    run(`UPDATE eval_runs SET status='failed', ended_at=?, error=? WHERE id=?`,
      new Date().toISOString(), error instanceof Error ? error.message : String(error), evalRunId);
  }
  return getEvalRun(evalRunId);
}

async function executeEvalCase(evalRunId: string, evalCase: EvalCase, config: CreateEvalRunInput) {
  const resultId = randomUUID();
  const now = new Date().toISOString();
  run(`INSERT OR REPLACE INTO eval_case_results (id, eval_run_id, eval_case_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?)`, resultId, evalRunId, evalCase.id, now, now);
  const provider = resolveModelProvider(config.modelProviderId);
  const runtimeOverrides = evalCase.runtimeOverrides;
  const effectiveProvider = typeof runtimeOverrides.providerId === 'string'
    ? resolveModelProvider(runtimeOverrides.providerId)
    : provider;
  const profile: ModelProfile = {
    ...effectiveProvider.profile,
    model: config.modelName ?? (typeof runtimeOverrides.model === 'string' ? runtimeOverrides.model : effectiveProvider.profile.model),
    temperature: config.temperature ?? Number(runtimeOverrides.temperature ?? 0.2)
  };
  try {
    const runtime = await executeRuntimeWithRetry(
      () => withTimeout(executeRuntimeRun({
        name: `Eval · ${evalCase.name}`,
        message: evalCase.input.message,
        skill: typeof runtimeOverrides.skill === 'string' ? runtimeOverrides.skill : config.skillVersion,
        files: evalCase.input.files.map((file) => file.path),
        promptVersion: config.promptVersion ?? 'base-agent@v0.3',
        modelProfile: profile
      }), Number(runtimeOverrides.timeoutSeconds ?? runtimeOverrides.timeout_seconds ?? config.timeoutSeconds ?? 120) * 1000),
      Number(runtimeOverrides.retryCount ?? runtimeOverrides.retry_count ?? config.retryCount ?? 0)
    );
    const runRecord = getRun(runtime.ids.runId);
    const selectedSkills = runtime.events.filter((event) => event.eventType === 'skill.select')
      .flatMap((event) => typeof event.payload.selected === 'string' ? [event.payload.selected] : []);
    const permissionDeniedCount = runtime.events.filter((event) =>
      event.eventType === 'permission.check' && event.payload.status === 'denied').length;
    const rule = scoreRules(evalCase, {
      output: runtime.output,
      selectedSkills,
      toolNames: runtime.toolCalls.map((tool) => tool.name),
      failedToolNames: runtime.toolCalls.filter((tool) => !tool.success).map((tool) => tool.name),
      artifacts: runtime.artifacts,
      latencyMs: Number(runRecord?.latencyMs ?? 0),
      permissionDeniedCount
    });
    let judge;
    if (config.enableLlmJudge) {
      try {
        judge = await scoreWithJudge(evalCase, runtime, config);
      } catch (error) {
        judge = { judgeError: error instanceof Error ? error.message : String(error), promptVersion: config.judgePromptVersion ?? judgePromptFor(evalCase.category).version };
      }
    }
    const scores = [rule.score, judge?.score].filter((score): score is number => typeof score === 'number');
    const totalScore = average(scores);
    const passed = runtime.status === 'success' && rule.pass && totalScore >= evalCase.passCriteria.minTotalScore;
    const promptTokens = Number(runRecord?.promptTokens ?? 0) + Number(judge?.usage?.promptTokens ?? 0);
    const completionTokens = Number(runRecord?.completionTokens ?? 0) + Number(judge?.usage?.completionTokens ?? 0);
    const runtimeCost = calculateCost(Number(runRecord?.promptTokens ?? 0), Number(runRecord?.completionTokens ?? 0), effectiveProvider.pricing);
    const cost = runtimeCost + Number(judge?.cost ?? 0);
    run(`UPDATE eval_case_results SET run_id=?, status=?, passed=?, total_score=?, rule_score=?,
      llm_judge_score=?, latency_ms=?, prompt_tokens=?, completion_tokens=?, total_tokens=?, cost=?,
      tool_call_count=?, artifact_count=?, issue_tags_json=?, rule_results_json=?, judge_result_json=?,
      final_output=?, error=?, updated_at=? WHERE id=?`,
    runtime.ids.runId, runtime.status === 'success' ? 'completed' : 'failed', passed ? 1 : 0, totalScore, rule.score,
    judge?.score ?? null, Number(runRecord?.latencyMs ?? 0), promptTokens, completionTokens, promptTokens + completionTokens,
    cost, runtime.toolCalls.length, runtime.artifacts.length, json(rule.issueTags), json(rule), json(judge),
    runtime.output, runtime.error ?? null, new Date().toISOString(), resultId);
    run(`UPDATE runs SET score=? WHERE id=?`, totalScore, runtime.ids.runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tag = /timeout/i.test(message) ? 'model_timeout' : 'model_error';
    run(`UPDATE eval_case_results SET status='failed', passed=0, issue_tags_json=?, error=?, updated_at=? WHERE id=?`,
      json([tag]), message, new Date().toISOString(), resultId);
  }
}

async function scoreWithJudge(evalCase: EvalCase, runtime: RuntimeResult, config: CreateEvalRunInput) {
  const provider = resolveModelProvider(config.judgeModelProviderId ?? config.modelProviderId);
  const categoryPrompt = judgePromptFor(evalCase.category);
  const promptVersion = config.judgePromptVersion ?? categoryPrompt.version;
  if (provider.profile.provider === 'deterministic') {
    const completeness = evalCase.expected.mustInclude.length
      ? evalCase.expected.mustInclude.filter((text) => runtime.output.includes(text)).length / evalCase.expected.mustInclude.length
      : 1;
    const score = Number((3.5 + completeness * 1.5).toFixed(2));
    return {
      score, passed: score >= evalCase.passCriteria.minTotalScore,
      dimensionScores: Object.fromEntries(evalCase.scoring.dimensions.map((item) => [item.name, score])),
      strengths: completeness === 1 ? ['满足内容完整性要求'] : [],
      weaknesses: completeness < 1 ? ['部分预期内容缺失'] : [],
      reason: 'Deterministic Judge 根据固定 rubric 完成结构化评分。',
      promptVersion,
      model: provider.profile.model,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: 0,
      currency: provider.pricing.currency
    };
  }
  const prompt = JSON.stringify({
    instruction: categoryPrompt.instruction,
    caseName: evalCase.name,
    userInput: evalCase.input.message,
    expected: evalCase.expected,
    finalAnswer: runtime.output,
    artifactsSummary: runtime.artifacts,
    rubric: evalCase.scoring
  });
  const response = await callModel({
    profile: provider.profile,
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    skill: judgeSkill,
    completedTools: [],
    files: []
  });
  const parsed = parseJudgeJson(response.content);
  const score = Math.min(5, Math.max(1, Number(parsed.score ?? 1)));
  return {
    score,
    passed: Boolean(parsed.passed ?? score >= evalCase.passCriteria.minTotalScore),
    dimensionScores: parsed.dimension_scores ?? parsed.dimensionScores ?? {},
    strengths: parsed.strengths ?? [],
    weaknesses: parsed.weaknesses ?? [],
    reason: parsed.reason ?? 'Judge 未提供原因',
    promptVersion,
    model: response.model,
    usage: response.usage,
    cost: calculateCost(response.usage.promptTokens, response.usage.completionTokens, provider.pricing),
    currency: provider.pricing.currency
  };
}

function judgePromptFor(category: string) {
  if (category === 'data-analysis') {
    return { version: 'data-analysis-judge@v1', instruction: '你是数据分析质量 Judge。评价事实性、分析口径、可执行建议和格式质量；不评价工具链。输出严格 JSON，score 为 1-5。' };
  }
  if (category === 'coding') {
    return { version: 'code-review-judge@v1', instruction: '你是代码审查质量 Judge。评价具体性、风险优先级、正确性和测试建议；不评价工具链。输出严格 JSON，score 为 1-5。' };
  }
  return { version: 'office-writing-judge@v1', instruction: '你是办公材料质量 Judge。评价事实准确、结构完整、表达清晰和可执行性；不评价工具链。输出严格 JSON，score 为 1-5。' };
}

const judgeSkill: SkillDefinition = {
  id: 'eval-judge', name: 'Eval Judge', version: 'v1', description: 'Score final answer quality.',
  systemPrompt: 'Return only structured JSON.', instructions: 'Score from 1 to 5.', requiredTools: [], permissions: []
};

function parseJudgeJson(content: string): Record<string, any> {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM Judge 未返回 JSON');
  try {
    return JSON.parse(match[0]) as Record<string, any>;
  } catch {
    throw new Error('LLM Judge 返回 JSON 解析失败');
  }
}

export function cancelEvalRun(id: string) {
  const item = get<{ status: string }>(`SELECT status FROM eval_runs WHERE id=?`, id);
  if (!item) throw new Error('Eval Run 不存在');
  if (['completed', 'failed', 'cancelled'].includes(item.status)) return getEvalRun(id);
  run(`UPDATE eval_runs SET status='cancelled', ended_at=? WHERE id=?`, new Date().toISOString(), id);
  return getEvalRun(id);
}

export async function rescoreEvalRun(id: string) {
  const results = listEvalRunResults(id);
  for (const result of results) {
    if (!result.runId) continue;
    const evalCase = getEvalCase(String(result.evalCaseId));
    const runtimeRun = getRun(String(result.runId));
    if (!evalCase || !runtimeRun) continue;
    const toolRows = all<Record<string, unknown>>(`SELECT tool_name, success FROM tool_calls WHERE run_id=?`, String(result.runId));
    const artifactRows = all<Record<string, unknown>>(`SELECT type, path FROM artifacts WHERE run_id=?`, String(result.runId));
    const selected = all<{ raw_json: string }>(`SELECT raw_json FROM raw_trace_events WHERE run_id=? AND event_type='skill.select'`, String(result.runId))
      .flatMap((row) => {
        const value = parseJson<{ payload?: { selected?: string } }>(row.raw_json, {});
        return value.payload?.selected ? [value.payload.selected] : [];
      });
    const rule = scoreRules(evalCase, {
      output: String(result.finalOutput ?? ''),
      selectedSkills: selected,
      toolNames: toolRows.map((item) => String(item.tool_name)),
      failedToolNames: toolRows.filter((item) => !item.success).map((item) => String(item.tool_name)),
      artifacts: artifactRows.map((item) => ({ type: String(item.type), path: String(item.path) })),
      latencyMs: Number(runtimeRun.latencyMs ?? 0)
    });
    const scores = [rule.score, result.llmJudgeScore, result.humanScore].filter((score): score is number => typeof score === 'number');
    const totalScore = average(scores);
    run(`UPDATE eval_case_results SET total_score=?, rule_score=?, passed=?, issue_tags_json=?,
      rule_results_json=?, updated_at=? WHERE id=?`, totalScore, rule.score,
    rule.pass && totalScore >= evalCase.passCriteria.minTotalScore ? 1 : 0, json(rule.issueTags), json(rule), new Date().toISOString(), String(result.id));
  }
  recomputeEvalRunSummary(id);
  return getEvalRun(id);
}

export function saveHumanReview(resultId: string, input: { score: number; issueTags?: string[]; comment?: string; reviewer?: string }) {
  const row = get<CaseResultRow>(`SELECT * FROM eval_case_results WHERE id=?`, resultId);
  if (!row) throw new Error('Eval Case Result 不存在');
  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 1 || score > 5) throw new Error('人工评分必须在 1-5 之间');
  const tags = [...new Set(input.issueTags ?? [])];
  if (tags.some((tag) => !issueTags.includes(tag as typeof issueTags[number]))) throw new Error('包含不支持的问题标签');
  const current = normalizeCaseResult(row);
  const review = { score, issueTags: tags, comment: input.comment?.trim() ?? '', reviewer: input.reviewer?.trim() || 'developer', reviewedAt: new Date().toISOString() };
  const totalScore = average([current.ruleScore, current.llmJudgeScore, score].filter((value): value is number => typeof value === 'number'));
  const evalCase = getEvalCase(row.eval_case_id);
  const rulePassed = Boolean((current.ruleResults as RuleScore | undefined)?.pass);
  run(`UPDATE eval_case_results SET human_score=?, total_score=?, passed=?, issue_tags_json=?,
    human_review_json=?, updated_at=? WHERE id=?`, score, totalScore,
  rulePassed && totalScore >= Number(evalCase?.passCriteria.minTotalScore ?? 4) ? 1 : 0,
  json([...new Set([...current.issueTags, ...tags])]), json(review), new Date().toISOString(), resultId);
  recomputeEvalRunSummary(row.eval_run_id);
  return getEvalCaseResult(resultId);
}

export function importReleaseGateYaml(content: string, filePath?: string) {
  const parsed = YAML.parse(content) as Record<string, unknown>;
  if (!parsed?.id || !parsed?.name || !parsed?.version || !parsed?.criteria) throw new Error('Release Gate YAML 缺少 id/name/version/criteria');
  const now = new Date().toISOString();
  run(`INSERT INTO release_gates (id, name, version, scope_json, criteria_json, required_p0_json,
    on_failure_json, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, scope_json=excluded.scope_json,
    criteria_json=excluded.criteria_json, required_p0_json=excluded.required_p0_json,
    on_failure_json=excluded.on_failure_json, file_path=excluded.file_path, updated_at=excluded.updated_at`,
  String(parsed.id), String(parsed.name), String(parsed.version), json(parsed.scope ?? {}), json(parsed.criteria),
  json(parsed.required_p0_cases ?? {}), json(parsed.on_failure ?? {}), filePath ?? null, now, now);
  return getReleaseGate(String(parsed.id));
}

export function listReleaseGates() {
  return all<Record<string, unknown>>(`SELECT * FROM release_gates ORDER BY updated_at DESC`).map(normalizeGate);
}

export function getReleaseGate(id: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM release_gates WHERE id=?`, id);
  return row ? normalizeGate(row) : undefined;
}

function normalizeGate(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, version: row.version, scope: parseJson(row.scope_json, {}),
    criteria: parseJson(row.criteria_json, {}), requiredP0Cases: parseJson(row.required_p0_json, {}),
    onFailure: parseJson(row.on_failure_json, {}), filePath: row.file_path,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function evaluateGate(gateId: string, evalRunId: string) {
  const gate = getReleaseGate(gateId);
  const evalRun = getEvalRunSummary(evalRunId);
  if (!gate || !evalRun) throw new Error('Release Gate 或 Eval Run 不存在');
  const results = listEvalRunResults(evalRunId);
  const metrics = aggregateGateMetrics(evalRun, results);
  const evaluated = evaluateReleaseGate(metrics, gate.criteria as Record<string, unknown>);
  const p0 = results.filter((item) => item.priority === 'p0');
  const requiredP0Rate = Number((gate.requiredP0Cases as Record<string, unknown>).pass_rate ?? 0);
  if (requiredP0Rate > 0) {
    const actual = p0.length ? p0.filter((item) => item.passed).length / p0.length : 1;
    const check = { name: 'required_p0_cases', metricKey: 'p0PassRate', label: 'P0 用例通过率', expected: `>= ${requiredP0Rate}`, actual, target: requiredP0Rate, passed: actual >= requiredP0Rate };
    (evaluated.checks as Array<Record<string, unknown>>).push(check);
    if (!check.passed) (evaluated.failedCriteria as Array<Record<string, unknown>>).push(check);
    evaluated.passed = evaluated.passed && check.passed;
  }
  const id = randomUUID();
  run(`INSERT INTO release_gate_results VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    id, gateId, evalRunId, evaluated.passed ? 1 : 0, json(metrics), json(evaluated.failedCriteria), new Date().toISOString());
  run(`UPDATE eval_runs SET release_gate_result_id=? WHERE id=?`, id, evalRunId);
  return getReleaseGateResult(id);
}

export function getReleaseGateResult(id: string) {
  const row = get<Record<string, unknown>>(`SELECT r.*, g.name AS gate_name, g.version AS gate_version
    FROM release_gate_results r JOIN release_gates g ON g.id=r.gate_id WHERE r.id=?`, id);
  return row ? {
    id: row.id, gateId: row.gate_id, gateName: row.gate_name, gateVersion: row.gate_version,
    evalRunId: row.eval_run_id, passed: Boolean(row.passed), summary: parseJson(row.summary_json, {}),
    failedCriteria: parseJson(row.failed_criteria_json, []), reportPath: row.report_path, createdAt: row.created_at
  } : undefined;
}

export function listReleaseGateResults() {
  return all<Record<string, unknown>>(`SELECT r.*, g.name AS gate_name, g.version AS gate_version
    FROM release_gate_results r JOIN release_gates g ON g.id=r.gate_id ORDER BY r.created_at DESC`)
    .map((row) => getReleaseGateResult(String(row.id))!);
}

export function generateEvalReport(evalRunId: string) {
  const evalRun = getEvalRun(evalRunId);
  if (!evalRun) throw new Error('Eval Run 不存在');
  const gate = evalRun.gateResult as ReturnType<typeof getReleaseGateResult> | undefined;
  const failed = evalRun.results.filter((item) => !item.passed);
  const p0 = evalRun.results.filter((item) => item.priority === 'p0');
  const judgeSummaries = evalRun.results.flatMap((item) => item.judgeResult ? [`- ${item.evalCaseName}: ${item.judgeResult.reason ?? '无说明'}`] : []);
  const humanSummaries = evalRun.results.flatMap((item) => item.humanReview ? [`- ${item.evalCaseName}: ${item.humanReview.comment ?? '无评语'}`] : []);
  const markdown = `# Jarvis Eval Report

## 基本信息

- Eval Run ID: \`${evalRun.id}\`
- Dataset: ${evalRun.datasetName} @ ${evalRun.datasetVersion}
- Model: ${evalRun.modelName}
- Prompt Version: ${evalRun.promptVersion}
- Skill Version: ${evalRun.skillVersion ?? 'case-defined'}
- Runtime Version: ${evalRun.runtimeVersion}
- 执行时间: ${evalRun.startedAt ?? '—'} 至 ${evalRun.endedAt ?? '—'}

## 总体结论

- Release Gate: ${gate ? (gate.passed ? 'PASS' : 'BLOCK') : '未执行'}
- 通过率: ${(evalRun.passRate * 100).toFixed(1)}%
- 平均分: ${evalRun.avgScore.toFixed(2)}
- 平均耗时: ${evalRun.avgLatencyMs} ms
- 平均 Token: ${evalRun.avgTotalTokens}
- 总成本: ${evalRun.totalCost.toFixed(6)} ${evalRun.currency}

## 指标汇总

| 总用例 | 通过 | 失败 | 平均分 | 平均耗时 | 平均 Token | 总成本 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${evalRun.totalCases} | ${evalRun.passedCases} | ${evalRun.failedCases} | ${evalRun.avgScore.toFixed(2)} | ${evalRun.avgLatencyMs}ms | ${evalRun.avgTotalTokens} | ${evalRun.totalCost.toFixed(6)} ${evalRun.currency} |

## 失败用例

${failed.length ? failed.map((item) => `- **${item.evalCaseId} / ${item.evalCaseName}**: ${item.issueTags.join(', ') || item.error || '未分类'} ([Trace](/runs/${item.runId}))`).join('\n') : '- 无'}

## P0 用例结果

${p0.length ? p0.map((item) => `- ${item.passed ? 'PASS' : 'FAIL'} ${item.evalCaseId} · ${item.totalScore.toFixed(2)}`).join('\n') : '- 无 P0 用例'}

## Release Gate

${gate ? (gate.failedCriteria.length ? gate.failedCriteria.map((item: any) => `- ${item.label}: ${item.actual}，要求 ${item.expected}`).join('\n') : '- 所有门禁项通过') : '- 未执行 Release Gate'}

## LLM Judge 摘要

${judgeSummaries.join('\n') || '- 未启用 LLM Judge'}

## 人工 Review 摘要

${humanSummaries.join('\n') || '- 尚无人工 Review'}

## 改进建议

${failed.length ? '- 优先修复 P0 失败和重复出现的问题标签。\n- 对退步用例执行 Trace 与 Context 差异分析。\n- 修复后重新执行相同 Dataset 并通过 Release Gate。' : '- 当前评测未发现阻断问题，建议保留本次结果作为回归 Baseline。'}
`;
  const path = join(reportsRoot, `${evalRunId}.md`);
  writeFileSync(path, markdown, 'utf8');
  const now = new Date().toISOString();
  run(`INSERT INTO eval_reports VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET path=excluded.path, generated_at=excluded.generated_at`,
    evalRunId, evalRunId, path, now);
  run(`UPDATE eval_runs SET report_path=? WHERE id=?`, path, evalRunId);
  return { evalRunId, path, filename: basename(path), markdown, generatedAt: now };
}

export function getEvalReport(evalRunId: string) {
  const row = get<{ path: string; generated_at: string }>(`SELECT path, generated_at FROM eval_reports WHERE eval_run_id=?`, evalRunId);
  if (!row || !existsSync(row.path)) return undefined;
  return { evalRunId, path: row.path, filename: basename(row.path), markdown: readFileSync(row.path, 'utf8'), generatedAt: row.generated_at };
}

export function listEvalReports() {
  return all<Record<string, unknown>>(`SELECT rep.*, er.name AS eval_run_name, er.dataset_id
    FROM eval_reports rep JOIN eval_runs er ON er.id=rep.eval_run_id ORDER BY rep.generated_at DESC`).map((row) => ({
    id: row.id, evalRunId: row.eval_run_id, evalRunName: row.eval_run_name, datasetId: row.dataset_id,
    path: row.path, filename: basename(String(row.path)), generatedAt: row.generated_at
  }));
}

function aggregateGateMetrics(evalRun: ReturnType<typeof getEvalRunSummary>, results: ReturnType<typeof listEvalRunResults>) {
  const ruleMetrics = results.map((item) => item.ruleResults?.metrics ?? {
    toolCorrectnessRate: 0, artifactSuccessRate: 0, forbiddenToolCallCount: 0, permissionDeniedCount: 0
  });
  return {
    passRate: evalRun?.passRate ?? 0,
    avgScore: evalRun?.avgScore ?? 0,
    toolCorrectnessRate: average(ruleMetrics.map((item) => Number(item.toolCorrectnessRate ?? 0))),
    artifactSuccessRate: average(ruleMetrics.map((item) => Number(item.artifactSuccessRate ?? 0))),
    hallucinatedFieldCount: results.filter((item) => item.issueTags.includes('hallucinated_field')).length,
    forbiddenToolCallCount: ruleMetrics.reduce((sum, item) => sum + Number(item.forbiddenToolCallCount ?? 0), 0),
    permissionDeniedCount: ruleMetrics.reduce((sum, item) => sum + Number(item.permissionDeniedCount ?? 0), 0),
    avgLatencyMs: evalRun?.avgLatencyMs ?? 0,
    avgTotalTokens: evalRun?.avgTotalTokens ?? 0,
    totalCost: evalRun?.totalCost ?? 0
  };
}

function getLatestGateResultForRun(evalRunId: string) {
  const row = get<{ id: string }>(`SELECT id FROM release_gate_results WHERE eval_run_id=? ORDER BY created_at DESC LIMIT 1`, evalRunId);
  return row ? getReleaseGateResult(row.id) : undefined;
}

function recomputeEvalRunSummary(id: string) {
  const summary = get<Record<string, unknown>>(`SELECT COUNT(*) AS total,
    SUM(passed) AS passed, AVG(total_score) AS avg_score, AVG(latency_ms) AS avg_latency,
    AVG(total_tokens) AS avg_tokens, SUM(cost) AS total_cost FROM eval_case_results WHERE eval_run_id=?`, id);
  const total = Number(summary?.total ?? 0);
  const passed = Number(summary?.passed ?? 0);
  run(`UPDATE eval_runs SET total_cases=?, passed_cases=?, failed_cases=?, pass_rate=?, avg_score=?,
    avg_latency_ms=?, avg_total_tokens=?, total_cost=?, avg_cost_per_case=? WHERE id=?`,
  total, passed, total - passed, total ? passed / total : 0, Number(summary?.avg_score ?? 0),
  Math.round(Number(summary?.avg_latency ?? 0)), Math.round(Number(summary?.avg_tokens ?? 0)),
  Number(summary?.total_cost ?? 0), total ? Number(summary?.total_cost ?? 0) / total : 0, id);
}

function getEvalRunSummary(id: string) {
  const row = get<Record<string, unknown>>(`SELECT er.*, d.name AS dataset_name FROM eval_runs er
    LEFT JOIN eval_datasets d ON d.id=er.dataset_id WHERE er.id=?`, id);
  return row ? normalizeEvalRun(row) : undefined;
}

function failureStats(evalRunId: string) {
  const counts = new Map<string, number>();
  for (const result of listEvalRunResults(evalRunId)) {
    for (const tag of result.issueTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

function updateDatasetCaseCount(id: string) {
  run(`UPDATE eval_datasets SET case_count=(SELECT COUNT(*) FROM eval_cases WHERE dataset_id=?), updated_at=? WHERE id=?`,
    id, new Date().toISOString(), id);
}

function ensureLegacyDataset(id: string) {
  if (get(`SELECT id FROM eval_datasets WHERE id=?`, id)) return;
  const now = new Date().toISOString();
  run(`INSERT INTO eval_datasets (id, name, version, category, description, owner, case_count, default_runtime_json, created_at, updated_at)
    VALUES (?, 'Legacy Regression Dataset', '1.0.0', 'regression', '由旧版 Eval Case YAML 兼容导入。', 'jarvis', 0, '{}', ?, ?)`, id, now, now);
}

function normalizedRunConfig(input: CreateEvalRunInput): CreateEvalRunInput {
  return {
    ...input,
    maxParallel: Math.min(Math.max(Number(input.maxParallel ?? 2), 1), 5),
    retryCount: Math.min(Math.max(Number(input.retryCount ?? 0), 0), 3),
    timeoutSeconds: Math.min(Math.max(Number(input.timeoutSeconds ?? 120), 1), 900),
    promptVersion: input.promptVersion ?? 'base-agent@v0.3'
  };
}

function matrixCombinations(input: CreateEvalRunInput) {
  if (!input.matrix) return [normalizedRunConfig(input)];
  const providers = input.matrix.modelProviderIds?.length ? input.matrix.modelProviderIds : [input.modelProviderId];
  const models = input.matrix.modelNames?.length ? input.matrix.modelNames : [input.modelName];
  const prompts = input.matrix.promptVersions?.length ? input.matrix.promptVersions : [input.promptVersion];
  const temperatures = input.matrix.temperatures?.length ? input.matrix.temperatures : [input.temperature];
  return providers.flatMap((modelProviderId) => models.flatMap((modelName) => prompts.flatMap((promptVersion) =>
    temperatures.map((temperature) => normalizedRunConfig({ ...input, matrix: undefined, modelProviderId, modelName, promptVersion, temperature })))));
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  }));
}

async function executeRuntimeWithRetry(action: () => Promise<RuntimeResult>, retries: number) {
  let lastError: unknown;
  let lastResult: RuntimeResult | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      lastResult = await action();
      if (lastResult.status === 'success') return lastResult;
      lastError = new Error(lastResult.error ?? 'Runtime 执行失败');
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResult) return lastResult;
  throw lastError;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Eval Case timeout after ${milliseconds}ms`)), milliseconds);
        timer.unref();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function calculateCost(promptTokens: number, completionTokens: number, pricing: { inputPricePer1MTokens: number; outputPricePer1MTokens: number }) {
  return promptTokens / 1_000_000 * pricing.inputPricePer1MTokens
    + completionTokens / 1_000_000 * pricing.outputPricePer1MTokens;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function versionHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
