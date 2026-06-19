import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import XLSX from 'xlsx';
import { listSkills, toolDefinitions, type RuntimeApprovalRequest, type RuntimeApprovalResult, type RuntimeResult } from '@jarvis/agent-runtime';
import { all, defaultWorkspaceRoot, get, json, parseJson, run } from '../db/database.ts';
import { startRuntimeRun } from '../runtime/runtimeService.ts';
import { resolveModelProvider } from './modelProviderService.ts';

type JsonRecord = Record<string, unknown>;

interface WorkspaceRow extends JsonRecord {
  id: string;
  name: string;
  root_path: string;
  default_model_profile_id: string | null;
  default_policy_id: string | null;
  default_context_policy_id: string | null;
  settings_json: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ScenarioRow extends JsonRecord {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  default_skill_id: string | null;
  required_tools_json: string | null;
  default_outputs_json: string | null;
  preflight_json: string | null;
  postflight_json: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface TaskRow extends JsonRecord {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  category: string | null;
  scenario_template_id: string | null;
  status: string | null;
  priority: string | null;
  input_json: string | null;
  selected_model_profile_id: string | null;
  selected_skill_id: string | null;
  selected_prompt_version: string | null;
  current_run_id: string | null;
  final_artifact_ids_json: string | null;
  score: number | null;
  preflight_json: string | null;
  postflight_json: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ArtifactRow extends JsonRecord {
  id: string;
  run_id: string | null;
  turn_id: string | null;
  workspace_id: string | null;
  task_id: string | null;
  tool_call_id: string | null;
  type: string;
  name: string | null;
  path: string;
  mime_type: string | null;
  sha256: string | null;
  checksum: string | null;
  size_bytes: number | null;
  generated_by: string | null;
  preview_available: number | null;
  is_final: number | null;
  created_at: string;
}

interface ApprovalRow extends JsonRecord {
  id: string;
  workspace_id: string;
  task_id: string | null;
  run_id: string | null;
  tool_call_id: string | null;
  risk_level: string | null;
  action_type: string | null;
  requested_action: string | null;
  reason: string | null;
  args_json: string | null;
  status: string | null;
  approved_by: string | null;
  decision_note: string | null;
  created_at: string | null;
  decided_at: string | null;
}

export interface WorkspaceInput {
  name: string;
  rootPath?: string;
  defaultModelProfileId?: string;
  defaultPolicyId?: string;
  defaultContextPolicyId?: string;
  settings?: JsonRecord;
}

export interface ScenarioInput {
  name: string;
  category?: string;
  description?: string;
  defaultSkillId?: string;
  requiredTools?: string[];
  defaultOutputs?: string[];
  preflight?: unknown[];
  postflight?: unknown[];
}

export interface TaskInput {
  workspaceId: string;
  title: string;
  description?: string;
  category?: string;
  scenarioTemplateId?: string;
  status?: string;
  priority?: string;
  input?: JsonRecord;
  inputFiles?: string[];
  message?: string;
  selectedModelProfileId?: string;
  selectedSkillId?: string;
  selectedPromptVersion?: string;
}

interface ExecutionContext {
  workspace: ReturnType<typeof normalizeWorkspace>;
  scenario?: ReturnType<typeof normalizeScenario>;
  task?: ReturnType<typeof normalizeTask>;
  files: string[];
  modelProfileId?: string;
  skillId?: string;
  requiredTools: string[];
}

const pendingApprovalWaiters = new Map<string, {
  taskId: string;
  runId: string;
  resolve: (result: RuntimeApprovalResult) => void;
}>();

export function listWorkspaces() {
  return all<WorkspaceRow>(`SELECT w.*,
    (SELECT COUNT(1) FROM tasks t WHERE t.workspace_id=w.id) AS task_count,
    (SELECT COUNT(1) FROM artifacts a WHERE a.workspace_id=w.id) AS artifact_count
    FROM workspaces w ORDER BY w.updated_at DESC`).map(normalizeWorkspace);
}

export function getWorkspace(id: string) {
  const row = get<WorkspaceRow>(`SELECT * FROM workspaces WHERE id=?`, id);
  return row ? normalizeWorkspace(row) : undefined;
}

export function createWorkspace(input: WorkspaceInput) {
  if (!input?.name?.trim()) throw new Error('Workspace 名称不能为空');
  const id = `workspace_${randomUUID()}`;
  const now = new Date().toISOString();
  const rootPath = resolve(input.rootPath || defaultWorkspaceRoot);
  const settings = withDefaultWorkspaceSettings(input.settings);
  ensureWorkspaceDirs(rootPath, settings);
  run(`INSERT INTO workspaces (
    id, name, root_path, default_model_profile_id, default_policy_id,
    default_context_policy_id, settings_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.name.trim(), rootPath, input.defaultModelProfileId ?? 'builtin-deterministic',
    input.defaultPolicyId ?? 'default-local-policy', input.defaultContextPolicyId ?? 'balanced-v1',
    json(settings), now, now);
  return requireWorkspace(id);
}

export function updateWorkspace(id: string, input: Partial<WorkspaceInput>) {
  const current = requireWorkspace(id);
  const now = new Date().toISOString();
  const settings = withDefaultWorkspaceSettings(input.settings ?? current.settings);
  const rootPath = resolve(input.rootPath || current.rootPath);
  ensureWorkspaceDirs(rootPath, settings);
  run(`UPDATE workspaces SET name=?, root_path=?, default_model_profile_id=?,
    default_policy_id=?, default_context_policy_id=?, settings_json=?, updated_at=? WHERE id=?`,
    input.name?.trim() || current.name, rootPath,
    input.defaultModelProfileId ?? current.defaultModelProfileId,
    input.defaultPolicyId ?? current.defaultPolicyId,
    input.defaultContextPolicyId ?? current.defaultContextPolicyId,
    json(settings), now, id);
  return requireWorkspace(id);
}

export function deleteWorkspace(id: string) {
  requireWorkspace(id);
  run(`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=?)`, id);
  run(`DELETE FROM approvals WHERE workspace_id=?`, id);
  run(`DELETE FROM artifacts WHERE workspace_id=?`, id);
  run(`DELETE FROM tasks WHERE workspace_id=?`, id);
  run(`DELETE FROM workspaces WHERE id=?`, id);
  return { ok: true };
}

export function listWorkspaceFiles(id: string, options: { maxDepth?: number; maxEntries?: number } = {}) {
  const workspace = requireWorkspace(id);
  const root = resolve(workspace.rootPath);
  const maxDepth = Math.max(1, Math.min(Number(options.maxDepth ?? 4), 8));
  const maxEntries = Math.max(20, Math.min(Number(options.maxEntries ?? 300), 1000));
  const files: Array<JsonRecord> = [];
  walk(root, 0);
  return { workspaceId: id, rootPath: root, files, truncated: files.length >= maxEntries };

  function walk(directory: string, depth: number) {
    if (files.length >= maxEntries || depth > maxDepth || !existsSync(directory)) return;
    const entries = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !['.git', 'node_modules', 'dist', 'build'].includes(entry.name))
      .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= maxEntries) return;
      const absolutePath = resolve(directory, entry.name);
      const info = statSync(absolutePath);
      const item = {
        name: entry.name,
        path: relative(root, absolutePath),
        type: entry.isDirectory() ? 'directory' : 'file',
        sizeBytes: entry.isDirectory() ? null : info.size,
        updatedAt: info.mtime.toISOString()
      };
      files.push(item);
      if (entry.isDirectory()) walk(absolutePath, depth + 1);
    }
  }
}

export function listTasks(filters: { workspaceId?: string; status?: string; scenarioTemplateId?: string } = {}) {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.workspaceId) {
    clauses.push('t.workspace_id=?');
    params.push(filters.workspaceId);
  }
  if (filters.status) {
    clauses.push('t.status=?');
    params.push(filters.status);
  }
  if (filters.scenarioTemplateId) {
    clauses.push('t.scenario_template_id=?');
    params.push(filters.scenarioTemplateId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<TaskRow>(`SELECT t.*, w.name AS workspace_name, s.name AS scenario_name
    FROM tasks t
    LEFT JOIN workspaces w ON w.id=t.workspace_id
    LEFT JOIN scenario_templates s ON s.id=t.scenario_template_id
    ${where}
    ORDER BY t.updated_at DESC`, ...params).map(normalizeTask);
}

export function getTask(id: string) {
  const row = get<TaskRow>(`SELECT t.*, w.name AS workspace_name, s.name AS scenario_name
    FROM tasks t
    LEFT JOIN workspaces w ON w.id=t.workspace_id
    LEFT JOIN scenario_templates s ON s.id=t.scenario_template_id
    WHERE t.id=?`, id);
  if (!row) return undefined;
  const task = normalizeTask(row);
  return {
    ...task,
    events: listTaskEvents(id),
    artifacts: listArtifacts({ taskId: id }),
    approvals: listApprovals({ taskId: id }),
    runs: listTaskRuns(id),
    toolCalls: task.currentRunId ? listTaskToolCalls(task.currentRunId) : [],
    contextSnapshots: task.currentRunId ? listTaskContextSnapshots(task.currentRunId) : []
  };
}

export function createTask(input: TaskInput) {
  if (!input?.workspaceId) throw new Error('workspaceId 不能为空');
  if (!input.title?.trim()) throw new Error('测试任务标题不能为空');
  const workspace = requireWorkspace(input.workspaceId);
  const scenario = input.scenarioTemplateId ? requireScenario(input.scenarioTemplateId) : undefined;
  const now = new Date().toISOString();
  const id = `task_${randomUUID()}`;
  const taskInput = normalizeTaskInput(input);
  run(`INSERT INTO tasks (
    id, workspace_id, title, description, category, scenario_template_id, status, priority,
    input_json, selected_model_profile_id, selected_skill_id, selected_prompt_version,
    final_artifact_ids_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, workspace.id, input.title.trim(), input.description ?? null,
    input.category ?? scenario?.category ?? null, scenario?.id ?? null, input.status ?? 'draft',
    input.priority ?? 'p1', json(taskInput),
    input.selectedModelProfileId ?? workspace.defaultModelProfileId,
    input.selectedSkillId ?? scenario?.defaultSkillId ?? null,
    input.selectedPromptVersion ?? null, json([]), now, now);
  recordTaskEvent(id, null, 'task.created', { title: input.title, scenarioTemplateId: scenario?.id ?? null });
  return getTask(id);
}

export function updateTask(id: string, input: Partial<TaskInput>) {
  const current = requireTask(id);
  const workspace = input.workspaceId ? requireWorkspace(input.workspaceId) : requireWorkspace(current.workspaceId);
  const scenario = input.scenarioTemplateId ? requireScenario(input.scenarioTemplateId)
    : current.scenarioTemplateId ? requireScenario(current.scenarioTemplateId) : undefined;
  const now = new Date().toISOString();
  const mergedInput = input.input || input.inputFiles || input.message
    ? { ...current.input, ...normalizeTaskInput(input as TaskInput) }
    : current.input;
  run(`UPDATE tasks SET workspace_id=?, title=?, description=?, category=?, scenario_template_id=?,
    status=?, priority=?, input_json=?, selected_model_profile_id=?, selected_skill_id=?,
    selected_prompt_version=?, updated_at=? WHERE id=?`,
    workspace.id,
    input.title?.trim() || current.title,
    input.description ?? current.description ?? null,
    input.category ?? current.category ?? scenario?.category ?? null,
    input.scenarioTemplateId ?? current.scenarioTemplateId ?? null,
    input.status ?? current.status,
    input.priority ?? current.priority,
    json(mergedInput),
    input.selectedModelProfileId ?? current.selectedModelProfileId ?? workspace.defaultModelProfileId,
    input.selectedSkillId ?? current.selectedSkillId ?? scenario?.defaultSkillId ?? null,
    input.selectedPromptVersion ?? current.selectedPromptVersion ?? null,
    now,
    id);
  recordTaskEvent(id, current.currentRunId, 'task.updated', input);
  return getTask(id);
}

export function deleteTask(id: string) {
  requireTask(id);
  run(`DELETE FROM task_events WHERE task_id=?`, id);
  run(`DELETE FROM approvals WHERE task_id=?`, id);
  run(`UPDATE artifacts SET task_id=NULL, is_final=0 WHERE task_id=?`, id);
  run(`DELETE FROM tasks WHERE id=?`, id);
  return { ok: true };
}

export function runTaskPreflight(taskId: string) {
  const context = buildTaskExecutionContext(taskId);
  const checks = context.scenario?.preflight ?? [];
  const result = evaluatePreflight(checks, context);
  run(`UPDATE tasks SET preflight_json=?, status=?, updated_at=? WHERE id=?`,
    json(result), result.status === 'passed' ? 'ready' : 'failed', new Date().toISOString(), taskId);
  recordTaskEvent(taskId, context.task?.currentRunId ?? null, 'task.preflight', result);
  return result;
}

export function runScenarioPreflight(scenarioId: string, input: { workspaceId?: string; inputFiles?: string[]; modelProfileId?: string } = {}) {
  const scenario = requireScenario(scenarioId);
  const workspace = input.workspaceId ? requireWorkspace(input.workspaceId) : requireWorkspace('workspace_demo');
  return evaluatePreflight(scenario.preflight, {
    workspace,
    scenario,
    files: input.inputFiles ?? [],
    modelProfileId: input.modelProfileId ?? workspace.defaultModelProfileId ?? undefined,
    skillId: scenario.defaultSkillId ?? undefined,
    requiredTools: scenario.requiredTools
  });
}

export function startEvalTask(taskId: string, options: { resumeFromApprovalId?: string; approvedTools?: string[] } = {}) {
  const context = buildTaskExecutionContext(taskId);
  const preflight = evaluatePreflight(context.scenario?.preflight ?? [], context);
  if (preflight.status !== 'passed') {
    run(`UPDATE tasks SET preflight_json=?, status='failed', updated_at=? WHERE id=?`,
      json(preflight), new Date().toISOString(), taskId);
    recordTaskEvent(taskId, null, 'task.preflight.failed', preflight);
    return { started: false, task: getTask(taskId), preflight };
  }

  const provider = resolveModelProvider(context.modelProfileId);
  const message = String(context.task?.input.message || context.task?.description || context.scenario?.description || context.task?.title || 'Run task');
  const { ids, promise } = startRuntimeRun({
    name: context.task?.title,
    message,
    skill: context.skillId,
    files: context.files,
    workspacePath: context.workspace.rootPath,
    workspaceId: context.workspace.id,
    taskId,
    modelProfile: provider.profile,
    promptVersion: context.task?.selectedPromptVersion ?? undefined,
    contextStrategy: context.workspace.defaultContextPolicyId ?? undefined,
    policyVersion: context.workspace.defaultPolicyId ?? undefined,
    approvedTools: options.approvedTools ?? []
  }, {
    waitForApproval: (approvalRequest) => waitForTaskApproval(taskId, context.workspace.id, ids.runId, approvalRequest)
  });
  run(`UPDATE tasks SET current_run_id=?, preflight_json=?, status='running', updated_at=? WHERE id=?`,
    ids.runId, json(preflight), new Date().toISOString(), taskId);
  if (options.resumeFromApprovalId) {
    recordTaskEvent(taskId, ids.runId, 'run.resume_after_approval', {
      approvalId: options.resumeFromApprovalId,
      approvedTools: options.approvedTools ?? []
    });
  }
  recordTaskEvent(taskId, ids.runId, 'task.started', { runId: ids.runId, preflight, approvedTools: options.approvedTools ?? [] });
  recordTaskEvent(taskId, ids.runId, 'eval_task_runner.started', {
    role: 'orchestrate_eval_run',
    runtimeAdapter: 'LocalRuntimeAdapter',
    note: 'EvalTaskRunner loads a Test Task, runs checks, calls RuntimeAdapter, and records Trace/Run Artifact/Runtime Approval/Postflight.'
  });
  void promise.then((result) => finishTaskRun(taskId, context.workspace.id, result))
    .catch((error) => failTaskRun(taskId, ids.runId, error));
  return { started: true, task: getTask(taskId), runId: ids.runId, ids, preflight, eventsUrl: `/api/runtime/runs/${ids.runId}/events` };
}

export function startTask(taskId: string, options: { resumeFromApprovalId?: string; approvedTools?: string[] } = {}) {
  return startEvalTask(taskId, options);
}

export function cancelTask(taskId: string) {
  const task = requireTask(taskId);
  run(`UPDATE tasks SET status='cancelled', updated_at=? WHERE id=?`, new Date().toISOString(), taskId);
  recordTaskEvent(taskId, task.currentRunId, 'task.cancelled', {});
  return getTask(taskId);
}

export function replayTask(taskId: string) {
  requireTask(taskId);
  run(`UPDATE tasks SET status='ready', updated_at=? WHERE id=?`, new Date().toISOString(), taskId);
  return startEvalTask(taskId);
}

export function resumeTaskAfterApproval(taskId: string, input: { approvalId?: string } = {}) {
  const task = requireTask(taskId);
  const approved = listApprovals({ taskId }).filter((approval) => approval.status === 'approved' || approval.status === 'approved_with_changes');
  const approvedTools = [...new Set(approved.map((approval) => approval.requestedAction).filter((tool): tool is string => Boolean(tool)))];
  if (!approvedTools.length) throw new Error('没有可用于恢复执行的已批准工具');
  recordTaskEvent(taskId, task.currentRunId, 'approval.resume_requested', {
    approvalId: input.approvalId,
    approvedTools,
    approvalIds: approved.map((approval) => approval.id)
  });
  return startEvalTask(taskId, { resumeFromApprovalId: input.approvalId ?? approved.at(-1)?.id, approvedTools });
}

export function runTaskPostflight(taskId: string) {
  const context = buildTaskExecutionContext(taskId);
  const result = evaluatePostflight(context);
  run(`UPDATE tasks SET postflight_json=?, updated_at=? WHERE id=?`, json(result), new Date().toISOString(), taskId);
  recordTaskEvent(taskId, context.task?.currentRunId ?? null, 'task.postflight', result);
  return result;
}

export function convertTaskToEvalCase(taskId: string) {
  const task = requireTask(taskId);
  const scenario = task.scenarioTemplateId ? requireScenario(task.scenarioTemplateId) : undefined;
  const now = new Date().toISOString();
  run(`INSERT OR IGNORE INTO eval_datasets (
    id, name, version, category, description, owner, file_path, case_count,
    default_runtime_json, scoring_profile, release_gate_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, NULL, ?, ?)`,
    'task_conversions_v1', 'Test Task Conversions', '1.0.0', 'test-task', '从评测空间测试任务转换而来的回归用例',
    'jarvis-studio', json({ source: 'task.convert-to-eval-case' }), 'rule', now, now);
  const id = `eval_${task.id}`;
  run(`INSERT INTO eval_cases (
    id, dataset_id, name, category, priority, version, tags_json, input_json, config_json,
    expected_json, scoring_json, pass_criteria_json, file_path, release_gate_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category,
    priority=excluded.priority, input_json=excluded.input_json, config_json=excluded.config_json,
    expected_json=excluded.expected_json, scoring_json=excluded.scoring_json,
    pass_criteria_json=excluded.pass_criteria_json, updated_at=excluded.updated_at`,
    id, 'task_conversions_v1', task.title, task.category ?? scenario?.category ?? 'task',
    task.priority ?? 'p1', '1.0.0', json(['task-converted', scenario?.id].filter(Boolean)),
    json({ taskId: task.id, workspaceId: task.workspaceId, scenarioTemplateId: scenario?.id, message: task.input.message, files: task.input.files ?? [] }),
    json({ modelProviderId: task.selectedModelProfileId, skillId: task.selectedSkillId, promptVersion: task.selectedPromptVersion }),
    json({ postflight: task.postflight, finalArtifactIds: task.finalArtifactIds }),
    json({ rules: ['postflight.status=passed'] }),
    json({ minTotalScore: 4, requiredChecks: ['postflight_passed'] }),
    now, now);
  run(`UPDATE eval_datasets SET case_count=(SELECT COUNT(1) FROM eval_cases WHERE dataset_id=?), updated_at=? WHERE id=?`,
    'task_conversions_v1', now, 'task_conversions_v1');
  recordTaskEvent(taskId, task.currentRunId, 'task.converted_to_eval_case', { evalCaseId: id });
  return get<JsonRecord>(`SELECT * FROM eval_cases WHERE id=?`, id);
}

export function listTaskRuns(taskId: string) {
  return all<JsonRecord>(`SELECT DISTINCT r.*
    FROM runs r
    LEFT JOIN task_events e ON e.run_id=r.id
    LEFT JOIN tasks t ON t.current_run_id=r.id
    WHERE e.task_id=? OR t.id=?
    ORDER BY r.started_at DESC`, taskId, taskId);
}

export function listTaskEvents(taskId: string) {
  return all<JsonRecord>(`SELECT * FROM task_events WHERE task_id=? ORDER BY created_at DESC`, taskId)
    .map((row) => ({ id: row.id, taskId: row.task_id, runId: row.run_id, type: row.type, payload: parseJson(row.payload_json, {}), createdAt: row.created_at }));
}

function listTaskToolCalls(runId: string) {
  return all<JsonRecord>(`SELECT * FROM tool_calls WHERE run_id=? ORDER BY created_at`, runId)
    .map((row) => ({
      id: row.id,
      runId: row.run_id,
      spanId: row.span_id,
      toolName: row.tool_name,
      success: Boolean(row.success),
      latencyMs: row.latency_ms,
      arguments: parseJson(row.arguments_json, {}),
      result: parseJson(row.result_json, {}),
      createdAt: row.created_at
    }));
}

function listTaskContextSnapshots(runId: string) {
  return all<JsonRecord>(`SELECT id, run_id, total_tokens, max_context_tokens,
    total_tokens_before_budget, total_tokens_after_budget, budget_strategy,
    truncated, compressed, created_at
    FROM context_snapshots WHERE run_id=? ORDER BY created_at DESC`, runId)
    .map((row) => ({
      id: row.id,
      runId: row.run_id,
      totalTokens: row.total_tokens,
      maxContextTokens: row.max_context_tokens,
      totalTokensBeforeBudget: row.total_tokens_before_budget,
      totalTokensAfterBudget: row.total_tokens_after_budget,
      budgetStrategy: row.budget_strategy,
      truncated: Boolean(row.truncated),
      compressed: Boolean(row.compressed),
      createdAt: row.created_at
    }));
}

export function getWorkbenchDashboard() {
  const tasks = listTasks();
  const artifacts = listArtifacts();
  const approvals = listApprovals();
  const workspaces = listWorkspaces();
  const scenarios = listScenarios();
  const startedTasks = tasks.filter((task) => task.currentRunId);
  const completedTasks = tasks.filter((task) => ['success', 'completed', 'accepted'].includes(task.status));
  const preflighted = tasks.filter((task) => task.preflight && typeof task.preflight === 'object');
  const postflighted = tasks.filter((task) => task.postflight && typeof task.postflight === 'object');
  const artifactTaskIds = new Set(artifacts.map((artifact) => artifact.taskId).filter(Boolean));
  const decidedApprovals = approvals.filter((approval) => approval.status !== 'pending');
  const approvedApprovals = decidedApprovals.filter((approval) => approval.status === 'approved' || approval.status === 'approved_with_changes');
  const preflightFailed = preflighted.filter((task) => statusFromCheckResult(task.preflight) === 'failed').length;
  const postflightFailed = postflighted.filter((task) => statusFromCheckResult(task.postflight) === 'failed').length;
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      workspaces: workspaces.length,
      tasks: tasks.length,
      runs: new Set(tasks.map((task) => task.currentRunId).filter(Boolean)).size,
      artifacts: artifacts.length,
      approvals: approvals.length,
      pendingApprovals: approvals.filter((approval) => approval.status === 'pending').length,
      scenarios: scenarios.length
    },
    metrics: {
      taskCompletionRate: tasks.length ? completedTasks.length / tasks.length : 0,
      artifactGenerationRate: startedTasks.length ? Array.from(artifactTaskIds).length / startedTasks.length : 0,
      approvalPassRate: decidedApprovals.length ? approvedApprovals.length / decidedApprovals.length : 0,
      preflightFailureRate: preflighted.length ? preflightFailed / preflighted.length : 0,
      postflightFailureRate: postflighted.length ? postflightFailed / postflighted.length : 0,
      averageTaskScore: average(tasks.map((task) => task.score).filter((score): score is number => typeof score === 'number'))
    },
    statusCounts: countBy(tasks, (task) => task.status),
    scenarioStats: scenarios.map((scenario) => {
      const scopedTasks = tasks.filter((task) => task.scenarioTemplateId === scenario.id);
      const success = scopedTasks.filter((task) => ['success', 'completed', 'accepted'].includes(task.status)).length;
      return {
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        tasks: scopedTasks.length,
        success,
        failed: scopedTasks.filter((task) => task.status === 'failed').length,
        artifacts: artifacts.filter((artifact) => scopedTasks.some((task) => task.id === artifact.taskId)).length,
        completionRate: scopedTasks.length ? success / scopedTasks.length : 0
      };
    }),
    recentTasks: tasks.slice(0, 8),
    recentArtifacts: artifacts.slice(0, 8),
    pendingApprovals: approvals.filter((approval) => approval.status === 'pending').slice(0, 8)
  };
}

export function compareTasks(leftTaskId: string, rightTaskId: string) {
  if (!leftTaskId || !rightTaskId) throw new Error('leftTaskId 和 rightTaskId 不能为空');
  if (leftTaskId === rightTaskId) throw new Error('请选择两个不同的测试任务');
  const left = taskComparisonSnapshot(leftTaskId);
  const right = taskComparisonSnapshot(rightTaskId);
  const dimensions = compareTaskDimensions(left, right);
  const artifactDiff = diffArtifacts(left.artifacts, right.artifacts);
  const toolDiff = diffCounts(left.toolCounts, right.toolCounts, 'toolName');
  const checkDiff = diffChecks(left.postflightChecks, right.postflightChecks);
  const delta = {
    score: numberOrZero(right.task.score) - numberOrZero(left.task.score),
    latencyMs: numberOrZero(right.run?.latencyMs) - numberOrZero(left.run?.latencyMs),
    totalTokens: numberOrZero(right.run?.totalTokens) - numberOrZero(left.run?.totalTokens),
    toolCalls: right.toolCallCount - left.toolCallCount,
    artifacts: right.artifacts.length - left.artifacts.length,
    approvals: right.approvals.length - left.approvals.length,
    postflightPassed: passFlag(right.task.postflight) - passFlag(left.task.postflight)
  };
  return {
    id: `task_compare_${leftTaskId}_${rightTaskId}`,
    comparedAt: new Date().toISOString(),
    left,
    right,
    delta,
    dimensions,
    artifactDiff,
    toolDiff,
    checkDiff,
    summary: {
      classification: classifyTaskCompare(left.task.status, right.task.status, delta.score, checkDiff.changed.length),
      changedDimensions: dimensions.filter((item) => !item.same).length,
      addedArtifacts: artifactDiff.added.length,
      removedArtifacts: artifactDiff.removed.length,
      changedArtifacts: artifactDiff.changed.length,
      changedTools: toolDiff.changed.length,
      changedChecks: checkDiff.changed.length
    }
  };
}

export function listScenarios() {
  return all<ScenarioRow>(`SELECT * FROM scenario_templates ORDER BY category, name`).map(normalizeScenario);
}

export function getScenario(id: string) {
  const row = get<ScenarioRow>(`SELECT * FROM scenario_templates WHERE id=?`, id);
  return row ? normalizeScenario(row) : undefined;
}

export function createScenario(input: ScenarioInput) {
  if (!input.name?.trim()) throw new Error('Scenario 名称不能为空');
  const id = `scenario_${randomUUID()}`;
  saveScenario(id, input);
  return requireScenario(id);
}

export function updateScenario(id: string, input: Partial<ScenarioInput>) {
  const current = requireScenario(id);
  saveScenario(id, {
    name: input.name ?? current.name,
    category: input.category ?? current.category ?? undefined,
    description: input.description ?? current.description ?? undefined,
    defaultSkillId: input.defaultSkillId ?? current.defaultSkillId ?? undefined,
    requiredTools: input.requiredTools ?? current.requiredTools,
    defaultOutputs: input.defaultOutputs ?? current.defaultOutputs,
    preflight: input.preflight ?? current.preflight,
    postflight: input.postflight ?? current.postflight
  });
  return requireScenario(id);
}

export function deleteScenario(id: string) {
  requireScenario(id);
  run(`UPDATE tasks SET scenario_template_id=NULL WHERE scenario_template_id=?`, id);
  run(`DELETE FROM scenario_templates WHERE id=?`, id);
  return { ok: true };
}

export function listArtifacts(filters: { workspaceId?: string; taskId?: string; runId?: string; finalOnly?: boolean } = {}) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.workspaceId) {
    clauses.push('workspace_id=?');
    params.push(filters.workspaceId);
  }
  if (filters.taskId) {
    clauses.push('task_id=?');
    params.push(filters.taskId);
  }
  if (filters.runId) {
    clauses.push('run_id=?');
    params.push(filters.runId);
  }
  if (filters.finalOnly) clauses.push('is_final=1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<ArtifactRow>(`SELECT * FROM artifacts ${where} ORDER BY created_at DESC`, ...params).map(normalizeArtifact);
}

