import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// 显式触发数据库初始化（目录/schema/迁移/seed），便于把潜在的 IO/权限错误集中在引导阶段处理，
// 而不是隐藏在某个路由首次访问时才崩溃。initializeDatabase() 幂等。
import { initializeDatabase } from './db/database.ts';
import { agentsRoutes } from './routes/agents.ts';
import { runsRoutes } from './routes/runs.ts';
import { sessionsRoutes } from './routes/sessions.ts';
import { contextRoutes } from './routes/context.ts';
import { toolsRoutes } from './routes/tools.ts';
import { promptsRoutes } from './routes/prompts.ts';
import { playgroundRoutes } from './routes/playground.ts';
import { evalRoutes } from './routes/evals.ts';
import { compareRoutes } from './routes/compare.ts';
import { runtimeRoutes } from './routes/runtime.ts';
import { modelProviderRoutes } from './routes/modelProviders.ts';
import { governanceRoutes } from './routes/governance.ts';
import { workbenchRoutes } from './routes/workbench.ts';

// 引导阶段显式 init：模块加载时会触发一次自动初始化（保证测试与现有 import 顺序兼容），
// 这里再调用一次仅为占位/可视化，确保任何潜在异常不会被忽略而是直接打印并阻断启动。
initializeDatabase();

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
await app.register(agentsRoutes);
await app.register(runsRoutes);
await app.register(sessionsRoutes);
await app.register(contextRoutes);
await app.register(toolsRoutes);
await app.register(promptsRoutes);
await app.register(playgroundRoutes);
await app.register(evalRoutes);
await app.register(compareRoutes);
await app.register(modelProviderRoutes);
await app.register(governanceRoutes);
await app.register(workbenchRoutes);
await app.register(runtimeRoutes);

app.get('/api/health', () => ({ status: 'ok', version: '0.6.0' }));

const webDist = resolve(import.meta.dirname, '../../jarvis-studio-web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });
}

const port = Number(process.env.PORT ?? 4310);
await app.listen({ port, host: '127.0.0.1' });
