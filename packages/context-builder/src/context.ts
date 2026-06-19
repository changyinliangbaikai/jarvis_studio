import { randomUUID } from 'node:crypto';
import type { ModelMessage, SkillDefinition, ToolDefinition } from '@jarvis/shared-types';

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 3.2));
}

export function buildContext(input: {
  skill: SkillDefinition;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolDefinition[];
  toolResults: Array<{ name: string; result: unknown }>;
  strategy?: string;
  maxContextTokens?: number;
}) {
  const budgetStrategy = input.strategy ?? 'balanced-v1';
  const maxContextTokens = input.maxContextTokens ?? 32768;
  const reservedOutputTokens = 4096;
  const rawSegments = [
    segment('system_prompt', 'agent-runtime', 'You are Jarvis Agent Runtime, a local tool-using Agent.', 100, 'keep', 2000),
    segment('skill_instruction', `${input.skill.id}@${input.skill.version}`, `${input.skill.systemPrompt}\n\n${input.skill.instructions}`, 90, 'progressive', input.skill.contextPolicy?.maxTokens ?? 3000),
    segment('user_message', 'current-user-input', input.message, 100, 'keep', 4000),
    segment('tool_descriptions', 'available-tools', JSON.stringify(input.tools, null, 2), 80, 'compact', 4000),
    segment('conversation_history', 'previous-turns', JSON.stringify(input.history), 60, 'summarize', 6000),
    segment('tool_result', 'current-tool-results', JSON.stringify(input.toolResults, null, 2), 75, 'summarize', 3000)
  ];
  const segments = applyBudget(rawSegments, maxContextTokens - reservedOutputTokens);
  const messages: ModelMessage[] = [
    { role: 'system', content: `${segments[0]?.preview}\n\n${segments[1]?.preview}` },
    ...input.history,
    { role: 'user', content: input.message },
    ...input.toolResults.map((item) => ({ role: 'user' as const, content: `[Tool result: ${item.name}]\n${JSON.stringify(item.result)}` }))
  ];
  return {
    id: `ctx_${randomUUID()}`,
    budgetStrategy,
    reservedOutputTokens,
    totalTokensBeforeBudget: rawSegments.reduce((sum, item) => sum + item.tokensBefore, 0),
    totalTokensAfterBudget: segments.reduce((sum, item) => sum + item.tokensAfter, 0),
    totalTokens: segments.reduce((sum, item) => sum + item.tokensAfter, 0),
    maxContextTokens,
    truncated: segments.some((item) => item.truncated),
    compressed: segments.some((item) => item.compressed),
    risks: analyzeContextRisks(segments, maxContextTokens),
    segments,
    messages,
    finalPrompt: messages.map((message) => `[${message.role.toUpperCase()}]\n${message.content}`).join('\n\n')
  };
}

function segment(type: string, name: string, preview: string, priority: number, mode: string, maxTokens: number) {
  const tokens = estimateTokens(preview);
  return {
    id: `seg_${randomUUID()}`,
    type,
    name,
    preview,
    tokens,
    tokensBefore: tokens,
    tokensAfter: tokens,
    included: true,
    truncated: false,
    compressed: false,
    priority,
    action: 'keep',
    mode,
    maxTokens,
    reason: 'within budget'
  };
}

function applyBudget(segments: ReturnType<typeof segment>[], budget: number) {
  let total = segments.reduce((sum, item) => sum + item.tokensBefore, 0);
  const next = segments.map((item) => ({ ...item }));
  for (const item of next.sort((left, right) => left.priority - right.priority)) {
    if (total <= budget) break;
    if (item.priority >= 100) continue;
    const target = Math.max(1, Math.min(item.maxTokens, Math.floor(item.tokensBefore * actionRatio(item.mode))));
    if (target < item.tokensAfter) {
      const saved = item.tokensAfter - target;
      item.tokensAfter = target;
      item.tokens = target;
      item.compressed = item.mode !== 'truncate' && item.mode !== 'drop';
      item.truncated = item.mode === 'truncate';
      item.action = item.mode === 'progressive' ? 'compress' : item.mode;
      item.preview = trimToTokens(item.preview, target);
      item.reason = `${item.mode} applied by balanced budget`;
      total -= saved;
    }
  }
  if (total > budget) {
    for (const item of next.sort((left, right) => left.priority - right.priority)) {
      if (total <= budget) break;
      if (item.priority >= 90) continue;
      total -= item.tokensAfter;
      item.tokensAfter = 0;
      item.tokens = 0;
      item.included = false;
      item.action = 'drop';
      item.reason = 'dropped after lower-impact compression could not fit budget';
    }
  }
  return next.sort((left, right) => segmentOrder(left.type) - segmentOrder(right.type));
}

function actionRatio(mode: string) {
  if (mode === 'keep') return 1;
  if (mode === 'compact') return 0.55;
  if (mode === 'summarize') return 0.35;
  if (mode === 'progressive') return 0.7;
  if (mode === 'truncate') return 0.45;
  if (mode === 'drop') return 0;
  return 0.6;
}

function trimToTokens(value: string, maxTokens: number) {
  const maxChars = Math.max(120, Math.floor(maxTokens * 3.2));
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[budgeted]` : value;
}

export function analyzeContextRisks(segments: Array<{ type: string; tokensBefore: number; tokensAfter: number; compressed: boolean; truncated: boolean; included: boolean }>, maxContextTokens: number) {
  const totalAfter = segments.reduce((sum, item) => sum + item.tokensAfter, 0);
  const risks: Array<{ type: string; severity: 'low' | 'medium' | 'high'; message: string }> = [];
  const history = segments.find((item) => item.type === 'conversation_history');
  if (history && totalAfter && history.tokensAfter / totalAfter > 0.45) risks.push({ type: 'context_pollution', severity: 'medium', message: 'conversation_history 占比过高，可能挤占当前任务上下文。' });
  const toolResult = segments.find((item) => item.type === 'tool_result');
  if (toolResult && toolResult.tokensBefore > 12000 && toolResult.compressed) risks.push({ type: 'tool_result_too_large', severity: 'medium', message: 'tool_result 原始输出过长，已摘要后注入，建议优化工具返回。' });
  const skill = segments.find((item) => item.type === 'skill_instruction');
  if (skill && skill.tokensBefore > 0 && skill.tokensAfter / skill.tokensBefore < 0.4) risks.push({ type: 'skill_instruction_overcompressed', severity: 'high', message: 'skill_instruction 被大幅压缩，可能导致 Skill 行为不稳定。' });
  if (totalAfter > maxContextTokens * 0.9) risks.push({ type: 'context_overflow', severity: 'high', message: '上下文接近模型窗口上限，prefill 延迟和截断风险升高。' });
  if (segments.some((item) => !item.included || item.truncated)) risks.push({ type: 'context_truncated', severity: 'medium', message: '部分上下文被截断或丢弃，请检查是否包含关键输入。' });
  return risks;
}

function segmentOrder(type: string) {
  return ['system_prompt', 'skill_instruction', 'user_message', 'tool_descriptions', 'conversation_history', 'tool_result'].indexOf(type);
}