export function getArtifact(id: string) {
  const row = get<ArtifactRow>(`SELECT * FROM artifacts WHERE id=?`, id);
  return row ? normalizeArtifact(row) : undefined;
}

export function previewArtifact(id: string) {
  const artifact = requireArtifact(id);
  const workspace = artifact.workspaceId ? requireWorkspace(artifact.workspaceId) : requireWorkspace('workspace_demo');
  const file = safeWorkspacePath(workspace.rootPath, artifact.path);
  if (!existsSync(file.absolute)) throw new Error(`Artifact 文件不存在: ${artifact.path}`);
  if (/\.(md|txt|json|csv|yaml|yml|diff|patch|ts|tsx|js|py)$/i.test(file.absolute)) {
    const text = readFileSync(file.absolute, 'utf8');
    return { artifact, type: 'text', text: text.length > 80_000 ? text.slice(0, 80_000) : text, truncated: text.length > 80_000 };
  }
  if (/\.(xlsx|xls)$/i.test(file.absolute)) {
    const workbook = XLSX.readFile(file.absolute, { cellDates: true });
    return {
      artifact,
      type: 'xlsx',
      sheets: workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        if (!sheet) return { name, range: null, headers: [], rowCount: 0, rows: [], truncated: false };
        const rows = XLSX.utils.sheet_to_json<JsonRecord>(sheet, { defval: null, raw: false });
        const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null });
        const headers = Array.isArray(headerRows[0]) ? headerRows[0].map((value) => String(value ?? '')) : [];
        return {
          name,
          range: sheet?.['!ref'] ?? null,
          headers,
          rowCount: rows.length,
          rows: rows.slice(0, 100),
          truncated: rows.length > 100
        };
      })
    };
  }
  return { artifact, type: 'binary', text: null };
}

