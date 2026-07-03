import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { archiveCase, createCase, createCaseFromRun, getCase, listCases, runCase, updateCase, type CaseInput } from '../services/caseService.ts';
import { parseBody, respond } from './routeUtils.ts';

const caseSchema = z.object({
  agentId: z.string().min(1),
  sourceRunId: z.string().optional(),
  sourceTraceId: z.string().optional(),
  promptVersionId: z.string().optional(),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  input: z.string().min(1),
  context: z.unknown().optional(),
  expectedOutput: z.string().optional(),
  assertionType: z.enum(['manual', 'keyword', 'json_schema', 'tool_call', 'llm_judge']).optional(),
  assertionConfig: z.unknown().optional(),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  status: z.enum(['active', 'disabled', 'archived']).optional(),
  tags: z.array(z.string()).optional()
});
const casePatchSchema = caseSchema.partial().refine((value) => Object.keys(value).length > 0, '至少提供一个字段');
const caseFromRunSchema = caseSchema.omit({ agentId: true, input: true }).partial();
const caseRunSchema = z.object({
  promptVersionId: z.string().optional(),
  modelProviderId: z.string().optional(),
  modelName: z.string().optional(),
  contextStrategy: z.string().optional(),
  toolPolicy: z.string().optional()
});

export async function casesRoutes(app: FastifyInstance) {
  app.get('/api/cases', (request) => listCases(request.query as Record<string, unknown>));
  app.post<{ Body: unknown }>('/api/cases', (request, reply) =>
    respond(reply, () => createCase(parseBody(request.body, caseSchema) satisfies CaseInput), 'Case 创建失败'));
  app.get<{ Params: { caseId: string } }>('/api/cases/:caseId', (request, reply) =>
    getCase(request.params.caseId) ?? reply.code(404).send({ error: 'Case 不存在' }));
  app.put<{ Params: { caseId: string }; Body: unknown }>('/api/cases/:caseId', (request, reply) =>
    respond(reply, () => updateCase(request.params.caseId, parseBody(request.body, casePatchSchema)), 'Case 保存失败'));
  app.post<{ Params: { caseId: string } }>('/api/cases/:caseId/archive', (request, reply) =>
    respond(reply, () => archiveCase(request.params.caseId), 'Case 归档失败'));
  app.post<{ Params: { caseId: string }; Body: unknown }>('/api/cases/:caseId/run', (request, reply) =>
    respond(reply, () => runCase(request.params.caseId, parseBody(request.body ?? {}, caseRunSchema)), 'Case 运行失败'));
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/cases/from-run/:runId', (request, reply) =>
    respond(reply, () => createCaseFromRun(request.params.runId, parseBody(request.body ?? {}, caseFromRunSchema)), 'Run 转 Case 失败'));
}
