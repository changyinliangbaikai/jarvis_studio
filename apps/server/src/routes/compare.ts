import type { FastifyInstance } from 'fastify';
import { compare, compareEvalRuns, compareRuns } from '../services/compareService.ts';

export async function compareRoutes(app: FastifyInstance) {
  for (const dimension of ['prompts', 'models', 'skills'] as const) {
    app.post<{ Body: { left: string; right: string } }>(`/api/compare/${dimension}`, (request) =>
      compare(dimension, request.body.left, request.body.right));
  }
  app.post<{ Body: { left: string; right: string } }>('/api/compare/runs', (request) =>
    compareRuns(request.body.left, request.body.right));
  app.post<{ Body: { baselineEvalRunId: string; candidateEvalRunId: string } }>('/api/eval/compare', (request) =>
    compareEvalRuns(request.body.baselineEvalRunId, request.body.candidateEvalRunId));
  app.get<{ Params: { compareId: string }; Querystring: { baseline?: string; candidate?: string } }>('/api/eval/compare/:compareId', (request) =>
    compareEvalRuns(request.query.baseline ?? '', request.query.candidate ?? ''));
}