export function artifactDownloadInfo(id: string) {
  const artifact = requireArtifact(id);
  const workspace = artifact.workspaceId ? requireWorkspace(artifact.workspaceId) : requireWorkspace('workspace_demo');
  const file = safeWorkspacePath(workspace.rootPath, artifact.path);
  if (!existsSync(file.absolute)) throw new Error(`Artifact 文件不存在: ${artifact.path}`);
  return { artifact, absolutePath: file.absolute, filename: artifact.name || basename(file.absolute), mimeType: artifact.mimeType || mimeTypeFor(file.absolute) };
}

export function markArtifactFinal(id: string) {
  const artifact = requireArtifact(id);
  run(`UPDATE artifacts SET is_final=1 WHERE id=?`, id);
  if (artifact.taskId) {
    const task = requireTask(artifact.taskId);
    const finalIds = [...new Set([...task.finalArtifactIds, id])];
    run(`UPDATE tasks SET final_artifact_ids_json=?, updated_at=? WHERE id=?`, json(finalIds), new Date().toISOString(), task.id);
    recordTaskEvent(task.id, task.currentRunId, 'artifact.mark_final', { artifactId: id });
  }
  return requireArtifact(id);
}

export function deleteArtifact(id: string, options: { deleteFile?: boolean } = {}) {
  const artifact = requireArtifact(id);
  if (options.deleteFile && artifact.workspaceId) {
    const workspace = requireWorkspace(artifact.workspaceId);
    const file = safeWorkspacePath(workspace.rootPath, artifact.path);
    if (existsSync(file.absolute)) unlinkSync(file.absolute);
  }
  run(`DELETE FROM artifacts WHERE id=?`, id);
  return { ok: true };
}

