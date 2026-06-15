import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import './db/database.ts';
import { runsRoutes } from './routes/runs.ts';
import { sessionsRoutes } from './routes/sessions.ts';
import { contextRoutes } from './routes/context.ts';
import { toolsRoutes } from './routes/tools.ts';
import { promptsRoutes } from './routes/prompts.ts';
import { evalRoutes } from './routes/evals.ts';
import { compareRoutes } from './routes/compare.ts';
import { runtimeRoutes } from './routes/runtime.ts';
import { modelProviderRoutes } from './routes/modelProviders.ts';

const app = Fastify({ logger: true });
app.setErrorHandler((error, request, reply) => {
  const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode
    : 500;
  const message = error instanceof Error ? error.message : String(error || 'Internal Server Error');
  request.log.error({
    err: error,
    method: request.method,
    url: request.url,
    requestId: request.id
  }, 'Unhandled API error');
  return reply.code(statusCode >= 400 ? statusCode : 500).send({
    error: message,
    requestId: request.id
  });
});
await app.register(cors, { origin: true });
await app.register(runsRoutes);
await app.register(sessionsRoutes);
await app.register(contextRoutes);
await app.register(toolsRoutes);
await app.register(promptsRoutes);
await app.register(evalRoutes);
await app.register(compareRoutes);
await app.register(modelProviderRoutes);
await app.register(runtimeRoutes);

app.get('/api/health', () => ({ status: 'ok', version: '0.3.0' }));

const webDist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });
}

const port = Number(process.env.PORT ?? 4310);
await app.listen({ port, host: '127.0.0.1' });
