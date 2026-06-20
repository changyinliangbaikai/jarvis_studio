import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAgent } from '../services/agentService.ts';
import { testPrompt } from '../services/promptService.ts';
import { parseBody, respond } from './routeUtils.ts';

const playgroundRunSchema = z.object({
  agentId: z.string().optional(),
  promptId: z.string().optional(),
  inputMessage: z.string().min(1),
  variables: z.record(z.string()).default({}),
  modelProviderId: z.string().optional(),
  modelName: z.string().optional(),
  contextStrategy: z.string().optional(),
  toolPolicy: z.string().optional()
});

export async function playgroundRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>('/api/playground/run', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, playgroundRunSchema);
      const agent = body.agentId ? getAgent(body.agentId) : undefined;
      const promptId = body.promptId ?? agent?.defaultPromptId;
      if (!promptId) throw new Error('请选择 Prompt，或先给 Agent 绑定默认 Prompt');
      return testPrompt(String(promptId), body.variables ?? {}, body.inputMessage, body);
    }, 'Playground 运行失败'));
}
