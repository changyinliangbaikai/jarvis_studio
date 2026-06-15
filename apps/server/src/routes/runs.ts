import type { FastifyInstance } from 'fastify';
import { all, get, parseJson } from '../db/database.ts';
import { importTraceJsonl } from '../services/traceImportService.ts';
import { getRun, listArtifacts, listRuns, listSpans } from '../services/queryService.ts';

export async function runsRoutes(app: FastifyInstance) {
  app.get('/api/runs', (request) => listRuns(request.query as Record<string, unknown>));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', (request, reply) => {
    const item = getRun(request.params.runId);
    return item ?? reply.code(404).send({ error: 'Run 不存在' });
  });
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/spans', (request) => listSpans(request.params.runId));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/artifacts', (request) => listArtifacts(request.params.runId));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/llm-calls', (request) =>
    all<Record<string, unknown>>(`SELECT * FROM llm_calls WHERE run_id=? ORDER BY created_at`, request.params.runId).map((row) => ({
      id: row.id, runId: row.run_id, turnId: row.turn_id, spanId: row.span_id, model: row.model,
      provider: row.provider, temperature: row.temperature, maxOutputTokens: row.max_output_tokens,
      promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, totalTokens: row.total_tokens,
      latencyMs: row.latency_ms, firstTokenLatencyMs: row.first_token_latency_ms, prefillMs: row.prefill_ms,
      decodeMs: row.decode_ms, tokensPerSecond: row.tokens_per_second, contextSnapshotId: row.context_snapshot_id,
      output: parseJson(row.output_json, {}), cost: row.cost, createdAt: row.created_at
    })));
  app.post<{ Body: { content: string } }>('/api/runs/import-jsonl', (request, reply) => {
    if (!request.body?.content) return reply.code(400).send({ error: 'content 不能为空' });
    return importTraceJsonl(request.body.content);
  });
  app.get('/api/dashboard', () => {
    const summary = get<Record<string, unknown>>(`SELECT COUNT(*) AS runs, SUM(status='success') AS success,
      AVG(latency_ms) AS avg_latency, SUM(total_tokens) AS tokens FROM runs`);
    return {
      runs: Number(summary?.runs ?? 0),
      successRate: Number(summary?.runs ?? 0) ? Number(summary?.success ?? 0) / Number(summary?.runs) : 0,
      avgLatencyMs: Number(summary?.avg_latency ?? 0),
      totalTokens: Number(summary?.tokens ?? 0),
      recent: listRuns().slice(0, 5)
    };
  });
}
