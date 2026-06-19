import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  approveApproval,
  approveApprovalWithChanges,
  artifactDownloadInfo,
  cancelTask,
  compareTasks,
  convertTaskToEvalCase,
  createScenario,
  createTask,
  createWorkspace,
  deleteArtifact,
  deleteScenario,
  deleteTask,
  deleteWorkspace,
  getApproval,
  getArtifact,
  getScenario,
  getTask,
  getWorkbenchDashboard,
  getWorkspace,
  listApprovals,
  listArtifacts,
  listScenarios,
  listTaskEvents,
  listTaskRuns,
  listTasks,
  listWorkspaceFiles,
  markArtifactFinal,
  previewArtifact,
  rejectApproval,
  resumeTaskAfterApproval,
  replayTask,
  runScenarioPreflight,
  runTaskPostflight,
  runTaskPreflight,
  startTask,
  updateScenario,
  updateTask,
  updateWorkspace,
  listWorkspaces
} from '../services/workbenchService.ts';
import { parseBody, respond } from './routeUtils.ts';

const jsonObjectSchema = z.record(z.unknown());
const workspaceInputSchema = z.object({
  name: z.string().trim().min(1),
  rootPath: z.string().optional(),
  defaultModelProfileId: z.string().optional(),
  defaultPolicyId: z.string().optional(),
  defaultContextPolicyId: z.string().optional(),
  settings: jsonObjectSchema.optional()
});
const workspaceUpdateSchema = workspaceInputSchema.partial();
const taskInputSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  scenarioTemplateId: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  input: jsonObjectSchema.optional(),
  inputFiles: z.array(z.string()).optional(),
  message: z.string().optional(),
  selectedModelProfileId: z.string().optional(),
  selectedSkillId: z.string().optional(),
  selectedPromptVersion: z.string().optional()
});
const taskUpdateSchema = taskInputSchema.partial();
const taskCompareSchema = z.object({ leftTaskId: z.string().min(1), rightTaskId: z.string().min(1) });
const approvalBodySchema = z.object({ approvedBy: z.string().optional(), note: z.string().optional() });
const approvalWithChangesSchema = approvalBodySchema.extend({ changes: z.unknown().optional() });
const resumeBodySchema = z.object({ approvalId: z.string().optional() });
const scenarioInputSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  defaultSkillId: z.string().optional(),
  requiredTools: z.array(z.string()).optional(),
  defaultOutputs: z.array(z.string()).optional(),
  preflight: z.array(z.unknown()).optional(),
  postflight: z.array(z.unknown()).optional()
});
const scenarioUpdateSchema = scenarioInputSchema.partial();
const scenarioPreflightSchema = z.object({
  workspaceId: z.string().optional(),
  inputFiles: z.array(z.string()).optional(),
  modelProfileId: z.string().optional()
});
const postflightBodySchema = z.object({ taskId: z.string().min(1) });

