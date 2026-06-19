import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';
import { createEvalRuns, getEvalRun, type CreateEvalRunInput } from './evalService.ts';

export interface ExperimentInput {
  name: string;
  evalSetId: string;
  matrix: {
    modelProviderIds?: string[];
    modelNames?: string[];
    promptVersions?: string[];
    skillVersions?: string[];
    contextStrategies?: string[];
    toolPolicies?: string[];
    temperatures?: number[];
  };
}

export function createExperiment(input: ExperimentInput) {
  if (!input.name || !input.evalSetId) throw new Error('Experiment 缺少 name/evalSetId');
  const variants = matrixVariants(input);
  if (variants.length > 20) throw new Error('Experiment Matrix 超过 max_matrix_runs=20');
  const id = `exp_${randomUUID()}`;
  const now = new Date().toISOString();
  run(`INSERT INTO experiments VALUES (?, ?, ?, ?, 'created', ?, ?)`,
    id, input.name, input.evalSetId, json(input.matrix), now, now);
  return getExperiment(id);
}

export function listExperiments() {
  refreshAllExperimentMetrics();
  return all<Record<string, unknown>>(`SELECT * FROM experiments ORDER BY updated_at DESC`).map(normalizeExperiment);
}

export function getExperiment(id: string) {
  refreshExperimentMetrics(id);
  const row = get<Record<string, unknown>>(`SELECT * FROM experiments WHERE id=?`, id);
  return row ? {
    ...normalizeExperiment(row),
    results: all<Record<string, unknown>>(`SELECT * FROM experiment_results WHERE experiment_id=? ORDER BY created_at DESC`, id).map(normalizeExperimentResult)
  } : undefined;
}

export async function runExperiment(id: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM experiments WHERE id=?`, id);
  if (!row) throw new Error('Experiment 不存在');
  const input: ExperimentInput = {
    name: String(row.name),
    evalSetId: String(row.eval_set_id),
    matrix: parseJson(row.matrix_json, {})
  };
  const variants = matrixVariants(input);
  if (variants.length > 20) throw new Error('Experiment Matrix 超过 max_matrix_runs=20');
  run(`UPDATE experiments SET status='running', updated_at=? WHERE id=?`, new Date().toISOString(), id);
  for (const variant of variants) {
    const existing = get<Record<string, unknown>>(
      `SELECT id FROM experiment_results WHERE experiment_id=? AND variant_json=?`,
      id, json(variant)
    );
    if (existing) continue;
    const created = createEvalRuns({
      datasetId: input.evalSetId,
      modelProviderId: variant.modelProviderId,
      modelName: variant.modelName,
      promptVersion: variant.promptVersion,
      skillVersion: variant.skillVersion,
      contextStrategy: variant.contextStrategy,
      toolPolicy: variant.toolPolicy,
      temperature: variant.temperature,
      maxParallel: 1
    })[0];
    if (!created) continue;
    run(`INSERT INTO experiment_results VALUES (?, ?, ?, ?, ?, ?)`,
      `exp_result_${randomUUID()}`, id, String(created.id), json(variant), json({ status: created.status }), new Date().toISOString());
  }
  run(`UPDATE experiments SET status='running', updated_at=? WHERE id=?`, new Date().toISOString(), id);
  return getExperiment(id);
}

export function experimentReport(id: string) {
  const experiment = getExperiment(id);
  if (!experiment) throw new Error('Experiment 不存在');
  const lines = [
    `# Experiment Report · ${experiment.name}`,
    '',
    `- Experiment ID: ${experiment.id}`,
    `- Eval Set: ${experiment.evalSetId}`,
    `- Status: ${experiment.status}`,
    '',
    '| Model | Prompt | Skill | Context | Tool Policy | Success Rate | Avg Score | Avg Latency | Avg Tokens | Cost |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|',
    ...experiment.results.map((result: ReturnType<typeof normalizeExperimentResult>) => {
      const variant = result.variant as Record<string, unknown>;
      const metrics = result.metrics as Record<string, unknown>;
      return `| ${variant.modelName ?? variant.modelProviderId ?? '-'} | ${variant.promptVersion ?? '-'} | ${variant.skillVersion ?? '-'} | ${variant.contextStrategy ?? '-'} | ${variant.toolPolicy ?? '-'} | ${percent(metrics.successRate)} | ${fixed(metrics.avgScore)} | ${fixed(metrics.avgLatencyMs)}ms | ${fixed(metrics.avgTotalTokens)} | ${fixed(metrics.avgCost)} |`;
    })
  ];
  return { experimentId: id, markdown: lines.join('\n') };
}

