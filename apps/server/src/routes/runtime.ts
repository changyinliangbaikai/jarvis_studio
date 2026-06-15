import type { FastifyInstance } from 'fastify';
import { isRuntimeActive, runtimeCapabilities, runtimeEventHistory, startRuntimeRun, subscribeToRun } from '../runtime/runtimeService.ts';
import { resolveModelProvider } from '../services/modelProviderService.ts';

interface CreateRunBody {
  name?: string;
  message: string;
  skill?: string;
  files?: string[];
  providerId?: string;
  provider?: 'deterministic' | 'openai-compatible';
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}

export async function runtimeRoutes(app: FastifyInstance) {
  app.get('/api/runtime/capabilities', () => runtimeCapabilities());
  app.post<{ Body: CreateRunBody }>('/api/runtime/runs', (request, reply) => {
    if (!request.body?.message) return reply.code(400).send({ error: 'message 不能为空' });
    let modelProfile;
    try {
      if (request.body.providerId || !request.body.provider) {
        const resolved = resolveModelProvider(request.body.providerId);
        modelProfile = { ...resolved.profile, model: request.body.model ?? resolved.profile.model, temperature: request.body.temperature };
      } else {
        const provider = request.body.provider;
        modelProfile = {
          provider,
          model: request.body.model ?? (provider === 'openai-compatible' ? process.env.OPENAI_MODEL ?? 'qwen3' : 'deterministic-local'),
          baseUrl: request.body.baseUrl,
          apiKey: request.body.apiKey,
          temperature: request.body.temperature
        };
      }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Provider 配置无效' });
    }
    const { ids } = startRuntimeRun({
      name: request.body.name,
      message: request.body.message,
      skill: request.body.skill,
      files: request.body.files ?? [],
      modelProfile
    });
    return reply.code(202).send({ ...ids, eventsUrl: `/api/runtime/runs/${ids.runId}/events` });
  });
  app.get<{ Params: { runId: string } }>('/api/runtime/runs/:runId/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    const history = runtimeEventHistory(request.params.runId);
    for (const event of history) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (!isRuntimeActive(request.params.runId) || history.some((event) => event.eventType === 'run.end')) {
      reply.raw.write(`event: complete\ndata: {"runId":"${request.params.runId}"}\n\n`);
      reply.raw.end();
      return;
    }
    const unsubscribe = subscribeToRun(request.params.runId, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.eventType === 'run.end') {
        reply.raw.write(`event: complete\ndata: {"runId":"${request.params.runId}"}\n\n`);
        unsubscribe();
        reply.raw.end();
      }
    });
    request.raw.on('close', unsubscribe);
  });
}
