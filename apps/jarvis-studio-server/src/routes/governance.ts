import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createRunSnapshot,
  getRunGovernance,
  getRunSnapshot,
  getSkillRegistryItem,
  getToolRegistryItem,
  listAuditLogs,
  listContextStrategies,
  listPermissionDecisions,
  listPermissionPolicies,
  listSkillRegistry,
  listToolRegistry,
  replayRun,
  saveContextStrategy,
  savePermissionPolicy,
  setPermissionDecision,
  setSkillStatus,
  setToolEnabled,
  syncSkillRegistry,
  syncToolRegistry,
  testSkill,
  updateToolPolicy
} from '../services/governanceService.ts';
import { createExperiment, experimentReport, getExperiment, listExperiments, runExperiment, type ExperimentInput } from '../services/experimentService.ts';
import { failureStats, getFailure, linkFailureFix, listFailures, updateFailureStatus, type FailureStatus } from '../services/failureService.ts';
import { parseBody, respond } from './routeUtils.ts';

const skillTestSchema = z.object({
  message: z.string().optional(),
  files: z.array(z.string()).optional(),
  modelProviderId: z.string().optional(),
  modelName: z.string().optional(),
  temperature: z.coerce.number().optional()
});
const toolPolicySchema = z.object({
  riskLevel: z.string().optional(),
  defaultPolicy: z.string().optional(),
  enabled: z.boolean().optional()
});
const permissionPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().optional()
});
const contextStrategySchema = permissionPolicySchema;
const failureStatusSchema = z.object({
  status: z.union([z.literal('open'), z.literal('investigating'), z.literal('fixed'), z.literal('ignored')]),
  fixedByRunId: z.string().optional()
});
const failureFixSchema = z.object({
  promptVersion: z.string().optional(),
  skillVersion: z.string().optional(),
  toolVersion: z.string().optional(),
  runId: z.string().optional(),
  note: z.string().optional()
});
const replayOverridesSchema = z.object({
  modelProviderId: z.string().optional(),
  modelName: z.string().optional(),
  promptVersion: z.string().optional(),
  skillVersion: z.string().optional(),
  contextStrategy: z.string().optional(),
  toolPolicy: z.string().optional()
});
const experimentSchema = z.object({
  name: z.string().trim().min(1),
  evalSetId: z.string().min(1),
  matrix: z.object({
    modelProviderIds: z.array(z.string()).optional(),
    modelNames: z.array(z.string()).optional(),
    promptVersions: z.array(z.string()).optional(),
    skillVersions: z.array(z.string()).optional(),
    contextStrategies: z.array(z.string()).optional(),
    toolPolicies: z.array(z.string()).optional(),
    temperatures: z.array(z.coerce.number()).optional()
  })
});

