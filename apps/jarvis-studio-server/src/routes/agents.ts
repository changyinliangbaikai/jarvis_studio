import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAgent, createAgentWithDefaultPrompt, deleteAgent, getAgent, listAgents, updateAgent, type AgentInput } from '../services/agentService.ts';
import { parseBody, respond } from './routeUtils.ts';

const agentSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  defaultPromptId: z.string().optional(),
  defaultPromptVersionId: z.string().optional(),
  defaultModelProviderId: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultSkillId: z.string().optional(),
  defaultContextStrategyId: z.string().optional(),
  defaultToolPolicyId: z.string().optional(),
  defaultRuntimeId: z.string().optional(),
  outputMode: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
  tags: z.array(z.string()).optional()
});
const agentPatchSchema = agentSchema.partial().refine((value) => Object.keys(value).length > 0, '至少提供一个字段');

export async function agentsRoutes(app: FastifyInstance) {
  app.get('/api/agents', () => listAgents());
  app.post<{ Body: unknown }>('/api/agents', (request, reply) =>
    respond(reply, () => {
      const input = parseBody(request.body, agentSchema) satisfies AgentInput;
      return input.defaultPromptId || input.defaultPromptVersionId ? createAgent(input) : createAgentWithDefaultPrompt(input);
    }, 'Agent 创建失败'));
  app.get<{ Params: { agentId: string } }>('/api/agents/:agentId', (request, reply) =>
    getAgent(request.params.agentId) ?? reply.code(404).send({ error: 'Agent 不存在' }));
  app.put<{ Params: { agentId: string }; Body: unknown }>('/api/agents/:agentId', (request, reply) =>
    respond(reply, () => updateAgent(request.params.agentId, parseBody(request.body, agentPatchSchema)), 'Agent 更新失败'));
  app.post<{ Params: { agentId: string } }>('/api/agents/:agentId/archive', (request, reply) =>
    respond(reply, () => updateAgent(request.params.agentId, { status: 'archived' }), 'Agent 归档失败'));
  app.delete<{ Params: { agentId: string } }>('/api/agents/:agentId', (request, reply) =>
    respond(reply, () => deleteAgent(request.params.agentId), 'Agent 删除失败'));
}
