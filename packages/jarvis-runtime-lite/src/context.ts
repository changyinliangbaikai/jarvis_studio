import { randomUUID } from 'node:crypto';
import type { ModelMessage, SkillDefinition, ToolDefinition } from './types.ts';

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 3.2));
}

export function buildContext(input: {
  skill: SkillDefinition;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolDefinition[];
  toolResults: Array<{ name: string; result: unknown }>;
}) {
  const segments = [
    segment('system_prompt', 'jarvis-runtime-lite', 'You are Jarvis Runtime Lite, a local tool-using Agent.', 100),
    segment('skill_instruction', `${input.skill.id}@${input.skill.version}`, `${input.skill.systemPrompt}\n\n${input.skill.instructions}`, 95),
    segment('user_message', 'current-user-input', input.message, 100),
    segment('tool_descriptions', 'available-tools', JSON.stringify(input.tools, null, 2), 85),
    segment('conversation_history', 'previous-turns', JSON.stringify(input.history), 60),
    segment('tool_result', 'current-tool-results', JSON.stringify(input.toolResults, null, 2), 90)
  ];
  const messages: ModelMessage[] = [
    { role: 'system', content: `${segments[0]?.preview}\n\n${segments[1]?.preview}` },
    ...input.history,
    { role: 'user', content: input.message },
    ...input.toolResults.map((item) => ({ role: 'user' as const, content: `[Tool result: ${item.name}]\n${JSON.stringify(item.result)}` }))
  ];
  return {
    id: `ctx_${randomUUID()}`,
    totalTokens: segments.reduce((sum, item) => sum + item.tokens, 0),
    maxContextTokens: 65536,
    truncated: false,
    compressed: false,
    segments,
    messages,
    finalPrompt: messages.map((message) => `[${message.role.toUpperCase()}]\n${message.content}`).join('\n\n')
  };
}

function segment(type: string, name: string, preview: string, priority: number) {
  return { id: `seg_${randomUUID()}`, type, name, preview, tokens: estimateTokens(preview), included: true, truncated: false, compressed: false, priority };
}
