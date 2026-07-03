import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAgent } from '../services/agentService.ts';
import { testPrompt } from '../services/promptService.ts';
import { parseBody, respond } from './routeUtils.ts';

const playgroundRunSchema = z.object({
  agentId: z.string().optional(),
  promptId: z.string().optional(),
  promptVersionId: z.string().optional(),
  inputMessage: z.string().optional(),
  input: z.string().optional(),
  variables: z.record(z.string()).default({}),
  modelProviderId: z.string().optional(),
  model: z.string().optional(),
  modelName: z.string().optional(),
  runtimeId: z.string().optional(),
  contextStrategy: z.string().optional(),
  toolPolicy: z.string().optional()
}).refine((value) => Boolean(value.inputMessage?.trim() || value.input?.trim()), '请输入测试内容');
type PlaygroundRunBody = Omit<z.infer<typeof playgroundRunSchema>, 'variables'> & { variables?: Record<string, string> };

export async function playgroundRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>('/api/playground/run', (request, reply) =>
    respond(reply, () => runPlayground(parseBody(request.body, playgroundRunSchema)), 'Playground 运行失败'));
  app.post<{ Body: unknown }>('/api/playground/runs', (request, reply) =>
    respond(reply, () => {
      const result = runPlayground(parseBody(request.body, playgroundRunSchema));
      return {
        runId: result.runId,
        status: 'success',
        output: result.response,
        traceUrl: `/runs/${result.runId}`,
        renderedPrompt: result.rendered,
        promptVersionId: result.prompt.id,
        summary: {
          latencyMs: 150,
          totalTokens: Math.ceil((result.rendered.length + result.response.length) / 4),
          toolCallCount: 0
        }
      };
    }, 'Playground 运行失败'));
}

function runPlayground(body: PlaygroundRunBody) {
  const normalizedInput = body.input ?? body.inputMessage ?? '';
  const agent = body.agentId ? getAgent(body.agentId) : undefined;
  const promptId = body.promptVersionId ?? body.promptId ?? agent?.defaultPromptVersionId ?? agent?.defaultPromptId;
  if (!promptId) throw new Error('请选择 Prompt，或先给 Agent 绑定默认 Prompt');
  return testPrompt(String(promptId), body.variables ?? {}, normalizedInput, { ...body, source: 'playground', modelName: body.modelName ?? body.model });
}
