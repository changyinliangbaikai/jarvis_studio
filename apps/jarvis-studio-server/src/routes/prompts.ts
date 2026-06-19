import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPrompt, createPromptVersion, getPrompt, listPrompts, testPrompt, type PromptInput } from '../services/promptService.ts';
import { parseBody, respond } from './routeUtils.ts';

const promptInputSchema = z.object({
  name: z.string().trim().min(1),
  version: z.string().optional(),
  content: z.string().min(1),
  linkedSkill: z.string().optional(),
  changelog: z.string().optional()
});
const promptVersionSchema = promptInputSchema.partial().refine((value) => Object.keys(value).length > 0, '至少提供一个字段');
const promptTestSchema = z.object({
  variables: z.record(z.string()).default({}),
  inputMessage: z.string().optional()
});

export async function promptsRoutes(app: FastifyInstance) {
  app.get('/api/prompts', () => listPrompts());
  app.post<{ Body: unknown }>('/api/prompts', (request, reply) =>
    respond(reply, () => createPrompt(parseBody(request.body, promptInputSchema) satisfies PromptInput), 'Prompt 创建失败'));
  app.get<{ Params: { promptId: string } }>('/api/prompts/:promptId', (request, reply) =>
    getPrompt(request.params.promptId) ?? reply.code(404).send({ error: 'Prompt 不存在' }));
  app.post<{ Params: { promptId: string }; Body: unknown }>('/api/prompts/:promptId/new-version', (request, reply) =>
    respond(reply, () => createPromptVersion(request.params.promptId, parseBody(request.body, promptVersionSchema)), 'Prompt 版本创建失败'));
  app.post<{ Params: { promptId: string }; Body: unknown }>('/api/prompts/:promptId/test', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, promptTestSchema);
      return testPrompt(request.params.promptId, body.variables ?? {}, body.inputMessage ?? '测试输入');
    }, 'Prompt 测试失败'));
}
