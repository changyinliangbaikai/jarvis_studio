import type { FastifyInstance } from 'fastify';
import { all, get, parseJson } from '../db/database.ts';

function segments(snapshotId: string) {
  return all<Record<string, unknown>>(`SELECT * FROM context_segments WHERE snapshot_id=? ORDER BY priority DESC, rowid`, snapshotId).map((row) => ({
    id: row.id, snapshotId: row.snapshot_id, type: row.type, name: row.name, version: row.version,
    contentRef: row.content_ref, preview: row.preview, tokens: row.tokens, included: Boolean(row.included),
    truncated: Boolean(row.truncated), compressed: Boolean(row.compressed), priority: row.priority, reason: row.reason,
    tokensBefore: row.tokens_before ?? row.tokens,
    tokensAfter: row.tokens_after ?? row.tokens,
    action: row.action ?? (row.compressed ? 'compress' : row.truncated ? 'truncate' : row.included ? 'keep' : 'drop'),
    metadata: parseJson(row.metadata_json, {})
  }));
}
function snapshot(id: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM context_snapshots WHERE id=?`, id);
  return row && {
    id: row.id, runId: row.run_id, turnId: row.turn_id, llmCallId: row.llm_call_id,
    totalTokens: row.total_tokens, maxContextTokens: row.max_context_tokens, truncated: Boolean(row.truncated),
    compressed: Boolean(row.compressed),
    totalTokensBeforeBudget: row.total_tokens_before_budget ?? row.total_tokens,
    totalTokensAfterBudget: row.total_tokens_after_budget ?? row.total_tokens,
    budgetStrategy: row.budget_strategy ?? 'segmented-snapshot@v0.2',
    reservedOutputTokens: row.reserved_output_tokens ?? 0,
    risks: parseJson(row.risk_json, []),
    finalPromptRef: row.final_prompt_ref, finalPrompt: row.final_prompt,
    createdAt: row.created_at, segments: segments(id)
  };
}
export async function contextRoutes(app: FastifyInstance) {
  app.get('/api/context-snapshots', () => all<Record<string, unknown>>(`SELECT * FROM context_snapshots ORDER BY created_at DESC`).map((row) => snapshot(String(row.id))));
  app.get('/api/context/snapshots', () => all<Record<string, unknown>>(`SELECT * FROM context_snapshots ORDER BY created_at DESC`).map((row) => snapshot(String(row.id))));
  app.get<{ Params: { snapshotId: string } }>('/api/context-snapshots/:snapshotId', (request, reply) =>
    snapshot(request.params.snapshotId) ?? reply.code(404).send({ error: 'Context Snapshot 不存在' }));
  app.get<{ Params: { snapshotId: string } }>('/api/context/snapshots/:snapshotId', (request, reply) =>
    snapshot(request.params.snapshotId) ?? reply.code(404).send({ error: 'Context Snapshot 不存在' }));
  app.get<{ Params: { snapshotId: string } }>('/api/context-snapshots/:snapshotId/segments', (request) => segments(request.params.snapshotId));
  app.get<{ Params: { snapshotId: string } }>('/api/context/snapshots/:snapshotId/segments', (request) => segments(request.params.snapshotId));
  app.get<{ Params: { snapshotId: string } }>('/api/context/risk-analysis/:snapshotId', (request, reply) => {
    const item = snapshot(request.params.snapshotId);
    return item ? { snapshotId: item.id, risks: item.risks, utilization: Number(item.totalTokensAfterBudget ?? item.totalTokens ?? 0) / Number(item.maxContextTokens ?? 1) } : reply.code(404).send({ error: 'Context Snapshot 不存在' });
  });
  app.get<{ Params: { snapshotId: string } }>('/api/context-snapshots/:snapshotId/final-prompt', (request) => {
    const item = snapshot(request.params.snapshotId);
    return { finalPrompt: item?.finalPrompt || item?.segments.filter((segment) => segment.included).map((segment) => segment.preview ?? `[${segment.type}] ${segment.name}`).join('\n\n') || '' };
  });
  app.get<{ Params: { snapshotId: string; otherSnapshotId: string } }>('/api/context-snapshots/:snapshotId/diff/:otherSnapshotId', (request) => {
    const left = snapshot(request.params.snapshotId);
    const right = snapshot(request.params.otherSnapshotId);
    const leftIds = new Set(left?.segments.map((segment) => segment.id));
    const rightIds = new Set(right?.segments.map((segment) => segment.id));
    return {
      left, right,
      added: right?.segments.filter((segment) => !leftIds.has(segment.id)) ?? [],
      removed: left?.segments.filter((segment) => !rightIds.has(segment.id)) ?? []
    };
  });
  app.get<{ Params: { snapshotId: string }; Querystring: { compareTo?: string } }>('/api/context/snapshots/:snapshotId/diff', (request, reply) => {
    if (!request.query.compareTo) return reply.code(400).send({ error: 'compareTo 不能为空' });
    const left = snapshot(request.params.snapshotId);
    const right = snapshot(request.query.compareTo);
    const leftByType = new Map(left?.segments.map((segment) => [segment.type, segment]));
    const rightByType = new Map(right?.segments.map((segment) => [segment.type, segment]));
    return {
      left,
      right,
      changed: [...new Set([...(leftByType.keys()), ...(rightByType.keys())])].map((type) => ({
        type,
        leftTokens: leftByType.get(type)?.tokensAfter ?? leftByType.get(type)?.tokens ?? 0,
        rightTokens: rightByType.get(type)?.tokensAfter ?? rightByType.get(type)?.tokens ?? 0,
        leftAction: leftByType.get(type)?.action,
        rightAction: rightByType.get(type)?.action
      }))
    };
  });
}