export async function governanceRoutes(app: FastifyInstance) {
  app.get('/api/skills', () => listSkillRegistry());
  app.post('/api/skills/import', () => {
    syncSkillRegistry();
    return { imported: listSkillRegistry().length };
  });
  app.get<{ Params: { skillId: string } }>('/api/skills/:skillId', (request, reply) =>
    getSkillRegistryItem(request.params.skillId) ?? reply.code(404).send({ error: 'Skill 不存在' }));
  app.get<{ Params: { skillId: string } }>('/api/skills/:skillId/versions', (request, reply) =>
    getSkillRegistryItem(request.params.skillId)?.versions ?? reply.code(404).send({ error: 'Skill 不存在' }));
  app.post<{ Params: { skillId: string } }>('/api/skills/:skillId/enable', (request, reply) =>
    respond(reply, () => setSkillStatus(request.params.skillId, 'enabled')));
  app.post<{ Params: { skillId: string } }>('/api/skills/:skillId/disable', (request, reply) =>
    respond(reply, () => setSkillStatus(request.params.skillId, 'disabled')));
  app.post<{ Params: { skillId: string }; Body: unknown }>('/api/skills/:skillId/test', (request, reply) =>
    respond(reply, () => testSkill(request.params.skillId, parseBody(request.body, skillTestSchema)), 'Skill 测试失败'));
  app.get<{ Params: { skillId: string } }>('/api/skills/:skillId/runs', (request, reply) =>
    getSkillRegistryItem(request.params.skillId)?.runs ?? reply.code(404).send({ error: 'Skill 不存在' }));
  app.get<{ Params: { skillId: string } }>('/api/skills/:skillId/failures', (request) =>
    listFailures({ skillId: request.params.skillId }));

  app.get('/api/tools', () => listToolRegistry());
  app.post('/api/tools/register', () => {
    syncToolRegistry();
    return { registered: listToolRegistry().length };
  });
  app.get<{ Params: { toolId: string } }>('/api/tools/:toolId', (request, reply) =>
    getToolRegistryItem(request.params.toolId) ?? reply.code(404).send({ error: 'Tool 不存在' }));
  app.get<{ Params: { toolId: string } }>('/api/tools/:toolId/schema', (request, reply) =>
    (getToolRegistryItem(request.params.toolId)?.manifest as Record<string, unknown> | undefined)?.inputSchema ?? reply.code(404).send({ error: 'Tool 不存在' }));
  app.get<{ Params: { toolId: string } }>('/api/tools/:toolId/runs', (request, reply) =>
    getToolRegistryItem(request.params.toolId)?.calls ?? reply.code(404).send({ error: 'Tool 不存在' }));
  app.get<{ Params: { toolId: string } }>('/api/tools/:toolId/failures', (request) =>
    listFailures({ toolId: request.params.toolId }));
  app.post<{ Params: { toolId: string } }>('/api/tools/:toolId/enable', (request, reply) =>
    respond(reply, () => setToolEnabled(request.params.toolId, true)));
  app.post<{ Params: { toolId: string } }>('/api/tools/:toolId/disable', (request, reply) =>
    respond(reply, () => setToolEnabled(request.params.toolId, false)));
  app.patch<{ Params: { toolId: string }; Body: unknown }>('/api/tools/:toolId/policy', (request, reply) =>
    respond(reply, () => updateToolPolicy(request.params.toolId, parseBody(request.body, toolPolicySchema)), 'Tool 策略更新失败'));

  app.get('/api/permissions/policies', () => ({ policies: listPermissionPolicies() }));
  app.post<{ Body: unknown }>('/api/permissions/policies', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, permissionPolicySchema);
      return savePermissionPolicy({ ...body, config: body.config ?? {} });
    }, 'Permission Policy 保存失败'));
  app.get('/api/permissions/decisions', (request) => listPermissionDecisions(request.query as Record<string, unknown>));
  app.post<{ Params: { decisionId: string } }>('/api/permissions/decisions/:decisionId/approve', (request, reply) =>
    respond(reply, () => setPermissionDecision(request.params.decisionId, 'allow')));
  app.post<{ Params: { decisionId: string } }>('/api/permissions/decisions/:decisionId/deny', (request, reply) =>
    respond(reply, () => setPermissionDecision(request.params.decisionId, 'deny')));

  app.get('/api/context/strategies', () => listContextStrategies());
  app.post<{ Body: unknown }>('/api/context/strategies', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, contextStrategySchema);
      return saveContextStrategy({ ...body, config: body.config ?? {} });
    }, 'Context Strategy 保存失败'));

  app.get('/api/failures', (request) => listFailures(request.query as Record<string, unknown>));
  app.get('/api/failures/stats', () => failureStats());
  app.get<{ Params: { failureId: string } }>('/api/failures/:failureId', (request, reply) =>
    getFailure(request.params.failureId) ?? reply.code(404).send({ error: 'Failure 不存在' }));
  app.patch<{ Params: { failureId: string }; Body: unknown }>('/api/failures/:failureId/status', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, failureStatusSchema);
      return updateFailureStatus(request.params.failureId, body.status satisfies FailureStatus, body.fixedByRunId);
    }, 'Failure 状态更新失败'));
  app.post<{ Params: { failureId: string }; Body: unknown }>('/api/failures/:failureId/link-fix', (request, reply) =>
    respond(reply, () => linkFailureFix(request.params.failureId, parseBody(request.body, failureFixSchema)), 'Failure 修复关联失败'));

  app.get<{ Params: { runId: string } }>('/api/runs/:runId/governance', (request, reply) =>
    getRunGovernance(request.params.runId) ?? reply.code(404).send({ error: 'Run 不存在' }));
  app.post<{ Params: { runId: string } }>('/api/runs/:runId/snapshot', (request, reply) =>
    respond(reply, () => createRunSnapshot(request.params.runId)));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/snapshot', (request, reply) =>
    respond(reply, () => getRunSnapshot(request.params.runId)));
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/runs/:runId/replay', (request, reply) =>
    respond(reply, () => replayRun(request.params.runId, {}), 'Replay 失败'));
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/runs/:runId/replay-with-overrides', (request, reply) =>
    respond(reply, () => replayRun(request.params.runId, parseBody(request.body, replayOverridesSchema)), 'Replay 失败'));

  app.get('/api/experiments', () => listExperiments());
  app.post<{ Body: unknown }>('/api/experiments', (request, reply) =>
    respond(reply, () => createExperiment(parseBody(request.body, experimentSchema) satisfies ExperimentInput), 'Experiment 创建失败'));
  app.get<{ Params: { experimentId: string } }>('/api/experiments/:experimentId', (request, reply) =>
    getExperiment(request.params.experimentId) ?? reply.code(404).send({ error: 'Experiment 不存在' }));
  app.post<{ Params: { experimentId: string } }>('/api/experiments/:experimentId/run', (request, reply) =>
    respond(reply, () => runExperiment(request.params.experimentId), 'Experiment 运行失败'));
  app.get<{ Params: { experimentId: string } }>('/api/experiments/:experimentId/results', (request, reply) =>
    getExperiment(request.params.experimentId)?.results ?? reply.code(404).send({ error: 'Experiment 不存在' }));
  app.get<{ Params: { experimentId: string } }>('/api/experiments/:experimentId/report', (request, reply) =>
    respond(reply, () => experimentReport(request.params.experimentId)));

  app.get('/api/audit-logs', (request) => listAuditLogs(request.query as Record<string, unknown>));
}
