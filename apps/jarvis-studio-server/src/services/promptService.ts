import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';
import { extractVariables, renderPrompt } from '@jarvis/prompt-manager';
import { importTraceJsonl } from './traceImportService.ts';
import { getAgent, updateAgent } from './agentService.ts';

export interface PromptInput {
  name: string;
  version?: string;
  content?: string;
  agentId?: string;
  status?: 'draft' | 'active' | 'archived';
  promptType?: string;
  systemPrompt?: string;
  developerPrompt?: string;
  userTemplate?: string;
  linkedSkill?: string;
  changelog?: string;
  outputSchema?: unknown;
  toolPolicy?: unknown;
  successCriteria?: unknown;
  riskNotes?: string;
}

let promptOpsSchemaEnsured = false;

function ensurePromptOpsSchema() {
  if (promptOpsSchemaEnsured) return;
  const columns = all<{ name: string }>(`PRAGMA table_info(prompts)`).map((column) => column.name);
  const add = (name: string, sql: string) => {
    if (!columns.includes(name)) run(sql);
  };
  add('agent_id', `ALTER TABLE prompts ADD COLUMN agent_id TEXT`);
  add('status', `ALTER TABLE prompts ADD COLUMN status TEXT DEFAULT 'draft'`);
  add('prompt_type', `ALTER TABLE prompts ADD COLUMN prompt_type TEXT DEFAULT 'mixed'`);
  add('system_prompt', `ALTER TABLE prompts ADD COLUMN system_prompt TEXT`);
  add('developer_prompt', `ALTER TABLE prompts ADD COLUMN developer_prompt TEXT`);
  add('user_template', `ALTER TABLE prompts ADD COLUMN user_template TEXT`);
  add('output_schema_json', `ALTER TABLE prompts ADD COLUMN output_schema_json TEXT`);
  add('tool_policy_json', `ALTER TABLE prompts ADD COLUMN tool_policy_json TEXT`);
  add('success_criteria_json', `ALTER TABLE prompts ADD COLUMN success_criteria_json TEXT`);
  add('risk_notes', `ALTER TABLE prompts ADD COLUMN risk_notes TEXT`);
  add('updated_at', `ALTER TABLE prompts ADD COLUMN updated_at TEXT`);
  run(`CREATE INDEX IF NOT EXISTS idx_prompts_agent ON prompts(agent_id, status, created_at DESC)`);
  run(`UPDATE prompts SET status='draft' WHERE status IS NULL`);
  run(`UPDATE prompts SET prompt_type='mixed' WHERE prompt_type IS NULL`);
  run(`UPDATE prompts SET updated_at=created_at WHERE updated_at IS NULL`);
  promptOpsSchemaEnsured = true;
}

export function listPrompts(filters: Record<string, unknown> = {}) {
  ensurePromptOpsSchema();
  const clauses: string[] = [];
  const params: string[] = [];
  if (typeof filters.agentId === 'string' && filters.agentId) {
    clauses.push('agent_id = ?');
    params.push(filters.agentId);
  }
  if (typeof filters.status === 'string' && filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(`SELECT * FROM prompts ${where} ORDER BY name, created_at DESC`, ...params).map(normalize);
}
export function getPrompt(id: string) {
  ensurePromptOpsSchema();
  const row = get<Record<string, unknown>>(`SELECT * FROM prompts WHERE id=?`, id);
  return row ? normalize(row) : undefined;
}
function normalize(row: Record<string, unknown>) {
  const content = String(row.content ?? '');
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    version: row.version,
    status: row.status ?? 'draft',
    promptType: row.prompt_type ?? 'mixed',
    content,
    systemPrompt: row.system_prompt ?? content,
    developerPrompt: row.developer_prompt ?? '',
    userTemplate: row.user_template ?? '',
    variables: parseJson(row.variables_json, extractVariables(content)),
    linkedSkill: row.linked_skill,
    changelog: row.changelog,
    outputSchema: parseJson(row.output_schema_json, {}),
    toolPolicy: parseJson(row.tool_policy_json, {}),
    successCriteria: parseJson(row.success_criteria_json, {}),
    riskNotes: row.risk_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at
  };
}

