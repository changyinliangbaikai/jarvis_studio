import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';

export interface AgentInput {
  name: string;
  description?: string;
  defaultPromptId?: string;
  defaultPromptVersionId?: string;
  defaultModelProviderId?: string;
  defaultModel?: string;
  defaultSkillId?: string;
  defaultContextStrategyId?: string;
  defaultToolPolicyId?: string;
  defaultRuntimeId?: string;
  outputMode?: string;
  status?: 'active' | 'archived';
  tags?: string[];
}

export interface AgentRecord extends AgentInput {
  id: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

let ensured = false;

function ensureAgentsSchema() {
  if (ensured) return;
  run(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    default_prompt_id TEXT,
    default_prompt_version_id TEXT,
    default_model_provider_id TEXT,
    default_model TEXT,
    default_skill_id TEXT,
    default_context_strategy_id TEXT,
    default_tool_policy_id TEXT,
    default_runtime_id TEXT,
    output_mode TEXT,
    tags_json TEXT,
    settings_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const columns = all<{ name: string }>(`PRAGMA table_info(agents)`).map((column) => column.name);
  const add = (name: string, sql: string) => {
    if (!columns.includes(name)) run(sql);
  };
  add('status', `ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  add('default_prompt_version_id', `ALTER TABLE agents ADD COLUMN default_prompt_version_id TEXT`);
  add('default_model', `ALTER TABLE agents ADD COLUMN default_model TEXT`);
  add('default_runtime_id', `ALTER TABLE agents ADD COLUMN default_runtime_id TEXT`);
  add('tags_json', `ALTER TABLE agents ADD COLUMN tags_json TEXT`);
  run(`CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC)`);
  const now = new Date().toISOString();
  run(`INSERT OR IGNORE INTO agents (
    id, name, description, status, default_prompt_id, default_prompt_version_id,
    default_model_provider_id, default_model, default_skill_id, default_context_strategy_id,
    default_tool_policy_id, default_runtime_id, output_mode, tags_json, settings_json,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'agent_default',
    'Default Agent',
    'Jarvis Studio v0.6 默认 Agent，用于承载 Prompt-first 调试闭环。',
    'active',
    'builtin-deterministic',
    'deterministic-local',
    'balanced-v1',
    'default-local-policy',
    'local-runtime',
    'markdown',
    json(['default', 'v0.6']),
    json({ tags: ['default', 'v0.6'] }),
    now,
    now
  );
  ensured = true;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeAgent(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: text(row.description),
    status: (text(row.status) === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
    defaultPromptId: text(row.default_prompt_version_id) ?? text(row.default_prompt_id),
    defaultPromptVersionId: text(row.default_prompt_version_id) ?? text(row.default_prompt_id),
    defaultModelProviderId: text(row.default_model_provider_id),
    defaultModel: text(row.default_model),
    defaultSkillId: text(row.default_skill_id),
    defaultContextStrategyId: text(row.default_context_strategy_id),
    defaultToolPolicyId: text(row.default_tool_policy_id),
    defaultRuntimeId: text(row.default_runtime_id),
    outputMode: text(row.output_mode) ?? 'markdown',
    tags: parseJson<string[]>(row.tags_json, []),
    settings: parseJson<Record<string, unknown>>(row.settings_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function listAgents() {
  ensureAgentsSchema();
  return all<Record<string, unknown>>(`SELECT * FROM agents ORDER BY updated_at DESC`).map(normalizeAgent);
}

export function getAgent(id: string) {
  ensureAgentsSchema();
  const row = get<Record<string, unknown>>(`SELECT * FROM agents WHERE id=?`, id);
  return row ? normalizeAgent(row) : undefined;
}

export function createAgent(input: AgentInput) {
  ensureAgentsSchema();
  const now = new Date().toISOString();
  const id = `agent_${randomUUID()}`;
  const defaultPromptId = input.defaultPromptVersionId ?? input.defaultPromptId ?? null;
  run(`INSERT INTO agents (
    id, name, description, status, default_prompt_id, default_prompt_version_id,
    default_model_provider_id, default_model, default_skill_id, default_context_strategy_id,
    default_tool_policy_id, default_runtime_id, output_mode, tags_json, settings_json,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.description ?? null,
    input.status ?? 'active',
    defaultPromptId,
    defaultPromptId,
    input.defaultModelProviderId ?? null,
    input.defaultModel ?? null,
    input.defaultSkillId ?? null,
    input.defaultContextStrategyId ?? null,
    input.defaultToolPolicyId ?? null,
    input.defaultRuntimeId ?? null,
    input.outputMode ?? 'markdown',
    json(input.tags ?? []),
    json({}),
    now,
    now
  );
  return getAgent(id);
}

export function updateAgent(id: string, input: Partial<AgentInput>) {
  ensureAgentsSchema();
  const current = getAgent(id);
  if (!current) throw new Error('Agent 不存在');
  const now = new Date().toISOString();
  const nextPromptId = input.defaultPromptVersionId ?? input.defaultPromptId ?? current.defaultPromptVersionId ?? current.defaultPromptId ?? null;
  run(`UPDATE agents SET name=?, description=?, status=?, default_prompt_id=?, default_prompt_version_id=?,
    default_model_provider_id=?, default_model=?, default_skill_id=?, default_context_strategy_id=?,
    default_tool_policy_id=?, default_runtime_id=?, output_mode=?, tags_json=?, updated_at=? WHERE id=?`,
    input.name ?? current.name,
    input.description ?? current.description ?? null,
    input.status ?? current.status ?? 'active',
    nextPromptId,
    nextPromptId,
    input.defaultModelProviderId ?? current.defaultModelProviderId ?? null,
    input.defaultModel ?? current.defaultModel ?? null,
    input.defaultSkillId ?? current.defaultSkillId ?? null,
    input.defaultContextStrategyId ?? current.defaultContextStrategyId ?? null,
    input.defaultToolPolicyId ?? current.defaultToolPolicyId ?? null,
    input.defaultRuntimeId ?? current.defaultRuntimeId ?? null,
    input.outputMode ?? current.outputMode ?? 'markdown',
    json(input.tags ?? current.tags ?? []),
    now,
    id
  );
  return getAgent(id);
}

function ensurePromptDraftSchema() {
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
  add('failure_criteria_json', `ALTER TABLE prompts ADD COLUMN failure_criteria_json TEXT`);
  add('risk_notes', `ALTER TABLE prompts ADD COLUMN risk_notes TEXT`);
  add('updated_at', `ALTER TABLE prompts ADD COLUMN updated_at TEXT`);
  add('published_at', `ALTER TABLE prompts ADD COLUMN published_at TEXT`);
  add('created_from_run_id', `ALTER TABLE prompts ADD COLUMN created_from_run_id TEXT`);
}

export function createAgentWithDefaultPrompt(input: AgentInput): AgentRecord {
  const agent = createAgent(input);
  if (!agent) throw new Error('Agent 创建失败');
  ensurePromptDraftSchema();
  const now = new Date().toISOString();
  const promptId = `prompt_${randomUUID()}`;
  const basePromptName = `${input.name} Prompt`;
  const promptName = get<Record<string, unknown>>(`SELECT id FROM prompts WHERE name=? AND version='v0.1'`, basePromptName)
    ? `${basePromptName} ${agent.id.replace(/^agent_/, '').slice(0, 8)}`
    : basePromptName;
  const systemPrompt = `你是 ${input.name}。请先理解用户目标，再给出清晰、可复盘的结果。`;
  const userTemplate = '{{input}}';
  const content = `# System\n${systemPrompt}\n\n# User Template\n${userTemplate}`;
  run(`INSERT INTO prompts (
    id, name, version, content, variables_json, linked_skill, changelog, created_at,
    agent_id, status, prompt_type, system_prompt, developer_prompt, user_template,
    output_schema_json, tool_policy_json, success_criteria_json, risk_notes, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    promptId,
    promptName,
    'v0.1',
    content,
    json(['input']),
    null,
    '创建 Agent 时自动生成默认草稿',
    now,
    agent.id,
    'draft',
    'mixed',
    systemPrompt,
    '遵守工具和上下文边界，输出需要便于 Trace 复盘。',
    userTemplate,
    json({ format: input.outputMode ?? 'markdown' }),
    json({ allowedTools: [], deniedTools: [], autoCallTools: false, requireApproval: false, maxToolCalls: 3 }),
    json({ mustAnswerUser: true, followOutputFormat: true, avoidHallucination: true }),
    null,
    now
  );
  return updateAgent(agent.id, { defaultPromptVersionId: promptId }) as AgentRecord;
}

export function deleteAgent(id: string) {
  ensureAgentsSchema();
  if (id === 'agent_default') throw new Error('默认 Agent 不允许删除');
  run(`DELETE FROM agents WHERE id=?`, id);
  return { id, deleted: true };
}
