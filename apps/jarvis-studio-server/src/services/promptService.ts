import { randomUUID } from 'node:crypto';
import { all, get, json, parseJson, run } from '../db/database.ts';
import { extractVariables, renderPrompt } from '@jarvis/prompt-manager';
import { importTraceJsonl } from './traceImportService.ts';

export interface PromptInput {
  name: string;
  version?: string;
  content: string;
  linkedSkill?: string;
  changelog?: string;
}

export function listPrompts() {
  return all<Record<string, unknown>>(`SELECT * FROM prompts ORDER BY name, created_at DESC`).map(normalize);
}
export function getPrompt(id: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM prompts WHERE id=?`, id);
  return row ? normalize(row) : undefined;
}
function normalize(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, version: row.version, content: row.content,
    variables: parseJson(row.variables_json, []), linkedSkill: row.linked_skill,
    changelog: row.changelog, createdAt: row.created_at
  };
}
export function createPrompt(input: PromptInput) {
  const id = randomUUID();
  const version = input.version ?? 'v0.1';
  run(`INSERT INTO prompts VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, input.name, version, input.content,
    json(extractVariables(input.content)), input.linkedSkill ?? null, input.changelog ?? null, new Date().toISOString());
  return getPrompt(id);
}
export function createPromptVersion(sourceId: string, input: Partial<PromptInput>) {
  const source = getPrompt(sourceId);
  if (!source) throw new Error('Prompt 不存在');
  const latest = all<{ version: string }>(`SELECT version FROM prompts WHERE name=? ORDER BY created_at DESC`, String(source.name))[0]?.version ?? 'v0.0';
  const match = latest.match(/v(\d+)\.(\d+)/);
  const version = input.version ?? `v${match?.[1] ?? 0}.${Number(match?.[2] ?? 0) + 1}`;
  return createPrompt({
    name: source.name as string,
    version,
    content: input.content ?? source.content as string,
    linkedSkill: input.linkedSkill ?? source.linkedSkill as string | undefined,
    changelog: input.changelog ?? `基于 ${latest} 创建`
  });
}
export function testPrompt(id: string, variables: Record<string, string>, inputMessage: string) {
  const prompt = getPrompt(id);
  if (!prompt) throw new Error('Prompt 不存在');
  const now = new Date();
  const runId = `prompt_test_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;
  const turnId = `turn_${randomUUID()}`;
  const contextId = `ctx_${randomUUID()}`;
  const rendered = renderPrompt(prompt.content as string, variables);
  const response = `Mock Runtime 已完成 Prompt 测试。\n\n输入：${inputMessage}\n\n渲染结果长度：${rendered.length} 字符。`;
  const events = [
    { eventId: randomUUID(), eventType: 'run.start', timestamp: now.toISOString(), sessionId, runId, payload: { name: `Prompt Test · ${prompt.name}`, model: 'mock-runtime', modelProvider: 'local', promptVersion: `${prompt.name}@${prompt.version}`, runtimeVersion: 'jarvis-studio-mock@0.1.0' } },
    { eventId: randomUUID(), eventType: 'turn.start', timestamp: new Date(now.getTime() + 10).toISOString(), sessionId, turnId, runId, payload: { index: 1, userMessage: inputMessage } },
    { eventId: randomUUID(), eventType: 'context.build', timestamp: new Date(now.getTime() + 20).toISOString(), sessionId, turnId, runId, spanId: randomUUID(), payload: { contextSnapshotId: contextId, totalTokens: Math.ceil(rendered.length / 4), maxContextTokens: 32768, truncated: false, compressed: false, finalPrompt: rendered, segments: [{ id: randomUUID(), type: 'system_prompt', name: `${prompt.name}@${prompt.version}`, version: prompt.version, preview: rendered.slice(0, 300), tokens: Math.ceil(rendered.length / 4), included: true }] } },
    { eventId: randomUUID(), eventType: 'llm.call', timestamp: new Date(now.getTime() + 30).toISOString(), sessionId, turnId, runId, spanId: randomUUID(), payload: { model: 'mock-runtime', provider: 'local', promptTokens: Math.ceil(rendered.length / 4), completionTokens: Math.ceil(response.length / 4), totalTokens: Math.ceil((rendered.length + response.length) / 4), latencyMs: 80, contextSnapshotId: contextId, output: { type: 'text', content: response } } },
    { eventId: randomUUID(), eventType: 'turn.end', timestamp: new Date(now.getTime() + 90).toISOString(), sessionId, turnId, runId, payload: { status: 'success', assistantMessage: response } },
    { eventId: randomUUID(), eventType: 'run.end', timestamp: new Date(now.getTime() + 100).toISOString(), sessionId, runId, payload: { status: 'success', latencyMs: 100, promptTokens: Math.ceil(rendered.length / 4), completionTokens: Math.ceil(response.length / 4), totalTokens: Math.ceil((rendered.length + response.length) / 4), score: 5 } }
  ];
  importTraceJsonl(events.map((event) => JSON.stringify(event)).join('\n'));
  return { runId, rendered, response };
}
