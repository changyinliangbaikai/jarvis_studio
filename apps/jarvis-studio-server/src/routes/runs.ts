import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, parseJson, run } from '../db/database.ts';
import { createCaseFromRun } from '../services/caseService.ts';
import { importTraceJsonl } from '../services/traceImportService.ts';
import { getRun, listArtifacts, listRawTraceEvents, listRuns, listSpans } from '../services/queryService.ts';
import { parseBody, respond } from './routeUtils.ts';

const importJsonlSchema = z.object({ content: z.string().min(1) });
const markSchema = z.object({
  mark: z.enum(['success', 'failed']).optional(),
  note: z.string().optional(),
  failureTags: z.array(z.string()).optional(),
  worthCase: z.boolean().optional()
});
const convertCaseSchema = z.object({
  name: z.string().optional(),
  expectedOutput: z.string().optional(),
  assertionType: z.enum(['manual', 'keyword', 'json_schema', 'tool_call', 'llm_judge']).optional(),
  assertionConfig: z.unknown().optional(),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  tags: z.array(z.string()).optional()
});

export async function runsRoutes(app: FastifyInstance) {
  app.get('/api/runs', (request) => listRuns(request.query as Record<string, unknown>));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', (request, reply) => {
    const item = getRun(request.params.runId);
    return item ?? reply.code(404).send({ error: 'Run 不存在' });
  });
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/spans', (request) => listSpans(request.params.runId));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/trace', (request) => listRawTraceEvents(request.params.runId));
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
  app.post<{ Body: unknown }>('/api/runs/import-jsonl', (request, reply) =>
    respond(reply, () => importTraceJsonl(parseBody(request.body, importJsonlSchema).content), 'Trace JSONL 导入失败'));
  app.post('/api/runs/clear', (request, reply) =>
    respond(reply, () => {
      run(`DELETE FROM raw_trace_events`);
      run(`DELETE FROM context_segments`);
      run(`DELETE FROM context_snapshots`);
      run(`DELETE FROM llm_calls`);
      run(`DELETE FROM tool_calls`);
      run(`DELETE FROM approvals`);
      run(`DELETE FROM skill_selection_events`);
      run(`DELETE FROM permission_decisions`);
      run(`DELETE FROM failures`);
      run(`DELETE FROM replay_snapshots`);
      run(`DELETE FROM artifacts`);
      run(`DELETE FROM spans`);
      run(`DELETE FROM turns`);
      run(`DELETE FROM eval_results`);
      run(`DELETE FROM runs`);
      run(`DELETE FROM sessions`);
      return { success: true };
    }, '清空执行日志失败'));
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/runs/:runId/convert-to-case', (request, reply) =>
    respond(reply, () => createCaseFromRun(request.params.runId, parseBody(request.body ?? {}, convertCaseSchema)), 'Run 转 Case 失败'));
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/runs/:runId/mark', (request, reply) =>
    respond(reply, () => ({ runId: request.params.runId, ...parseBody(request.body ?? {}, markSchema), saved: true }), 'Run 标记失败'));
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
