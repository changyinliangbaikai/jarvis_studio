import type { FastifyInstance } from 'fastify';
import { createPrompt, createPromptVersion, getPrompt, listPrompts, testPrompt, type PromptInput } from '../services/promptService.ts';

export async function promptsRoutes(app: FastifyInstance) {
  app.get('/api/prompts', () => listPrompts());
  app.post<{ Body: PromptInput }>('/api/prompts', (request, reply) => {
    if (!request.body?.name || !request.body?.content) return reply.code(400).send({ error: 'name 和 content 不能为空' });
    return createPrompt(request.body);
  });
  app.get<{ Params: { promptId: string } }>('/api/prompts/:promptId', (request, reply) =>
    getPrompt(request.params.promptId) ?? reply.code(404).send({ error: 'Prompt 不存在' }));
  app.post<{ Params: { promptId: string }; Body: Partial<PromptInput> }>('/api/prompts/:promptId/new-version', (request) =>
    createPromptVersion(request.params.promptId, request.body ?? {}));
  app.post<{ Params: { promptId: string }; Body: { variables?: Record<string, string>; inputMessage?: string } }>('/api/prompts/:promptId/test', (request) =>
    testPrompt(request.params.promptId, request.body.variables ?? {}, request.body.inputMessage ?? '测试输入'));
}
