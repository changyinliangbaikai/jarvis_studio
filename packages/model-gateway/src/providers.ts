import { randomUUID } from 'node:crypto';
import { estimateTokens } from '@jarvis/context-builder';
import type { ModelMessage, ModelProfile, ModelResponse, ModelToolCall, SkillDefinition, ToolDefinition } from '@jarvis/shared-types';
import { logModelProviderError } from './diagnostics.ts';

export async function callModel(input: {
  profile: ModelProfile;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  skill: SkillDefinition;
  completedTools: string[];
  files: string[];
}): Promise<ModelResponse> {
  if (input.profile.provider === 'openai-compatible') return callOpenAICompatible(input);
  return callDeterministic(input);
}

async function callOpenAICompatible(input: Parameters<typeof callModel>[0]): Promise<ModelResponse> {
  const baseUrl = (input.profile.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
  const apiKey = input.profile.apiKey ?? process.env.OPENAI_API_KEY ?? 'ollama';
  const started = performance.now();
  const endpoint = `${baseUrl}/chat/completions`;
  const externalToolNames = new Map(input.tools.map((tool) => [openAIToolName(tool.name), tool.name]));
  const toolPayload = input.tools.map((tool) => ({ type: 'function', function: { name: openAIToolName(tool.name), description: tool.description, parameters: tool.inputSchema } }));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: input.profile.model,
        messages: input.messages.map((message) => ({ role: message.role, content: message.content, tool_call_id: message.toolCallId })),
        ...(toolPayload.length ? { tools: toolPayload, tool_choice: 'auto' } : {}),
        temperature: input.profile.temperature ?? 0.2,
        max_tokens: input.profile.maxOutputTokens ?? 2048
      })
    });
  } catch (error) {
    logModelProviderError('chat_completions.network_error', {
      endpoint,
      model: input.profile.model,
      messageCount: input.messages.length,
      toolCount: input.tools.length,
      latencyMs: Math.round(performance.now() - started),
      error: errorDetails(error)
    });
    throw error;
  }
  const responseBody = await response.text();
  const responseMeta = {
    endpoint,
    model: input.profile.model,
    messageCount: input.messages.length,
    toolCount: input.tools.length,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type'),
    requestId: response.headers.get('x-request-id') ?? response.headers.get('x-client-request-id'),
    latencyMs: Math.round(performance.now() - started)
  };
  if (!response.ok) {
    logModelProviderError('chat_completions.http_error', { ...responseMeta, responseBody: responseBody.slice(0, 4000) });
    throw new Error(`OpenAI-compatible 模型调用失败: HTTP ${response.status}${responseMeta.requestId ? ` · requestId=${responseMeta.requestId}` : ''}`);
  }
  let data: {
    model?: string;
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    data = JSON.parse(responseBody) as typeof data;
  } catch (error) {
    logModelProviderError('chat_completions.invalid_json', {
      ...responseMeta,
      responseBody: responseBody.slice(0, 4000),
      error: errorDetails(error)
    });
    throw new Error(`OpenAI-compatible 模型返回了无效 JSON${responseMeta.requestId ? ` · requestId=${responseMeta.requestId}` : ''}`);
  }
  const message = data.choices?.[0]?.message;
  const toolCalls: ModelToolCall[] = (message?.tool_calls ?? []).flatMap((call) => {
    if (!call.function?.name) return [];
    return [{
      id: call.id ?? `call_${randomUUID()}`,
      name: externalToolNames.get(call.function.name) ?? call.function.name,
      arguments: parseToolArguments(call.function.arguments)
    }];
  });
  const promptTokens = data.usage?.prompt_tokens ?? estimateTokens(input.messages.map((item) => item.content).join('\n'));
  const completionTokens = data.usage?.completion_tokens ?? estimateTokens(message?.content ?? '');
  return {
    content: message?.content ?? '',
    toolCalls,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens
    },
    latencyMs: Math.round(performance.now() - started),
    model: data.model ?? input.profile.model,
    provider: 'openai-compatible'
  };
}

export function openAIToolName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : error.cause
  };
}

function parseToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function callDeterministic(input: Parameters<typeof callModel>[0]): Promise<ModelResponse> {
  const started = performance.now();
  const nextRequired = input.skill.requiredTools.find((tool) => !input.completedTools.includes(tool));
  const toolCalls: ModelToolCall[] = nextRequired ? [{
    id: `call_${randomUUID()}`,
    name: nextRequired,
    arguments: deterministicToolArguments(nextRequired, input.skill, input.files)
  }] : [];
  const content = nextRequired ? `为完成 ${input.skill.name}，下一步调用 ${nextRequired}。` : deterministicFinal(input.skill);
  const promptTokens = estimateTokens(input.messages.map((message) => message.content).join('\n'));
  const completionTokens = estimateTokens(content);
  return {
    content, toolCalls,
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    model: input.profile.model || 'deterministic-local',
    provider: 'deterministic'
  };
}

export function deterministicToolArguments(tool: string, skill: SkillDefinition, files: string[]): Record<string, unknown> {
  if (tool === 'xlsx.inspect') return { path: files[0] ?? 'input/customer_data.xlsx', sampleRows: 12 };
  if (tool === 'filesystem.read') return { path: files[0] ?? 'input/sample.ts' };
  if (tool === 'filesystem.write' && skill.id === 'excel-data-analysis') return { path: '.jarvis-runtime/prepare-analysis.py', content: '__RUNTIME_GENERATED_EXCEL_SCRIPT__' };
  if (tool === 'filesystem.write') return { path: skill.outputFile ?? 'output/result.md', content: deterministicFinal(skill) };
  if (tool === 'python.run') return { scriptPath: '.jarvis-runtime/prepare-analysis.py' };
  if (tool === 'git.status') return {};
  if (tool === 'git.diff') return files.length ? { paths: files } : {};
  if (tool === 'docx.read') return { path: files[0] ?? 'input/weekly-notes.md' };
  if (tool === 'docx.write') return { path: 'output/weekly_report.docx', content: deterministicFinal(skill) };
  if (tool === 'patch.apply') return { dryRun: true };
  if (tool === 'shell.safe_run') return { command: ['git', 'status', '--short'] };
  return {};
}

export function deterministicFinal(skill: SkillDefinition) {
  if (skill.id === 'excel-data-analysis') return '已完成数据概况、异常发现与营销建议分析，并生成 output/analysis_report.md。';
  if (skill.id === 'weekly-report') return '# 周报\n\n## 本周完成\n已根据输入整理工作进展。\n\n## 问题与风险\n未发现未说明风险。\n\n## 下周计划\n继续推进重点任务。';
  return '# Code Review\n\n## Findings\n未发现阻断性问题。建议补充边界条件测试。\n\n## Summary\n已完成代码审查。';
}
