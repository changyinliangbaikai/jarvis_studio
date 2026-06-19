import type { FastifyInstance } from 'fastify';
import { listTools } from '../services/queryService.ts';

export async function toolsRoutes(app: FastifyInstance) {
  app.get('/api/tool-calls', (request) => listTools((request.query as { runId?: string }).runId));
  app.get<{ Params: { toolCallId: string } }>('/api/tool-calls/:toolCallId', (request, reply) =>
    listTools().find((item) => item.id === request.params.toolCallId) ?? reply.code(404).send({ error: 'Tool Call 不存在' }));
  app.post('/api/tool-calls/:toolCallId/replay', (_, reply) =>
    reply.code(403).send({ error: 'v0.1 默认禁用工具重放，等待权限处理实现。' }));
}