export function listApprovals(filters: { workspaceId?: string; taskId?: string; status?: string } = {}) {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.workspaceId) {
    clauses.push('workspace_id=?');
    params.push(filters.workspaceId);
  }
  if (filters.taskId) {
    clauses.push('task_id=?');
    params.push(filters.taskId);
  }
  if (filters.status) {
    clauses.push('status=?');
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<ApprovalRow>(`SELECT * FROM approvals ${where} ORDER BY created_at DESC`, ...params).map(normalizeApproval);
}

export function getApproval(id: string) {
  const row = get<ApprovalRow>(`SELECT * FROM approvals WHERE id=?`, id);
  return row ? normalizeApproval(row) : undefined;
}

export function approveApproval(id: string, input: { approvedBy?: string; note?: string } = {}) {
  return decideApproval(id, 'approved', input.note, input.approvedBy);
}

export function rejectApproval(id: string, input: { approvedBy?: string; note?: string } = {}) {
  return decideApproval(id, 'rejected', input.note, input.approvedBy);
}

export function approveApprovalWithChanges(id: string, input: { approvedBy?: string; note?: string; changes?: unknown } = {}) {
  const note = input.changes ? `${input.note ?? ''}\nchanges=${JSON.stringify(input.changes)}`.trim() : input.note;
  return decideApproval(id, 'approved_with_changes', note, input.approvedBy, input.changes);
}