export async function workbenchRoutes(app: FastifyInstance) {
  app.get('/api/workbench/dashboard', () => getWorkbenchDashboard());

  app.get('/api/workspaces', () => listWorkspaces());
  app.post<{ Body: unknown }>('/api/workspaces', (request, reply) =>
    respond(reply, () => createWorkspace(parseBody(request.body, workspaceInputSchema)), 'Workspace 创建失败'));
  app.get<{ Params: { id: string } }>('/api/workspaces/:id', (request, reply) =>
    getWorkspace(request.params.id) ?? reply.code(404).send({ error: 'Workspace 不存在' }));
  app.put<{ Params: { id: string }; Body: unknown }>('/api/workspaces/:id', (request, reply) =>
    respond(reply, () => updateWorkspace(request.params.id, parseBody(request.body, workspaceUpdateSchema)), 'Workspace 更新失败'));
  app.delete<{ Params: { id: string } }>('/api/workspaces/:id', (request, reply) =>
    respond(reply, () => deleteWorkspace(request.params.id)));
  app.get<{ Params: { id: string }; Querystring: { maxDepth?: number; maxEntries?: number } }>('/api/workspaces/:id/files', (request, reply) =>
    respond(reply, () => listWorkspaceFiles(request.params.id, request.query)));
  app.get<{ Params: { id: string } }>('/api/workspaces/:id/tasks', (request) =>
    listTasks({ workspaceId: request.params.id }));
  app.get<{ Params: { id: string } }>('/api/workspaces/:id/artifacts', (request) =>
    listArtifacts({ workspaceId: request.params.id }));

  app.get<{ Querystring: { workspaceId?: string; status?: string; scenarioTemplateId?: string } }>('/api/tasks', (request) =>
    listTasks(request.query));
  app.post<{ Body: unknown }>('/api/tasks/compare', (request, reply) =>
    respond(reply, () => {
      const body = parseBody(request.body, taskCompareSchema);
      return compareTasks(body.leftTaskId, body.rightTaskId);
    }, 'Task 对比失败'));
  app.post<{ Body: unknown }>('/api/tasks', (request, reply) =>
    respond(reply, () => createTask(parseBody(request.body, taskInputSchema)), 'Task 创建失败'));
  app.get<{ Params: { id: string } }>('/api/tasks/:id', (request, reply) =>
    getTask(request.params.id) ?? reply.code(404).send({ error: 'Task 不存在' }));
  app.put<{ Params: { id: string }; Body: unknown }>('/api/tasks/:id', (request, reply) =>
    respond(reply, () => updateTask(request.params.id, parseBody(request.body, taskUpdateSchema)), 'Task 更新失败'));
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', (request, reply) =>
    respond(reply, () => deleteTask(request.params.id)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/preflight', (request, reply) =>
    respond(reply, () => runTaskPreflight(request.params.id)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/postflight', (request, reply) =>
    respond(reply, () => runTaskPostflight(request.params.id)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/start', (request, reply) => {
    try {
      const result = startTask(request.params.id);
      return reply.code(result.started ? 202 : 409).send(result);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Task 启动失败' });
    }
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', (request, reply) =>
    respond(reply, () => cancelTask(request.params.id)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/replay', (request, reply) => {
    try {
      const result = replayTask(request.params.id);
      return reply.code(result.started ? 202 : 409).send(result);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Task Replay 失败' });
    }
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/tasks/:id/resume', (request, reply) => {
    try {
      const result = resumeTaskAfterApproval(request.params.id, parseBody(request.body, resumeBodySchema));
      return reply.code(result.started ? 202 : 409).send(result);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Task Resume 失败' });
    }
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/convert-to-eval-case', (request, reply) =>
    respond(reply, () => convertTaskToEvalCase(request.params.id)));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/runs', (request) => listTaskRuns(request.params.id));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/artifacts', (request) => listArtifacts({ taskId: request.params.id }));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/approvals', (request) => listApprovals({ taskId: request.params.id }));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', (request) => listTaskEvents(request.params.id));

  app.get<{ Querystring: { workspaceId?: string; taskId?: string; runId?: string; finalOnly?: boolean } }>('/api/artifacts', (request) =>
    listArtifacts({ ...request.query, finalOnly: Boolean(request.query.finalOnly) }));
  app.get<{ Params: { id: string } }>('/api/artifacts/:id', (request, reply) =>
    getArtifact(request.params.id) ?? reply.code(404).send({ error: 'Artifact 不存在' }));
  app.get<{ Params: { id: string } }>('/api/artifacts/:id/preview', (request, reply) =>
    respond(reply, () => previewArtifact(request.params.id)));
  app.get<{ Params: { id: string } }>('/api/artifacts/:id/download', (request, reply) => {
    try {
      const info = artifactDownloadInfo(request.params.id);
      return reply.header('content-type', info.mimeType)
        .header('content-disposition', `attachment; filename="${info.filename}"`)
        .send(createReadStream(info.absolutePath));
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : 'Artifact 文件不存在' });
    }
  });
  app.post<{ Params: { id: string } }>('/api/artifacts/:id/mark-final', (request, reply) =>
    respond(reply, () => markArtifactFinal(request.params.id)));
  app.delete<{ Params: { id: string }; Querystring: { deleteFile?: boolean } }>('/api/artifacts/:id', (request, reply) =>
    respond(reply, () => deleteArtifact(request.params.id, { deleteFile: Boolean(request.query.deleteFile) })));

  app.get<{ Querystring: { workspaceId?: string; taskId?: string; status?: string } }>('/api/approvals', (request) =>
    listApprovals(request.query));
  app.get<{ Params: { id: string } }>('/api/approvals/:id', (request, reply) =>
    getApproval(request.params.id) ?? reply.code(404).send({ error: 'Approval 不存在' }));
  app.post<{ Params: { id: string }; Body: unknown }>('/api/approvals/:id/approve', (request, reply) =>
    respond(reply, () => approveApproval(request.params.id, parseBody(request.body, approvalBodySchema)), 'Approval 批准失败'));
  app.post<{ Params: { id: string }; Body: unknown }>('/api/approvals/:id/reject', (request, reply) =>
    respond(reply, () => rejectApproval(request.params.id, parseBody(request.body, approvalBodySchema)), 'Approval 拒绝失败'));
  app.post<{ Params: { id: string }; Body: unknown }>('/api/approvals/:id/approve-with-changes', (request, reply) =>
    respond(reply, () => approveApprovalWithChanges(request.params.id, parseBody(request.body, approvalWithChangesSchema)), 'Approval 带修改批准失败'));

  app.get('/api/scenarios', () => listScenarios());
  app.post<{ Body: unknown }>('/api/scenarios', (request, reply) =>
    respond(reply, () => createScenario(parseBody(request.body, scenarioInputSchema)), 'Scenario 创建失败'));
  app.get<{ Params: { id: string } }>('/api/scenarios/:id', (request, reply) =>
    getScenario(request.params.id) ?? reply.code(404).send({ error: 'Scenario 不存在' }));
  app.put<{ Params: { id: string }; Body: unknown }>('/api/scenarios/:id', (request, reply) =>
    respond(reply, () => updateScenario(request.params.id, parseBody(request.body, scenarioUpdateSchema)), 'Scenario 更新失败'));
  app.delete<{ Params: { id: string } }>('/api/scenarios/:id', (request, reply) =>
    respond(reply, () => deleteScenario(request.params.id)));
  app.post<{ Params: { id: string }; Body: unknown }>('/api/scenarios/:id/preflight', (request, reply) =>
    respond(reply, () => runScenarioPreflight(request.params.id, parseBody(request.body, scenarioPreflightSchema)), 'Scenario Preflight 失败'));
  app.post<{ Params: { id: string }; Body: unknown }>('/api/scenarios/:id/postflight', (request, reply) =>
    respond(reply, () => runTaskPostflight(parseBody(request.body, postflightBodySchema).taskId), 'Scenario Postflight 失败'));
}
