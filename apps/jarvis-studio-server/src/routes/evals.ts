import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  cancelEvalRun,
  createEvalRuns,
  evaluateGate,
  generateEvalReport,
  getEvalCase,
  getEvalCaseResult,
  getEvalDataset,
  getEvalReport,
  getEvalRun,
  getReleaseGateResult,
  importEvalDatasetYaml,
  importEvalYaml,
  importReleaseGateYaml,
  listEvalCases,
  listEvalDatasets,
  listEvalReports,
  listEvalRunResults,
  listEvalRuns,
  listReleaseGateResults,
  listReleaseGates,
  reloadEvalDataset,
  rescoreEvalRun,
  saveEvalCase,
  saveHumanReview,
  type CreateEvalRunInput
} from '../services/evalService.ts';
import { parseBody, respond } from './routeUtils.ts';

const importDatasetSchema = z.object({
  content: z.string().min(1),
  cases: z.array(z.string()).default([]),
  filePath: z.string().optional()
});
const createEvalRunSchema = z.object({
  datasetId: z.string().min(1),
  name: z.string().optional(),
  caseIds: z.array(z.string()).optional(),
  modelProviderId: z.string().optional(),
  modelName: z.string().optional(),
  promptVersion: z.string().optional(),
  skillVersion: z.string().optional(),
  contextStrategy: z.string().optional(),
  toolPolicy: z.string().optional(),
  maxParallel: z.coerce.number().int().positive().optional(),
  retryCount: z.coerce.number().int().nonnegative().optional(),
  timeoutSeconds: z.coerce.number().int().positive().optional(),
  enableLlmJudge: z.boolean().optional(),
  judgeModelProviderId: z.string().optional(),
  judgePromptVersion: z.string().optional(),
  releaseGateId: z.string().optional(),
  temperature: z.coerce.number().optional(),
  matrix: z.object({
    modelProviderIds: z.array(z.string()).optional(),
    modelNames: z.array(z.string()).optional(),
    promptVersions: z.array(z.string()).optional(),
    skillVersions: z.array(z.string()).optional(),
    contextStrategies: z.array(z.string()).optional(),
    toolPolicies: z.array(z.string()).optional(),
    temperatures: z.array(z.coerce.number()).optional()
  }).optional()
});
const humanReviewSchema = z.object({
  score: z.coerce.number(),
  issueTags: z.array(z.string()).default([]),
  comment: z.string().optional(),
  reviewer: z.string().optional()
});
const contentSchema = z.object({
  content: z.string().min(1),
  filePath: z.string().optional()
});
const gateEvaluateSchema = z.object({ evalRunId: z.string().min(1) });