function finishTaskRun(taskId: string, workspaceId: string, result: RuntimeResult) {
  try {
    const task = requireTask(taskId);
    registerRuntimeArtifacts(task, workspaceId, result);
    const pendingApprovals = linkPendingApprovalsToTask(taskId, workspaceId, result.ids.runId);
    if (result.status === 'failed' && pendingApprovals.length) {
      run(`UPDATE tasks SET status='waiting_approval', updated_at=? WHERE id=?`, new Date().toISOString(), taskId);
      for (const approval of pendingApprovals) {
        recordTaskEvent(taskId, result.ids.runId, 'approval.required', { approvalId: approval.id, requestedAction: approval.requestedAction, riskLevel: approval.riskLevel });
      }
      recordTaskEvent(taskId, result.ids.runId, 'run.pause_for_approval', {
        approvalIds: pendingApprovals.map((approval) => approval.id),
        requestedActions: pendingApprovals.map((approval) => approval.requestedAction),
        error: result.error
      });
      return;
    }
    const postflight = evaluatePostflight(buildTaskExecutionContext(taskId));
    const status = result.status === 'success' && postflight.status === 'passed' ? 'success' : 'failed';
    const score = scoreFromChecks(postflight.checks);
    run(`UPDATE tasks SET status=?, postflight_json=?, score=?, updated_at=? WHERE id=?`,
      status, json(postflight), score, new Date().toISOString(), taskId);
    recordTaskEvent(taskId, result.ids.runId, 'task.finished', { status, score, postflight, output: result.output, error: result.error });
  } catch (error) {
    failTaskRun(taskId, result.ids.runId, error);
  }
}

function failTaskRun(taskId: string, runId: string | null, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  run(`UPDATE tasks SET status='failed', updated_at=? WHERE id=?`, new Date().toISOString(), taskId);
  recordTaskEvent(taskId, runId, 'task.failed', { error: message });
}

function waitForTaskApproval(taskId: string, workspaceId: string, runId: string, request: RuntimeApprovalRequest) {
  const now = new Date().toISOString();
  const existing = getApproval(request.approvalId);
  if (existing) {
    run(`UPDATE approvals SET workspace_id=?, task_id=?, run_id=?, tool_call_id=?,
      risk_level=?, action_type='tool_call', requested_action=?, reason=?, args_json=?, status='pending'
      WHERE id=?`,
      workspaceId, taskId, runId, request.toolCallId, request.riskLevel, request.toolId,
      request.reason, json(request.argumentsSummary), request.approvalId);
  } else {
    run(`INSERT INTO approvals (
      id, workspace_id, task_id, run_id, tool_call_id, risk_level, action_type,
      requested_action, reason, args_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'tool_call', ?, ?, ?, 'pending', ?)`,
      request.approvalId, workspaceId, taskId, runId, request.toolCallId, request.riskLevel,
      request.toolId, request.reason, json(request.argumentsSummary), now);
  }
  run(`UPDATE tasks SET status='waiting_approval', updated_at=? WHERE id=?`, now, taskId);
  recordTaskEvent(taskId, runId, 'approval.required', {
    approvalId: request.approvalId,
    requestedAction: request.toolId,
    riskLevel: request.riskLevel,
    reason: request.reason
  });
  recordTaskEvent(taskId, runId, 'run.pause_for_approval', {
    approvalId: request.approvalId,
    requestedAction: request.toolId,
    riskLevel: request.riskLevel
  });
  return new Promise<RuntimeApprovalResult>((resolvePromise) => {
    pendingApprovalWaiters.set(request.approvalId, { taskId, runId, resolve: resolvePromise });
  });
}

function linkPendingApprovalsToTask(taskId: string, workspaceId: string, runId: string) {
  run(`UPDATE approvals SET workspace_id=?, task_id=? WHERE run_id=? AND status='pending'`, workspaceId, taskId, runId);
  return listApprovals({ taskId, status: 'pending' }).filter((approval) => approval.runId === runId);
}

function registerRuntimeArtifacts(task: ReturnType<typeof normalizeTask>, workspaceId: string, result: RuntimeResult) {
  const workspace = requireWorkspace(workspaceId);
  const now = new Date().toISOString();
  for (const artifact of result.artifacts) {
    const file = safeWorkspacePath(workspace.rootPath, artifact.path);
    const content = existsSync(file.absolute) ? readFileSync(file.absolute) : Buffer.from('');
    const sha256 = content.length ? createHash('sha256').update(content).digest('hex') : null;
    const size = existsSync(file.absolute) ? statSync(file.absolute).size : artifact.sizeBytes;
    run(`INSERT INTO artifacts (
      id, run_id, workspace_id, task_id, tool_call_id, type, name, path, mime_type, sha256,
      checksum, size_bytes, generated_by, preview_available, is_final, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id, task_id=excluded.task_id,
      tool_call_id=excluded.tool_call_id,
      name=excluded.name, mime_type=excluded.mime_type, sha256=excluded.sha256,
      checksum=excluded.checksum, size_bytes=excluded.size_bytes,
      generated_by=excluded.generated_by, preview_available=excluded.preview_available`,
      artifact.id, result.ids.runId, workspaceId, task.id, artifact.toolCallId ?? null, artifact.type, basename(artifact.path),
      artifact.path, mimeTypeFor(artifact.path), sha256, sha256, size, 'runtime',
      previewAvailable(artifact.path) ? 1 : 0, 0, now);
  }
}

