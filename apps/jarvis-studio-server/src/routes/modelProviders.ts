import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { diagnosticErrorDetails, logModelProviderError, redactDiagnostic } from '@jarvis/model-gateway';
import {
  createModelProvider,
  deleteModelProvider,
  listModelProviders,
  testModelProvider,
  testModelProviderDraft,
  updateModelProvider,
  type ModelProviderInput
} from '../services/modelProviderService.ts';
import { badRequest, parseBody, respond } from './routeUtils.ts';

const modelProviderInputSchema = z.object({
  name: z.string().trim().min(1),
  providerType: z.literal('openai-compatible').optional(),
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  defaultModel: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  inputPricePer1MTokens: z.coerce.number().nonnegative().optional(),
  outputPricePer1MTokens: z.coerce.number().nonnegative().optional(),
  currency: z.string().optional()
});

const modelProviderDraftSchema = modelProviderInputSchema.extend({
  providerId: z.string().optional()
});

export async function modelProviderRoutes(app: FastifyInstance) {
  app.get('/api/model-providers', () => listModelProviders());
  app.post<{ Body: unknown }>('/api/model-providers', (request, reply) =>
    respond(reply, () => createModelProvider(parseBody(request.body, modelProviderInputSchema) satisfies ModelProviderInput), 'Provider 创建失败'));
  app.put<{ Params: { providerId: string }; Body: unknown }>('/api/model-providers/:providerId', (request, reply) =>
    respond(reply, () => updateModelProvider(request.params.providerId, parseBody(request.body, modelProviderInputSchema) satisfies ModelProviderInput), 'Provider 更新失败'));
  app.delete<{ Params: { providerId: string } }>('/api/model-providers/:providerId', (request, reply) =>
    respond(reply, () => deleteModelProvider(request.params.providerId), 'Provider 删除失败'));
  app.post<{ Body: unknown }>('/api/model-providers/test-connection', (request, reply) => respond(reply, async () => {
    const body = parseBody(request.body, modelProviderDraftSchema);
    try {
      return await testModelProviderDraft(body);
    } catch (error) {
      logConnectionTestError(request, error, {
        mode: 'draft',
        providerId: body.providerId,
        providerName: body.name,
        baseUrl: body.baseUrl,
        model: body.defaultModel
      });
      return badRequest(reply, error, 'Provider 草稿配置无效');
    }
  }, 'Provider 草稿配置无效'));
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