function composePrompt(input: Partial<PromptInput>) {
  if (typeof input.content === 'string' && input.content.trim()) return input.content;
  return [
    input.systemPrompt ? `# System\n${input.systemPrompt}` : '',
    input.developerPrompt ? `# Developer\n${input.developerPrompt}` : '',
    input.userTemplate ? `# User Template\n${input.userTemplate}` : ''
  ].filter(Boolean).join('\n\n') || '请根据用户输入完成任务：{{input}}';
}

function hasStructuredPromptInput(input: Partial<PromptInput>) {
  return input.systemPrompt !== undefined || input.developerPrompt !== undefined || input.userTemplate !== undefined;
}

export function createPrompt(input: PromptInput) {
  ensurePromptOpsSchema();
  const id = randomUUID();
  const version = input.version ?? 'v0.1';
  const now = new Date().toISOString();
  const content = composePrompt(input);
  const status = input.status ?? 'draft';
  if (status === 'active' && input.agentId) setAgentPromptsInactive(input.agentId, input.name);
  run(`INSERT INTO prompts (
    id, name, version, content, variables_json, linked_skill, changelog, created_at,
    agent_id, status, prompt_type, system_prompt, developer_prompt, user_template,
    output_schema_json, tool_policy_json, success_criteria_json, risk_notes, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    version,
    content,
    json(extractVariables(content)),
    input.linkedSkill ?? null,
    input.changelog ?? null,
    now,
    input.agentId ?? null,
    status,
    input.promptType ?? 'mixed',
    input.systemPrompt ?? content,
    input.developerPrompt ?? null,
    input.userTemplate ?? null,
    json(input.outputSchema ?? {}),
    json(input.toolPolicy ?? {}),
    json(input.successCriteria ?? {}),
    input.riskNotes ?? null,
    now
  );
  if (status === 'active' && input.agentId) updateAgent(input.agentId, { defaultPromptId: id });
  return getPrompt(id);
}

function setAgentPromptsInactive(agentId: string, name?: string) {
  if (name) run(`UPDATE prompts SET status='archived', updated_at=? WHERE agent_id=? AND name=? AND status='active'`, new Date().toISOString(), agentId, name);
  else run(`UPDATE prompts SET status='archived', updated_at=? WHERE agent_id=? AND status='active'`, new Date().toISOString(), agentId);
}

export function createPromptVersion(sourceId: string, input: Partial<PromptInput>) {
  ensurePromptOpsSchema();
  const source = getPrompt(sourceId);
  if (!source) throw new Error('Prompt 不存在');
  const latest = all<{ version: string }>(`SELECT version FROM prompts WHERE name=? ORDER BY created_at DESC`, String(source.name))[0]?.version ?? 'v0.0';
  const match = latest.match(/v(\d+)\.(\d+)/);
  const version = input.version ?? `v${match?.[1] ?? 0}.${Number(match?.[2] ?? 0) + 1}`;
  const structured = hasStructuredPromptInput(input);
  return createPrompt({
    name: source.name as string,
    agentId: input.agentId ?? source.agentId as string | undefined,
    version,
    status: input.status ?? 'draft',
    promptType: input.promptType ?? source.promptType as string | undefined,
    content: input.content ?? (structured ? undefined : source.content as string),
    systemPrompt: input.systemPrompt ?? source.systemPrompt as string | undefined,
    developerPrompt: input.developerPrompt ?? source.developerPrompt as string | undefined,
    userTemplate: input.userTemplate ?? source.userTemplate as string | undefined,
    linkedSkill: input.linkedSkill ?? source.linkedSkill as string | undefined,
    changelog: input.changelog ?? `基于 ${latest} 创建`,
    outputSchema: input.outputSchema ?? source.outputSchema,
    toolPolicy: input.toolPolicy ?? source.toolPolicy,
    successCriteria: input.successCriteria ?? source.successCriteria,
    riskNotes: input.riskNotes ?? source.riskNotes as string | undefined
  });
}

export function activatePrompt(id: string) {
  ensurePromptOpsSchema();
  const prompt = getPrompt(id);
  if (!prompt) throw new Error('Prompt 不存在');
  const now = new Date().toISOString();
  if (prompt.agentId) setAgentPromptsInactive(String(prompt.agentId), String(prompt.name));
  run(`UPDATE prompts SET status='active', updated_at=? WHERE id=?`, now, id);
  if (prompt.agentId) updateAgent(String(prompt.agentId), { defaultPromptId: id });
  return getPrompt(id);
}

export function archivePrompt(id: string) {
  ensurePromptOpsSchema();
  const prompt = getPrompt(id);
  if (!prompt) throw new Error('Prompt 不存在');
  run(`UPDATE prompts SET status='archived', updated_at=? WHERE id=?`, new Date().toISOString(), id);
  return getPrompt(id);
}

export function testPrompt(id: string, variables: Record<string, string>, inputMessage: string, options: Record<string, unknown> = {}) {
  const prompt = getPrompt(id);
  if (!prompt) throw new Error('Prompt 不存在');
  const agent = prompt.agentId ? getAgent(String(prompt.agentId)) : undefined;
  const now = new Date();
  const runId = `playground_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;
  const turnId = `turn_${randomUUID()}`;
  const contextId = `ctx_${randomUUID()}`;
  const finalVariables = { input: inputMessage, ...variables };
  const rendered = renderPrompt(prompt.content as string, finalVariables);
  const response = `Playground Runtime 已完成模拟运行。\n\nAgent：${agent?.name ?? '未绑定'}\nPrompt：${prompt.name}@${prompt.version}\n输入：${inputMessage}\n\n下一步可进入 Trace 查看 Prompt 快照、LLM Call 与 Run 元数据。`;
  const promptTokens = Math.ceil(rendered.length / 4);
  const completionTokens = Math.ceil(response.length / 4);
  const events = [
    { eventId: randomUUID(), eventType: 'run.start', timestamp: now.toISOString(), sessionId, runId, payload: { name: `Playground · ${agent?.name ?? prompt.name}`, model: options.modelName ?? 'mock-runtime', modelProvider: options.modelProviderId ?? 'local', promptVersion: `${prompt.name}@${prompt.version}`, runtimeVersion: 'jarvis-studio-playground@0.6.0', metadata: { agentId: prompt.agentId, promptId: prompt.id, promptStatus: prompt.status, toolPolicy: prompt.toolPolicy, outputSchema: prompt.outputSchema, successCriteria: prompt.successCriteria } } },
    { eventId: randomUUID(), eventType: 'turn.start', timestamp: new Date(now.getTime() + 10).toISOString(), sessionId, turnId, runId, payload: { index: 1, userMessage: inputMessage } },
    { eventId: randomUUID(), eventType: 'context.build', timestamp: new Date(now.getTime() + 20).toISOString(), sessionId, turnId, runId, spanId: randomUUID(), payload: { contextSnapshotId: contextId, totalTokens: promptTokens, maxContextTokens: 32768, truncated: false, compressed: false, finalPrompt: rendered, segments: [{ id: randomUUID(), type: 'system_prompt', name: `${prompt.name}@${prompt.version}`, version: prompt.version, preview: rendered.slice(0, 500), tokens: promptTokens, included: true }] } },
    { eventId: randomUUID(), eventType: 'llm.call', timestamp: new Date(now.getTime() + 30).toISOString(), sessionId, turnId, runId, spanId: randomUUID(), payload: { model: options.modelName ?? 'mock-runtime', provider: options.modelProviderId ?? 'local', promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, latencyMs: 120, contextSnapshotId: contextId, output: { type: 'text', content: response } } },
    { eventId: randomUUID(), eventType: 'turn.end', timestamp: new Date(now.getTime() + 140).toISOString(), sessionId, turnId, runId, payload: { status: 'success', assistantMessage: response } },
    { eventId: randomUUID(), eventType: 'run.end', timestamp: new Date(now.getTime() + 150).toISOString(), sessionId, runId, payload: { status: 'success', latencyMs: 150, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, score: 5, metadata: { agentId: prompt.agentId, promptId: prompt.id } } }
  ];
  importTraceJsonl(events.map((event) => JSON.stringify(event)).join('\n'));
  return { runId, rendered, response, agent, prompt };
}