function buildTaskExecutionContext(taskId: string): ExecutionContext {
  const task = requireTask(taskId);
  const workspace = requireWorkspace(task.workspaceId);
  const scenario = task.scenarioTemplateId ? requireScenario(task.scenarioTemplateId) : undefined;
  const files = inputFiles(task.input);
  return {
    workspace,
    scenario,
    task,
    files,
    modelProfileId: task.selectedModelProfileId ?? workspace.defaultModelProfileId ?? undefined,
    skillId: task.selectedSkillId ?? scenario?.defaultSkillId ?? undefined,
    requiredTools: scenario?.requiredTools ?? []
  };
}

function evaluatePreflight(checks: unknown[], context: ExecutionContext) {
  const results = checks.map((check) => evaluatePreflightCheck(check, context));
  const status = results.every((item) => item.status !== 'failed') ? 'passed' : 'failed';
  return {
    status,
    checkedAt: new Date().toISOString(),
    workspaceId: context.workspace.id,
    taskId: context.task?.id,
    scenarioId: context.scenario?.id,
    modelProfileId: context.modelProfileId,
    skillId: context.skillId,
    requiredTools: context.requiredTools,
    checks: results
  };
}

function evaluatePreflightCheck(check: unknown, context: ExecutionContext) {
  const id = checkId(check);
  try {
    if (id === 'input_file_exists') {
      if (!context.files.length) return failed(id, '未提供输入文件');
      const missing = context.files.filter((file) => !existsSync(safeWorkspacePath(context.workspace.rootPath, file).absolute));
      return missing.length ? failed(id, `文件不存在: ${missing.join(', ')}`) : passed(id, `${context.files.length} 个输入文件存在`);
    }
    if (id === 'input_file_is_xlsx_or_csv') {
      const invalid = context.files.filter((file) => !/\.(xlsx|xls|csv)$/i.test(file));
      return invalid.length ? failed(id, `不支持的文件类型: ${invalid.join(', ')}`) : passed(id, '输入文件类型符合 Excel/CSV 场景');
    }
    if (id === 'input_file_is_txt_or_docx') {
      const invalid = context.files.filter((file) => !/\.(txt|md|markdown|docx)$/i.test(file));
      return invalid.length ? failed(id, `不支持的文件类型: ${invalid.join(', ')}`) : passed(id, '输入文件类型符合周报场景');
    }
    if (id === 'file_size_under_limit') {
      const maxBytes = 25 * 1024 * 1024;
      const oversized = context.files.filter((file) => statSync(safeWorkspacePath(context.workspace.rootPath, file).absolute).size > maxBytes);
      return oversized.length ? failed(id, `文件超过 25MB: ${oversized.join(', ')}`) : passed(id, '输入文件大小在限制内');
    }
    if (id === 'workspace_is_git_repo') {
      return workspaceHasGit(context.workspace.rootPath) ? passed(id, 'Workspace 位于 Git 工作区内') : failed(id, 'Workspace 不在 Git 工作区内');
    }
    if (id === 'required_skill_available') {
      const skill = listSkills().find((item) => item.id === context.skillId && item.status !== 'disabled');
      return skill ? passed(id, `Skill 可用: ${skill.id}@${skill.version}`) : failed(id, `Skill 不可用: ${context.skillId ?? '未选择'}`);
    }
    if (id === 'required_tools_available') {
      const available = new Set(toolDefinitions.map((tool) => tool.name));
      const missing = context.requiredTools.filter((tool) => !available.has(tool));
      return missing.length ? failed(id, `Tool 未注册: ${missing.join(', ')}`) : passed(id, `Tool 已注册: ${context.requiredTools.join(', ') || '无'}`);
    }
    if (id === 'model_profile_available') {
      resolveModelProvider(context.modelProfileId);
      return passed(id, `模型服务商可用: ${context.modelProfileId ?? '默认'}`);
    }
    return { id, status: 'warning', detail: `未知检查项，已跳过: ${id}` };
  } catch (error) {
    return failed(id, error instanceof Error ? error.message : String(error));
  }
}

function evaluatePostflight(context: ExecutionContext) {
  const checks = (context.scenario?.postflight ?? []).map((check) => evaluatePostflightCheck(check, context));
  const status = checks.every((item) => item.status !== 'failed') ? 'passed' : 'failed';
  return { status, checkedAt: new Date().toISOString(), taskId: context.task?.id, runId: context.task?.currentRunId, checks };
}

function evaluatePostflightCheck(check: unknown, context: ExecutionContext) {
  const artifacts = context.task ? listArtifacts({ taskId: context.task.id }) : [];
  const id = checkId(check);
  try {
    if (typeof check === 'object' && check && 'artifact_exists' in check) {
      const target = String((check as JsonRecord).artifact_exists);
      const found = artifacts.find((artifact) => artifact.path.endsWith(target) || artifact.name === target);
      return found ? passed(`artifact_exists:${target}`, `已生成 Artifact: ${found.path}`) : failed(`artifact_exists:${target}`, `未生成 Artifact: ${target}`);
    }
    if (typeof check === 'object' && check && 'must_include_sections' in check) {
      const rawSections = (check as JsonRecord).must_include_sections;
      const sections: string[] = Array.isArray(rawSections) ? rawSections.map(String) : [];
      const text = firstTextArtifact(context.workspace.rootPath, artifacts);
      const missing = sections.filter((section) => !text.includes(section));
      return missing.length ? failed(id, `报告缺少章节: ${missing.join(', ')}`) : passed(id, `报告包含章节: ${sections.join(', ')}`);
    }
    if (id === 'no_empty_sections') {
      const text = firstTextArtifact(context.workspace.rootPath, artifacts);
      return text.trim().length > 30 ? passed(id, '报告内容非空') : failed(id, '报告内容过短或为空');
    }
    if (id === 'length_in_range') {
      const text = firstTextArtifact(context.workspace.rootPath, artifacts);
      return text.length >= 20 && text.length <= 40_000 ? passed(id, `报告长度 ${text.length} 字符`) : failed(id, `报告长度超出范围: ${text.length}`);
    }
    if (id === 'no_source_file_changed_without_approval') {
      const risky = context.task?.currentRunId
        ? all<JsonRecord>(`SELECT id, tool_name FROM tool_calls WHERE run_id=? AND tool_name IN ('patch.apply', 'shell.safe_run') AND success=1`, context.task.currentRunId)
        : [];
      const missingApproval = risky.filter((toolCall) => !get<JsonRecord>(`SELECT id FROM approvals
        WHERE run_id=? AND status IN ('approved', 'approved_with_changes')
          AND (tool_call_id=? OR requested_action=?)
        LIMIT 1`, context.task?.currentRunId ?? '', String(toolCall.id), String(toolCall.tool_name)));
      return missingApproval.length
        ? failed(id, `检测到未审批的高风险工具调用: ${missingApproval.map((item) => item.tool_name).join(', ')}`)
        : passed(id, risky.length ? '高风险工具调用均有审批记录' : '未检测到源代码修改工具调用');
    }
    return { id, status: 'warning', detail: `未知检查项，已跳过: ${id}` };
  } catch (error) {
    return failed(id, error instanceof Error ? error.message : String(error));
  }
}

function firstTextArtifact(workspaceRoot: string, artifacts: ReturnType<typeof normalizeArtifact>[]) {
  const artifact = artifacts.find((item) => /\.(md|txt|json|csv|yaml|yml)$/i.test(item.path));
  if (!artifact) return '';
  const file = safeWorkspacePath(workspaceRoot, artifact.path);
  return existsSync(file.absolute) ? readFileSync(file.absolute, 'utf8') : '';
}

