import type { FastifyInstance } from 'fastify';
import type { TraceEvent } from '@jarvis/trace-sdk';
import { z } from 'zod';
import { isRuntimeActive, runtimeCapabilities, runtimeEventHistory, startRuntimeRun, subscribeToRun } from '../runtime/runtimeService.ts';
import { resolveModelProvider } from '../services/modelProviderService.ts';
import { parseBody, respond } from './routeUtils.ts';

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

const createRunSchema = z.object({
  name: z.string().optional(),
  message: z.string().trim().min(1),
  skill: z.string().optional(),
  files: z.array(z.string()).default([]),
  providerId: z.string().optional(),
  provider: z.union([z.literal('deterministic'), z.literal('openai-compatible')]).optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  temperature: z.coerce.number().optional()
});

export async function runtimeRoutes(app: FastifyInstance) {
  app.get('/api/runtime/capabilities', () => runtimeCapabilities());
  app.post<{ Body: unknown }>('/api/runtime/runs', (request, reply) => respond(reply, () => {
    const body: CreateRunBody = parseBody(request.body, createRunSchema);
    let modelProfile;
    if (body.providerId || !body.provider) {
      const resolved = resolveModelProvider(body.providerId);
      modelProfile = { ...resolved.profile, model: body.model ?? resolved.profile.model, temperature: body.temperature };
    } else {
      const provider = body.provider;
      modelProfile = {
        provider,
        model: body.model ?? (provider === 'openai-compatible' ? process.env.OPENAI_MODEL ?? 'qwen3' : 'deterministic-local'),
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        temperature: body.temperature
      };
    }
    const { ids } = startRuntimeRun({
      name: body.name,
      message: body.message,
      skill: body.skill,
      files: body.files,
      modelProfile
    });
    return reply.code(202).send({ ...ids, eventsUrl: `/api/runtime/runs/${ids.runId}/events` });
  }, 'Runtime Run 创建失败'));
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
    const unsubscribe = subscribeToRun(request.params.runId, (event: TraceEvent) => {
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
