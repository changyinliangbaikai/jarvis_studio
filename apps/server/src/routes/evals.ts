import type { FastifyInstance, FastifyReply } from 'fastify';
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

export async function evalRoutes(app: FastifyInstance) {
  app.get('/api/eval/datasets', () => listEvalDatasets());
  app.post<{ Body: { content: string; cases?: string[]; filePath?: string } }>('/api/eval/datasets/import', (request, reply) =>
    respond(reply, () => importEvalDatasetYaml(request.body?.content, request.body?.cases ?? [], request.body?.filePath)));
  app.get<{ Params: { datasetId: string } }>('/api/eval/datasets/:datasetId', (request, reply) =>
    getEvalDataset(request.params.datasetId) ?? reply.code(404).send({ error: 'Eval Dataset 不存在' }));
  app.get<{ Params: { datasetId: string } }>('/api/eval/datasets/:datasetId/cases', (request) =>
    listEvalCases(request.params.datasetId));
  app.post<{ Params: { datasetId: string } }>('/api/eval/datasets/:datasetId/reload', (request, reply) =>
    respond(reply, () => reloadEvalDataset(request.params.datasetId)));

  app.get('/api/eval/cases', (request) => listEvalCases((request.query as { datasetId?: string }).datasetId));
  app.post<{ Body: unknown }>('/api/eval/cases', (request) => saveEvalCase(request.body));
  app.get<{ Params: { caseId: string } }>('/api/eval/cases/:caseId', (request, reply) =>
    getEvalCase(request.params.caseId) ?? reply.code(404).send({ error: 'Eval Case 不存在' }));

  app.post<{ Body: CreateEvalRunInput }>('/api/eval/runs', (request, reply) =>
    respond(reply, () => reply.code(202).send({ runs: createEvalRuns(request.body) })));
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
  app.post<{ Params: { resultId: string }; Body: { score: number; issueTags?: string[]; comment?: string; reviewer?: string } }>(
    '/api/eval/results/:resultId/human-review', (request, reply) =>
      respond(reply, () => saveHumanReview(request.params.resultId, request.body)));

  app.get('/api/release-gates', () => listReleaseGates());
  app.post<{ Body: { content: string; filePath?: string } }>('/api/release-gates/import', (request, reply) =>
    respond(reply, () => importReleaseGateYaml(request.body?.content, request.body?.filePath)));
  app.post<{ Params: { gateId: string }; Body: { evalRunId: string } }>('/api/release-gates/:gateId/evaluate', (request, reply) =>
    respond(reply, () => evaluateGate(request.params.gateId, request.body.evalRunId)));
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
  app.post<{ Body: unknown }>('/api/eval-cases', (request) => saveEvalCase(request.body));
  app.post<{ Body: { content: string } }>('/api/eval-cases/import-yaml', (request, reply) =>
    request.body?.content ? importEvalYaml(request.body.content) : reply.code(400).send({ error: 'content 不能为空' }));
  app.get('/api/eval-results', () => listEvalRuns().flatMap((item) => listEvalRunResults(String(item.id))));
}

function respond(reply: FastifyReply, action: () => unknown) {
  try {
    return action();
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Eval 操作失败' });
  }
}