function taskComparisonSnapshot(taskId: string) {
  const task = requireTask(taskId);
  const runRow = task.currentRunId
    ? get<JsonRecord>(`SELECT r.*,
      (SELECT COUNT(*) FROM tool_calls t WHERE t.run_id=r.id) AS tool_call_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.run_id=r.id) AS artifact_count
      FROM runs r WHERE r.id=?`, task.currentRunId)
    : undefined;
  const toolCounts = task.currentRunId
    ? all<JsonRecord>(`SELECT tool_name AS toolName, COUNT(*) AS count, SUM(success=1) AS success
      FROM tool_calls WHERE run_id=? GROUP BY tool_name ORDER BY tool_name`, task.currentRunId)
      .map((row) => ({ toolName: String(row.toolName), count: Number(row.count ?? 0), success: Number(row.success ?? 0) }))
    : [];
  const artifacts = listArtifacts({ taskId });
  const approvals = listApprovals({ taskId });
  return {
    task,
    run: runRow ? normalizeRunSnapshot(runRow) : null,
    artifacts,
    approvals,
    events: listTaskEvents(taskId),
    toolCounts,
    toolCallCount: toolCounts.reduce((sum, item) => sum + item.count, 0),
    postflightChecks: extractChecks(task.postflight)
  };
}

function normalizeRunSnapshot(row: JsonRecord) {
  return {
    id: String(row.id),
    name: String(row.name ?? row.id),
    status: String(row.status ?? 'unknown'),
    model: row.model ? String(row.model) : null,
    modelProvider: row.model_provider ? String(row.model_provider) : null,
    promptVersion: row.prompt_version ? String(row.prompt_version) : null,
    contextStrategyVersion: row.context_strategy_version ? String(row.context_strategy_version) : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : null,
    totalTokens: typeof row.total_tokens === 'number' ? row.total_tokens : null,
    score: typeof row.score === 'number' ? row.score : null,
    error: row.error ? String(row.error) : null,
    toolCallCount: Number(row.tool_call_count ?? 0),
    artifactCount: Number(row.artifact_count ?? 0)
  };
}

function compareTaskDimensions(left: ReturnType<typeof taskComparisonSnapshot>, right: ReturnType<typeof taskComparisonSnapshot>) {
  const leftFiles = inputFiles(left.task.input).join(', ');
  const rightFiles = inputFiles(right.task.input).join(', ');
  return [
    { key: 'workspace', label: 'Workspace', left: left.task.workspaceName ?? left.task.workspaceId, right: right.task.workspaceName ?? right.task.workspaceId },
    { key: 'scenario', label: 'Scenario', left: left.task.scenarioName ?? left.task.scenarioTemplateId ?? '—', right: right.task.scenarioName ?? right.task.scenarioTemplateId ?? '—' },
    { key: 'status', label: 'Status', left: left.task.status, right: right.task.status },
    { key: 'modelProfile', label: 'Model Profile', left: left.task.selectedModelProfileId ?? '—', right: right.task.selectedModelProfileId ?? '—' },
    { key: 'skill', label: 'Skill', left: left.task.selectedSkillId ?? '—', right: right.task.selectedSkillId ?? '—' },
    { key: 'promptVersion', label: 'Prompt Version', left: left.task.selectedPromptVersion ?? '—', right: right.task.selectedPromptVersion ?? '—' },
    { key: 'inputFiles', label: 'Input Files', left: leftFiles || '—', right: rightFiles || '—' }
  ].map((item) => ({ ...item, same: item.left === item.right }));
}

function diffArtifacts(left: ReturnType<typeof normalizeArtifact>[], right: ReturnType<typeof normalizeArtifact>[]) {
  const leftMap = new Map(left.map((artifact) => [artifactKey(artifact), artifact]));
  const rightMap = new Map(right.map((artifact) => [artifactKey(artifact), artifact]));
  const added = [...rightMap.entries()].filter(([key]) => !leftMap.has(key)).map(([, artifact]) => artifact);
  const removed = [...leftMap.entries()].filter(([key]) => !rightMap.has(key)).map(([, artifact]) => artifact);
  const changed = [...rightMap.entries()]
    .filter(([key, artifact]) => {
      const previous = leftMap.get(key);
      return previous && previous.checksum && artifact.checksum && previous.checksum !== artifact.checksum;
    })
    .map(([key, artifact]) => ({ key, left: leftMap.get(key), right: artifact }));
  const unchanged = [...rightMap.entries()].filter(([key]) => leftMap.has(key) && !changed.some((item) => item.key === key)).map(([, artifact]) => artifact);
  return { added, removed, changed, unchanged };
}

function diffCounts(left: Array<Record<string, string | number>>, right: Array<Record<string, string | number>>, keyName: string) {
  const leftMap = new Map(left.map((item) => [String(item[keyName]), Number(item.count ?? 0)]));
  const rightMap = new Map(right.map((item) => [String(item[keyName]), Number(item.count ?? 0)]));
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return {
    changed: keys
      .map((key) => ({ key, left: leftMap.get(key) ?? 0, right: rightMap.get(key) ?? 0, delta: (rightMap.get(key) ?? 0) - (leftMap.get(key) ?? 0) }))
      .filter((item) => item.delta !== 0),
    unchanged: keys.filter((key) => (leftMap.get(key) ?? 0) === (rightMap.get(key) ?? 0))
  };
}

function diffChecks(left: Array<{ id: string; status: string; detail?: string }>, right: Array<{ id: string; status: string; detail?: string }>) {
  const leftMap = new Map(left.map((check) => [check.id, check]));
  const rightMap = new Map(right.map((check) => [check.id, check]));
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return {
    changed: keys
      .map((key) => ({ key, left: leftMap.get(key), right: rightMap.get(key) }))
      .filter((item) => item.left?.status !== item.right?.status || item.left?.detail !== item.right?.detail),
    unchanged: keys.filter((key) => leftMap.get(key)?.status === rightMap.get(key)?.status && leftMap.get(key)?.detail === rightMap.get(key)?.detail)
  };
}

function extractChecks(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as JsonRecord).checks)) return [];
  return ((value as JsonRecord).checks as unknown[]).map((check, index) => {
    const item = check && typeof check === 'object' ? check as JsonRecord : {};
    return {
      id: String(item.id ?? `check_${index + 1}`),
      status: String(item.status ?? 'unknown'),
      detail: item.detail === undefined ? undefined : String(item.detail)
    };
  });
}

function statusFromCheckResult(value: unknown) {
  return value && typeof value === 'object' && typeof (value as JsonRecord).status === 'string'
    ? String((value as JsonRecord).status)
    : 'unknown';
}

