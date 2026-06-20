import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';

export interface AgentInput {
  name: string;
  description?: string;
  defaultPromptId?: string;
  defaultModelProviderId?: string;
  defaultSkillId?: string;
  defaultContextStrategyId?: string;
  defaultToolPolicyId?: string;
  outputMode?: string;
}

let ensured = false;

function ensureAgentsSchema() {
  if (ensured) return;
  run(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    default_prompt_id TEXT,
    default_model_provider_id TEXT,
    default_skill_id TEXT,
    default_context_strategy_id TEXT,
    default_tool_policy_id TEXT,
    output_mode TEXT,
    settings_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC)`);
  const now = new Date().toISOString();
  run(`INSERT OR IGNORE INTO agents (
    id, name, description, default_prompt_id, default_model_provider_id, default_skill_id,
    default_context_strategy_id, default_tool_policy_id, output_mode, settings_json, created_at, updated_at
  ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    'agent_default',
    'Default Agent',
    'Jarvis Studio v0.6 默认 Agent，用于承载 Prompt-first 调试闭环。',
    'builtin-deterministic',
    'balanced-v1',
    'default-local-policy',
    'markdown',
    json({ tags: ['default', 'v0.6'] }),
    now,
    now
  );
  ensured = true;
}

function normalizeAgent(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    defaultPromptId: row.default_prompt_id,
    defaultModelProviderId: row.default_model_provider_id,
    defaultSkillId: row.default_skill_id,
    defaultContextStrategyId: row.default_context_strategy_id,
    defaultToolPolicyId: row.default_tool_policy_id,
    outputMode: row.output_mode,
    settings: parseJson(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
  run(`INSERT INTO agents (
    id, name, description, default_prompt_id, default_model_provider_id, default_skill_id,
    default_context_strategy_id, default_tool_policy_id, output_mode, settings_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.description ?? null,
    input.defaultPromptId ?? null,
    input.defaultModelProviderId ?? null,
    input.defaultSkillId ?? null,
    input.defaultContextStrategyId ?? null,
    input.defaultToolPolicyId ?? null,
    input.outputMode ?? 'markdown',
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
  run(`UPDATE agents SET name=?, description=?, default_prompt_id=?, default_model_provider_id=?, default_skill_id=?,
    default_context_strategy_id=?, default_tool_policy_id=?, output_mode=?, updated_at=? WHERE id=?`,
    input.name ?? String(current.name),
    input.description ?? current.description ?? null,
    input.defaultPromptId ?? current.defaultPromptId ?? null,
    input.defaultModelProviderId ?? current.defaultModelProviderId ?? null,
    input.defaultSkillId ?? current.defaultSkillId ?? null,
    input.defaultContextStrategyId ?? current.defaultContextStrategyId ?? null,
    input.defaultToolPolicyId ?? current.defaultToolPolicyId ?? null,
    input.outputMode ?? current.outputMode ?? 'markdown',
    now,
    id
  );
  return getAgent(id);
}

export function deleteAgent(id: string) {
  ensureAgentsSchema();
  if (id === 'agent_default') throw new Error('默认 Agent 不允许删除');
  run(`DELETE FROM agents WHERE id=?`, id);
  return { id, deleted: true };
}
