import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createEvalSuite,
  getEvalRun,
  getEvalSuite,
  listEvalRunResults,
  listEvalSuites,
  listLightEvalRuns,
  runEvalSuite,
  updateEvalSuite,
  type EvalSuiteInput,
  type RunEvalSuiteInput
} from '../services/lightEvalService.ts';
import { parseBody, respond } from './routeUtils.ts';

const evalSuiteSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  caseIds: z.array(z.string()).default([]),
  defaultAssertionMode: z.string().optional(),
  tags: z.array(z.string()).optional()
});
const evalSuitePatchSchema = evalSuiteSchema.partial().refine((value) => Object.keys(value).length > 0, '至少提供一个字段');
const runEvalSuiteSchema = z.object({
  promptVersionId: z.string().min(1),
  modelProviderId: z.string().optional(),
  modelName: z.string().optional(),
  runScope: z.enum(['all', 'p0', 'custom']).optional(),
  caseIds: z.array(z.string()).optional(),
  continueOnFailure: z.boolean().optional(),
  maxParallel: z.coerce.number().int().positive().optional()
});

export async function lightEvalRoutes(app: FastifyInstance) {
  app.get('/api/eval-suites', (request) => listEvalSuites(request.query as Record<string, unknown>));
  app.post<{ Body: unknown }>('/api/eval-suites', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, evalSuiteSchema);
      return createEvalSuite({ ...body, caseIds: body.caseIds ?? [] } satisfies EvalSuiteInput);
    }, 'Eval Suite 创建失败'));
  app.get<{ Params: { suiteId: string } }>('/api/eval-suites/:suiteId', (request, reply) =>
    getEvalSuite(request.params.suiteId) ?? reply.code(404).send({ error: 'Eval Suite 不存在' }));
  app.put<{ Params: { suiteId: string }; Body: unknown }>('/api/eval-suites/:suiteId', (request, reply) =>
    respond(reply, () => updateEvalSuite(request.params.suiteId, parseBody(request.body, evalSuitePatchSchema)), 'Eval Suite 保存失败'));
  app.post<{ Params: { suiteId: string }; Body: unknown }>('/api/eval-suites/:suiteId/run', (request, reply) =>
    respond(reply, () => runEvalSuite(request.params.suiteId, parseBody(request.body, runEvalSuiteSchema) satisfies RunEvalSuiteInput), 'Eval Suite 运行失败'));

  app.get('/api/eval-runs', (request) => listLightEvalRuns(request.query as Record<string, unknown>));
  app.get<{ Params: { evalRunId: string } }>('/api/eval-runs/:evalRunId', (request, reply) =>
    getEvalRun(request.params.evalRunId) ?? reply.code(404).send({ error: 'Eval Run 不存在' }));
  app.get<{ Params: { evalRunId: string } }>('/api/eval-runs/:evalRunId/results', (request) =>
    listEvalRunResults(request.params.evalRunId));
}