export async function evalRoutes(app: FastifyInstance) {
  app.get('/api/eval/datasets', () => listEvalDatasets());
  app.post<{ Body: unknown }>('/api/eval/datasets/import', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, importDatasetSchema);
      return importEvalDatasetYaml(body.content, body.cases, body.filePath);
    }, 'Eval Dataset 导入失败'));
  app.get<{ Params: { datasetId: string } }>('/api/eval/datasets/:datasetId', (request, reply) =>
    getEvalDataset(request.params.datasetId) ?? reply.code(404).send({ error: 'Eval Dataset 不存在' }));
  app.get<{ Params: { datasetId: string } }>('/api/eval/datasets/:datasetId/cases', (request) =>
    listEvalCases(request.params.datasetId));
  app.post<{ Params: { datasetId: string } }>('/api/eval/datasets/:datasetId/reload', (request, reply) =>
    respond(reply, () => reloadEvalDataset(request.params.datasetId)));

  app.get('/api/eval/cases', (request) => listEvalCases((request.query as { datasetId?: string }).datasetId));
  app.post<{ Body: unknown }>('/api/eval/cases', (request, reply) =>
    respond(reply, () => saveEvalCase(request.body), 'Eval Case 保存失败'));
  app.get<{ Params: { caseId: string } }>('/api/eval/cases/:caseId', (request, reply) =>
    getEvalCase(request.params.caseId) ?? reply.code(404).send({ error: 'Eval Case 不存在' }));

  app.post<{ Body: unknown }>('/api/eval/runs', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, createEvalRunSchema) satisfies CreateEvalRunInput;
      return reply.code(202).send({ runs: createEvalRuns(body) });
    }, 'Eval Run 创建失败'));
  app.get('/api/eval/runs', () => listEvalRuns());
  app.get<{ Params: { evalRunId: string } }>('/api/eval/runs/:evalRunId', (request, reply) =>
    getEvalRun(request.params.evalRunId) ?? reply.code(404).send({ error: 'Eval Run 不存在' }));
  app.get<{ Params: { evalRunId: string } }>('/api/eval/runs/:evalRunId/results', (request) =>
    listEvalRunResults(request.params.evalRunId));
  app.post<{ Params: { evalRunId: string } }>('/api/eval/runs/:evalRunId/cancel', (request, reply) =>
    respond(reply, () => cancelEvalRun(request.params.evalRunId)));
  app.post<{ Params: { evalRunId: string } }>('/api/eval/runs/:evalRunId/rescore', async (request, reply) => {
    try {
      return await rescoreEvalRun(request.params.evalRunId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : '重新评分失败' });
    }
  });
  app.get<{ Params: { resultId: string } }>('/api/eval/results/:resultId', (request, reply) =>
    getEvalCaseResult(request.params.resultId) ?? reply.code(404).send({ error: 'Eval Case Result 不存在' }));
  app.post<{ Params: { resultId: string }; Body: unknown }>(
    '/api/eval/results/:resultId/human-review', (request, reply) =>
      respond(reply, () => saveHumanReview(request.params.resultId, parseBody(request.body, humanReviewSchema)), '人工复核保存失败'));

  app.get('/api/release-gates', () => listReleaseGates());
  app.post<{ Body: unknown }>('/api/release-gates/import', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, contentSchema);
      return importReleaseGateYaml(body.content, body.filePath);
    }, 'Release Gate 导入失败'));
  app.post<{ Params: { gateId: string }; Body: unknown }>('/api/release-gates/:gateId/evaluate', (request, reply) =>
    respond(reply, () => evaluateGate(request.params.gateId, parseBody(request.body, gateEvaluateSchema).evalRunId), 'Release Gate 执行失败'));
  app.get('/api/release-gates/results', () => listReleaseGateResults());
  app.get<{ Params: { resultId: string } }>('/api/release-gates/results/:resultId', (request, reply) =>
    getReleaseGateResult(request.params.resultId) ?? reply.code(404).send({ error: 'Release Gate Result 不存在' }));

  app.get('/api/reports/eval', () => listEvalReports());
  app.post<{ Params: { evalRunId: string } }>('/api/reports/eval/:evalRunId/generate', (request, reply) =>
    respond(reply, () => generateEvalReport(request.params.evalRunId)));
  app.get<{ Params: { evalRunId: string } }>('/api/reports/eval/:evalRunId', (request, reply) =>
    getEvalReport(request.params.evalRunId) ?? reply.code(404).send({ error: 'Eval Report 尚未生成' }));
  app.get<{ Params: { evalRunId: string } }>('/api/reports/eval/:evalRunId/download', (request, reply) => {
    const report = getEvalReport(request.params.evalRunId);
    if (!report) return reply.code(404).send({ error: 'Eval Report 尚未生成' });
    return reply.header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="${report.filename}"`).send(report.markdown);
  });

  // v0.2 compatibility endpoints.
  app.get('/api/eval-cases', () => listEvalCases());
  app.post<{ Body: unknown }>('/api/eval-cases', (request, reply) =>
    respond(reply, () => saveEvalCase(request.body), 'Eval Case 保存失败'));
  app.post<{ Body: unknown }>('/api/eval-cases/import-yaml', (request, reply) =>
    respond(reply, () => importEvalYaml(parseBody(request.body, contentSchema).content), 'Eval YAML 导入失败'));
  app.get('/api/eval-results', () => listEvalRuns().flatMap((item) => listEvalRunResults(String(item.id))));
}