function matrixVariants(input: ExperimentInput) {
  const providers = input.matrix.modelProviderIds?.length ? input.matrix.modelProviderIds : [undefined];
  const models = input.matrix.modelNames?.length ? input.matrix.modelNames : [undefined];
  const prompts = input.matrix.promptVersions?.length ? input.matrix.promptVersions : [undefined];
  const skills = input.matrix.skillVersions?.length ? input.matrix.skillVersions : [undefined];
  const contexts = input.matrix.contextStrategies?.length ? input.matrix.contextStrategies : ['balanced-v1'];
  const toolPolicies = input.matrix.toolPolicies?.length ? input.matrix.toolPolicies : ['default-local-policy@0.4.0'];
  const temperatures = input.matrix.temperatures?.length ? input.matrix.temperatures : [undefined];
  const variants: Array<{
    modelProviderId?: string;
    modelName?: string;
    promptVersion?: string;
    skillVersion?: string;
    contextStrategy?: string;
    toolPolicy?: string;
    temperature?: number;
  }> = [];
  for (const modelProviderId of providers) {
    for (const modelName of models) {
      for (const promptVersion of prompts) {
        for (const skillVersion of skills) {
          for (const contextStrategy of contexts) {
            for (const toolPolicy of toolPolicies) {
              for (const temperature of temperatures) {
                variants.push({ modelProviderId, modelName, promptVersion, skillVersion, contextStrategy, toolPolicy, temperature });
              }
            }
          }
        }
      }
    }
  }
  return variants;
}

function refreshAllExperimentMetrics() {
  for (const row of all<{ id: string }>(`SELECT id FROM experiments`)) refreshExperimentMetrics(row.id);
}

function refreshExperimentMetrics(id: string) {
  const rows = all<Record<string, unknown>>(`SELECT * FROM experiment_results WHERE experiment_id=?`, id);
  let allDone = rows.length > 0;
  for (const row of rows) {
    const evalRun = getEvalRun(String(row.run_id));
    if (!evalRun) continue;
    const metrics = {
      status: evalRun.status,
      successRate: Number(evalRun.passRate ?? 0),
      avgScore: Number(evalRun.avgScore ?? 0),
      avgLatencyMs: Number(evalRun.avgLatencyMs ?? 0),
      avgTotalTokens: Number(evalRun.avgTotalTokens ?? 0),
      avgCost: Number(evalRun.avgCostPerCase ?? 0),
      totalCost: Number(evalRun.totalCost ?? 0)
    };
    if (!['completed', 'failed', 'cancelled'].includes(String(evalRun.status))) allDone = false;
    run(`UPDATE experiment_results SET metrics_json=? WHERE id=?`, json(metrics), String(row.id));
  }
  if (rows.length) {
    run(`UPDATE experiments SET status=?, updated_at=? WHERE id=?`, allDone ? 'completed' : 'running', new Date().toISOString(), id);
  }
}

function normalizeExperiment(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    evalSetId: row.eval_set_id,
    matrix: parseJson(row.matrix_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeExperimentResult(row: Record<string, unknown>) {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    runId: row.run_id,
    variant: parseJson(row.variant_json, {}),
    metrics: parseJson(row.metrics_json, {}),
    createdAt: row.created_at
  };
}

function percent(value: unknown) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`;
}

function fixed(value: unknown) {
  return Number(value ?? 0).toFixed(2);
}
