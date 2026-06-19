import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { compare, compareEvalRuns, compareRuns } from '../services/compareService.ts';
import { parseBody, respond } from './routeUtils.ts';

const pairSchema = z.object({
  left: z.string().min(1),
  right: z.string().min(1)
});
const evalCompareSchema = z.object({
  baselineEvalRunId: z.string().min(1),
  candidateEvalRunId: z.string().min(1)
});

export async function compareRoutes(app: FastifyInstance) {
  for (const dimension of ['prompts', 'models', 'skills'] as const) {
    app.post<{ Body: unknown }>(`/api/compare/${dimension}`, (request, reply) =>
      respond(reply, () => {
        const body = parseBody(request.body, pairSchema);
        return compare(dimension, body.left, body.right);
      }, '对比失败'));
  }
  app.post<{ Body: unknown }>('/api/compare/runs', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, pairSchema);
      return compareRuns(body.left, body.right);
    }, 'Run 对比失败'));
  app.post<{ Body: unknown }>('/api/eval/compare', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, evalCompareSchema);
      return compareEvalRuns(body.baselineEvalRunId, body.candidateEvalRunId);
    }, 'Eval 对比失败'));
  app.get<{ Params: { compareId: string }; Querystring: { baseline?: string; candidate?: string } }>('/api/eval/compare/:compareId', (request) =>
    compareEvalRuns(request.query.baseline ?? '', request.query.candidate ?? ''));
}
