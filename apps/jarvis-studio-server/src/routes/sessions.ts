import type { FastifyInstance } from 'fastify';
import { all, get, parseJson } from '../db/database.ts';
import { listTools } from '../services/queryService.ts';

export async function sessionsRoutes(app: FastifyInstance) {
  app.get('/api/sessions', () => all<Record<string, unknown>>(`SELECT * FROM sessions ORDER BY started_at DESC`).map((row) => ({
    id: row.id, projectId: row.project_id, title: row.title, status: row.status, modelProfile: row.model_profile,
    startedAt: row.started_at, endedAt: row.ended_at, metadata: parseJson(row.metadata_json, {})
  })));
  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', (request, reply) => {
    const item = get(`SELECT * FROM sessions WHERE id=?`, request.params.sessionId);
    return item ?? reply.code(404).send({ error: 'Session 不存在' });
  });
  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/turns', (request) =>
    all<Record<string, unknown>>(`SELECT * FROM turns WHERE session_id=? ORDER BY turn_index`, request.params.sessionId).map((row) => ({
      id: row.id, sessionId: row.session_id, index: row.turn_index, userMessage: row.user_message,
      assistantMessage: row.assistant_message, status: row.status, startedAt: row.started_at, endedAt: row.ended_at,
      tools: listTools().filter((tool) => tool.turnId === row.id),
      artifacts: all<Record<string, unknown>>(`SELECT * FROM artifacts WHERE turn_id=? ORDER BY created_at`, String(row.id)).map((artifact) => ({
        id: artifact.id, runId: artifact.run_id, turnId: artifact.turn_id, type: artifact.type,
        path: artifact.path, sha256: artifact.sha256, sizeBytes: artifact.size_bytes, createdAt: artifact.created_at
      }))
    })));
}
