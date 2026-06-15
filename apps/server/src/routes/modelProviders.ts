import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { diagnosticErrorDetails, logModelProviderError, redactDiagnostic } from '../../../../packages/jarvis-runtime-lite/src/diagnostics.ts';
import {
  createModelProvider,
  deleteModelProvider,
  listModelProviders,
  testModelProvider,
  testModelProviderDraft,
  updateModelProvider,
  type ModelProviderInput
} from '../services/modelProviderService.ts';

export async function modelProviderRoutes(app: FastifyInstance) {
  app.get('/api/model-providers', () => listModelProviders());
  app.post<{ Body: ModelProviderInput }>('/api/model-providers', (request, reply) =>
    respond(reply, () => createModelProvider(request.body)));
  app.put<{ Params: { providerId: string }; Body: ModelProviderInput }>('/api/model-providers/:providerId', (request, reply) =>
    respond(reply, () => updateModelProvider(request.params.providerId, request.body)));
  app.delete<{ Params: { providerId: string } }>('/api/model-providers/:providerId', (request, reply) =>
    respond(reply, () => deleteModelProvider(request.params.providerId)));
  app.post<{ Body: ModelProviderInput & { providerId?: string } }>('/api/model-providers/test-connection', async (request, reply) => {
    try {
      return await testModelProviderDraft(request.body);
    } catch (error) {
      logConnectionTestError(request, error, {
        mode: 'draft',
        providerId: request.body.providerId,
        providerName: request.body.name,
        baseUrl: request.body.baseUrl,
        model: request.body.defaultModel
      });
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Provider 草稿配置无效' });
    }
  });
  app.post<{ Params: { providerId: string } }>('/api/model-providers/:providerId/test', async (request, reply) => {
    try {
      return await testModelProvider(request.params.providerId);
    } catch (error) {
      logConnectionTestError(request, error, { mode: 'saved', providerId: request.params.providerId });
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Provider 连接测试失败',
        requestId: request.id
      });
    }
  });
}

function respond(reply: FastifyReply, action: () => unknown) {
  try {
    return action();
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Provider 操作失败' });
  }
}

function logConnectionTestError(
  request: FastifyRequest,
  error: unknown,
  context: Record<string, unknown>
) {
  const details = {
    requestId: request.id,
    method: request.method,
    url: request.url,
    ...context,
    error: diagnosticErrorDetails(error)
  };
  logModelProviderError('connection_test.route_error', details);
  request.log.error(redactDiagnostic(details), 'Model provider connection test failed');
}
