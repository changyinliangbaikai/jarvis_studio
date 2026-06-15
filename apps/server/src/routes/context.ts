import type { FastifyInstance } from 'fastify';
import { all, get } from '../db/database.ts';

function segments(snapshotId: string) {
  return all<Record<string, unknown>>(`SELECT * FROM context_segments WHERE snapshot_id=? ORDER BY priority DESC, rowid`, snapshotId).map((row) => ({
    id: row.id, snapshotId: row.snapshot_id, type: row.type, name: row.name, version: row.version,
    contentRef: row.content_ref, preview: row.preview, tokens: row.tokens, included: Boolean(row.included),
    truncated: Boolean(row.truncated), compressed: Boolean(row.compressed), priority: row.priority, reason: row.reason
  }));
}
function snapshot(id: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM context_snapshots WHERE id=?`, id);
  return row && {
    id: row.id, runId: row.run_id, turnId: row.turn_id, llmCallId: row.llm_call_id,
    totalTokens: row.total_tokens, maxContextTokens: row.max_context_tokens, truncated: Boolean(row.truncated),
    compressed: Boolean(row.compressed), finalPromptRef: row.final_prompt_ref, finalPrompt: row.final_prompt,
    createdAt: row.created_at, segments: segments(id)
  };
}
export async function contextRoutes(app: FastifyInstance) {
  app.get('/api/context-snapshots', () => all<Record<string, unknown>>(`SELECT * FROM context_snapshots ORDER BY created_at DESC`).map((row) => snapshot(String(row.id))));
  app.get<{ Params: { snapshotId: string } }>('/api/context-snapshots/:snapshotId', (request, reply) =>
    snapshot(request.params.snapshotId) ?? reply.code(404).send({ error: 'Context Snapshot 不存在' }));
  app.get<{ Params: { snapshotId: string } }>('/api/context-snapshots/:snapshotId/segments', (request) => segments(request.params.snapshotId));
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
}