function artifactKey(artifact: ReturnType<typeof normalizeArtifact>) {
  return artifact.path || artifact.name || artifact.id;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function countBy<T>(items: T[], selector: (item: T) => string) {
  return items.reduce<Record<string, number>>((accumulator, item) => {
    const key = selector(item) || 'unknown';
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function passFlag(value: unknown) {
  return statusFromCheckResult(value) === 'passed' ? 1 : 0;
}

function classifyTaskCompare(leftStatus: string, rightStatus: string, scoreDelta: number, changedChecks: number) {
  const leftOk = ['success', 'completed', 'accepted'].includes(leftStatus);
  const rightOk = ['success', 'completed', 'accepted'].includes(rightStatus);
  if (!leftOk && rightOk) return 'improved';
  if (leftOk && !rightOk) return 'regressed';
  if (scoreDelta > 0) return 'improved';
  if (scoreDelta < 0) return 'regressed';
  return changedChecks ? 'changed' : 'unchanged';
}

function normalizeWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    defaultModelProfileId: row.default_model_profile_id,
    defaultPolicyId: row.default_policy_id,
    defaultContextPolicyId: row.default_context_policy_id,
    settings: withDefaultWorkspaceSettings(parseJson<JsonRecord>(row.settings_json, {})),
    taskCount: Number(row.task_count ?? 0),
    artifactCount: Number(row.artifact_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeScenario(row: ScenarioRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    defaultSkillId: row.default_skill_id,
    requiredTools: parseJson<string[]>(row.required_tools_json, []),
    defaultOutputs: parseJson<string[]>(row.default_outputs_json, []),
    preflight: parseJson<unknown[]>(row.preflight_json, []),
    postflight: parseJson<unknown[]>(row.postflight_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeTask(row: TaskRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name ?? undefined,
    title: row.title,
    description: row.description,
    category: row.category,
    scenarioTemplateId: row.scenario_template_id,
    scenarioName: row.scenario_name ?? undefined,
    status: row.status ?? 'draft',
    priority: row.priority ?? 'p1',
    input: parseJson<JsonRecord>(row.input_json, {}),
    selectedModelProfileId: row.selected_model_profile_id,
    selectedSkillId: row.selected_skill_id,
    selectedPromptVersion: row.selected_prompt_version,
    currentRunId: row.current_run_id,
    finalArtifactIds: parseJson<string[]>(row.final_artifact_ids_json, []),
    score: row.score,
    preflight: parseJson(row.preflight_json, null),
    postflight: parseJson(row.postflight_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeArtifact(row: ArtifactRow) {
  return {
    id: row.id,
    runId: row.run_id,
    turnId: row.turn_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    toolCallId: row.tool_call_id,
    type: row.type,
    name: row.name,
    path: row.path,
    mimeType: row.mime_type,
    sha256: row.sha256,
    checksum: row.checksum,
    sizeBytes: row.size_bytes,
    generatedBy: row.generated_by,
    previewAvailable: Boolean(row.preview_available),
    isFinal: Boolean(row.is_final),
    createdAt: row.created_at
  };
}

function normalizeApproval(row: ApprovalRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    riskLevel: row.risk_level,
    actionType: row.action_type,
    requestedAction: row.requested_action,
    reason: row.reason,
    args: parseJson(row.args_json, {}),
    status: row.status ?? 'pending',
    approvedBy: row.approved_by,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    decidedAt: row.decided_at
  };
}

function requireWorkspace(id: string) {
  const workspace = getWorkspace(id);
  if (!workspace) throw new Error(`Workspace 不存在: ${id}`);
  return workspace;
}

function requireScenario(id: string) {
  const scenario = getScenario(id);
  if (!scenario) throw new Error(`Scenario 不存在: ${id}`);
  return scenario;
}

function requireTask(id: string) {
  const row = get<TaskRow>(`SELECT t.*, w.name AS workspace_name, s.name AS scenario_name
    FROM tasks t
    LEFT JOIN workspaces w ON w.id=t.workspace_id
    LEFT JOIN scenario_templates s ON s.id=t.scenario_template_id
    WHERE t.id=?`, id);
  if (!row) throw new Error(`Task 不存在: ${id}`);
  return normalizeTask(row);
}

function requireArtifact(id: string) {
  const artifact = getArtifact(id);
  if (!artifact) throw new Error(`Artifact 不存在: ${id}`);
  return artifact;
}

function decideApproval(id: string, status: string, note?: string, approvedBy?: string, changes?: unknown) {
  const current = getApproval(id);
  if (!current) throw new Error(`Approval 不存在: ${id}`);
  run(`UPDATE approvals SET status=?, approved_by=?, decision_note=?, decided_at=? WHERE id=?`,
    status, approvedBy ?? 'local-user', note ?? null, new Date().toISOString(), id);
  if (current.taskId) {
    recordTaskEvent(current.taskId, current.runId, `approval.${status}`, { approvalId: id, note });
    const waiter = pendingApprovalWaiters.get(id);
    if (waiter) {
      pendingApprovalWaiters.delete(id);
      if (status === 'rejected') {
        run(`UPDATE tasks SET status='rejected', updated_at=? WHERE id=?`, new Date().toISOString(), current.taskId);
        recordTaskEvent(current.taskId, current.runId, 'run.stop_after_rejection', { approvalId: id, note });
        waiter.resolve({ decision: 'rejected', note });
      } else {
        run(`UPDATE tasks SET status='running', updated_at=? WHERE id=?`, new Date().toISOString(), current.taskId);
        recordTaskEvent(current.taskId, current.runId, 'run.resume_after_approval', { approvalId: id, note, status });
        waiter.resolve({
          decision: status === 'approved_with_changes' ? 'approved_with_changes' : 'approved',
          note,
          args: changes && typeof changes === 'object' && !Array.isArray(changes) ? changes as Record<string, unknown> : undefined
        });
      }
      return getApproval(id);
    }
    if (status === 'rejected') {
      run(`UPDATE tasks SET status='rejected', updated_at=? WHERE id=?`, new Date().toISOString(), current.taskId);
    } else if (!listApprovals({ taskId: current.taskId, status: 'pending' }).length) {
      run(`UPDATE tasks SET status='ready', updated_at=? WHERE id=?`, new Date().toISOString(), current.taskId);
    }
  }
  return getApproval(id);
}

function saveScenario(id: string, input: ScenarioInput) {
  const now = new Date().toISOString();
  run(`INSERT INTO scenario_templates (
    id, name, category, description, default_skill_id, required_tools_json,
    default_outputs_json, preflight_json, postflight_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category,
    description=excluded.description, default_skill_id=excluded.default_skill_id,
    required_tools_json=excluded.required_tools_json, default_outputs_json=excluded.default_outputs_json,
    preflight_json=excluded.preflight_json, postflight_json=excluded.postflight_json,
    updated_at=excluded.updated_at`,
    id, input.name.trim(), input.category ?? null, input.description ?? null,
    input.defaultSkillId ?? null, json(input.requiredTools ?? []), json(input.defaultOutputs ?? []),
    json(input.preflight ?? []), json(input.postflight ?? []), now, now);
}

function normalizeTaskInput(input: Partial<TaskInput>) {
  return {
    ...(input.input ?? {}),
    ...(input.inputFiles ? { files: input.inputFiles } : {}),
    ...(input.message ? { message: input.message } : {})
  };
}

function inputFiles(input: JsonRecord) {
  const files = input.files ?? input.inputFiles;
  return Array.isArray(files) ? files.map(String).filter(Boolean) : [];
}

function recordTaskEvent(taskId: string, runId: string | null, type: string, payload: unknown) {
  run(`INSERT INTO task_events VALUES (?, ?, ?, ?, ?, ?)`,
    `event_${randomUUID()}`, taskId, runId, type, json(payload), new Date().toISOString());
}

function safeWorkspacePath(workspaceRoot: string, requested: string) {
  const root = resolve(workspaceRoot);
  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`路径超出 workspace: ${requested}`);
  return { absolute, relative: rel || '.' };
}

function workspaceHasGit(start: string) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(resolve(current, '.git'))) return true;
    const parent = resolve(current, '..');
    if (parent === current) return false;
    current = parent;
  }
}

function withDefaultWorkspaceSettings(settings: JsonRecord = {}) {
  return {
    ...settings,
    artifactDir: typeof settings.artifactDir === 'string' ? settings.artifactDir : 'artifacts',
    tmpDir: typeof settings.tmpDir === 'string' ? settings.tmpDir : 'tmp',
    snapshotDir: typeof settings.snapshotDir === 'string' ? settings.snapshotDir : 'snapshots',
    defaultSkills: Array.isArray(settings.defaultSkills) ? settings.defaultSkills : ['excel-data-analysis', 'weekly-report', 'code-review']
  };
}

function checkId(check: unknown) {
  if (typeof check === 'string') return check;
  if (check && typeof check === 'object') return Object.keys(check as JsonRecord)[0] ?? 'unknown';
  return 'unknown';
}

function ensureWorkspaceDirs(rootPath: string, settings: JsonRecord) {
  mkdirSync(rootPath, { recursive: true });
  for (const key of ['artifactDir', 'tmpDir', 'snapshotDir']) {
    const value = typeof settings[key] === 'string' ? String(settings[key]) : key;
    mkdirSync(safeWorkspacePath(rootPath, value).absolute, { recursive: true });
  }
}

function passed(id: string, detail: string) {
  return { id, status: 'passed', detail };
}

function failed(id: string, detail: string) {
  return { id, status: 'failed', detail };
}

function scoreFromChecks(checks: Array<{ status: string }>) {
  if (!checks.length) return null;
  const passedCount = checks.filter((item) => item.status === 'passed').length;
  return Number((passedCount / checks.length * 5).toFixed(2));
}

function mimeTypeFor(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function previewAvailable(path: string) {
  return /\.(md|txt|json|csv|yaml|yml|diff|patch|ts|tsx|js|py|xlsx|xls)$/i.test(path);
}
