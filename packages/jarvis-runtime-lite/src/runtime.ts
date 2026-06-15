import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { TraceEvent } from '../../trace-schema/src/events.ts';
import { buildContext } from './context.ts';
import { callModel, deterministicToolArguments } from './providers.ts';
import { selectSkill } from './skills.ts';
import { executeTool, toolDefinitions } from './tools.ts';
import type { ModelToolCall, RuntimeIds, RuntimeRequest, RuntimeResult, SkillDefinition, TraceSink } from './types.ts';

export function createRuntimeIds(): RuntimeIds {
  return {
    projectId: 'jarvis-studio-local',
    sessionId: `session_${randomUUID()}`,
    turnId: `turn_${randomUUID()}`,
    runId: `runtime_${randomUUID()}`
  };
}

export async function runAgent(request: RuntimeRequest, options: { ids?: RuntimeIds; onEvent?: TraceSink } = {}): Promise<RuntimeResult> {
  const ids = options.ids ?? createRuntimeIds();
  const skill = selectSkill(request.message, request.skill);
  const events: TraceEvent[] = [];
  const toolCalls: RuntimeResult['toolCalls'] = [];
  const artifacts: RuntimeResult['artifacts'] = [];
  const completedTools: string[] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];
  const startedAt = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let output = '';

  const emit = async (eventType: string, payload: Record<string, unknown>, extra: Partial<TraceEvent> = {}) => {
    const event: TraceEvent = {
      eventId: `evt_${randomUUID()}`,
      eventType,
      timestamp: new Date().toISOString(),
      projectId: ids.projectId,
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      runId: ids.runId,
      payload,
      ...extra
    };
    events.push(event);
    await options.onEvent?.(event);
    return event;
  };

  try {
    await emit('run.start', {
      name: request.name ?? request.message.slice(0, 42),
      model: request.modelProfile.model,
      modelProvider: request.modelProfile.provider,
      promptVersion: request.promptVersion ?? `${skill.id}@${skill.version}`,
      skillVersions: [`${skill.id}@${skill.version}`],
      toolSchemaVersion: 'jarvis-runtime-tools@v0.2',
      runtimeVersion: 'jarvis-runtime-lite@0.3.0',
      contextStrategyVersion: 'segmented-snapshot@v0.2',
      workspacePath: request.workspacePath
    });
    await emit('turn.start', { index: 1, userMessage: request.message, files: request.files ?? [] });
    await emit('skill.select', {
      name: `skill.select: ${skill.id}`,
      selected: `${skill.id}@${skill.version}`,
      reason: request.skill ? '用户显式选择' : '基于消息与文件类型自动选择',
      requiredTools: skill.requiredTools,
      permissions: skill.permissions
    }, { spanId: `span_${randomUUID()}` });

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const context = buildContext({
        skill,
        message: request.message,
        history: request.history ?? [],
        tools: toolDefinitions.filter((tool) => skill.requiredTools.includes(tool.name)),
        toolResults
      });
      const contextSpanId = `span_${randomUUID()}`;
      await emit('context.build', {
        name: `context.build #${iteration + 1}`,
        contextSnapshotId: context.id,
        totalTokens: context.totalTokens,
        maxContextTokens: context.maxContextTokens,
        truncated: context.truncated,
        compressed: context.compressed,
        finalPrompt: context.finalPrompt,
        segments: context.segments
      }, { spanId: contextSpanId });

      const llmSpanId = `span_${randomUUID()}`;
      let response = await callModel({
        profile: request.modelProfile,
        messages: context.messages,
        tools: toolDefinitions.filter((tool) => skill.requiredTools.includes(tool.name) && !completedTools.includes(tool.name)),
        skill,
        completedTools,
        files: request.files ?? []
      });
      const missingRequired = skill.requiredTools.find((tool) => !completedTools.includes(tool));
      if (missingRequired && !response.toolCalls.some((call) => call.name === missingRequired)) {
        response = {
          ...response,
          content: `${response.content}\nRuntime policy requires ${missingRequired}.`,
          toolCalls: [{ id: `call_${randomUUID()}`, name: missingRequired, arguments: deterministicToolArguments(missingRequired, skill, request.files ?? []) }]
        };
      }
      promptTokens += response.usage.promptTokens;
      completionTokens += response.usage.completionTokens;
      await emit('llm.call', {
        name: `llm.call #${iteration + 1}`,
        llmCallId: `llm_${randomUUID()}`,
        model: response.model,
        provider: response.provider,
        temperature: request.modelProfile.temperature ?? 0.2,
        maxOutputTokens: request.modelProfile.maxOutputTokens ?? 2048,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        cost: response.usage.promptTokens / 1_000_000 * Number(request.modelProfile.inputPricePer1MTokens ?? 0)
          + response.usage.completionTokens / 1_000_000 * Number(request.modelProfile.outputPricePer1MTokens ?? 0),
        currency: request.modelProfile.currency ?? 'USD',
        latencyMs: response.latencyMs,
        contextSnapshotId: context.id,
        output: { type: response.toolCalls.length ? 'tool_call' : 'text', content: response.content, toolCalls: response.toolCalls }
      }, { spanId: llmSpanId, parentSpanId: contextSpanId });

      if (response.toolCalls.length === 0) {
        output = response.content;
        break;
      }
      for (const requestedCall of response.toolCalls.slice(0, 3)) {
        const call = await executeRequestedTool(requestedCall, skill, request, ids, toolResults, emit, llmSpanId);
        toolCalls.push(call);
        if (call.success && !completedTools.includes(call.name)) completedTools.push(call.name);
        const artifact = call.success && canProduceArtifact(skill, call.name) ? await detectArtifact(skill, request.workspacePath) : undefined;
        if (artifact && !artifacts.some((item) => item.path === artifact.path)) {
          artifacts.push(artifact);
          await emit('artifact.write', { name: `artifact.write: ${artifact.path}`, artifacts: [artifact] }, { spanId: `span_${randomUUID()}`, parentSpanId: call.id });
        }
      }
    }

    if (!output) {
      const missing = skill.requiredTools.filter((tool) => !completedTools.includes(tool));
      if (missing.length) throw new Error(`Agent Loop 达到最大轮次，未完成工具: ${missing.join(', ')}`);
      output = `Runtime completed ${skill.name}.`;
    }
    await emit('turn.end', { status: 'success', assistantMessage: output });
    await emit('run.end', {
      status: 'success',
      latencyMs: Date.now() - startedAt,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      toolCallCount: toolCalls.length,
      artifactCount: artifacts.length,
      finalOutput: output
    });
    return { ids, status: 'success', output, artifacts, toolCalls, events };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit('error', { name: 'runtime.error', status: 'failed', error: message }, { spanId: `span_${randomUUID()}` });
    await emit('turn.end', { status: 'failed', assistantMessage: message });
    await emit('run.end', { status: 'failed', latencyMs: Date.now() - startedAt, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, error: message, finalOutput: output });
    return { ids, status: 'failed', output, artifacts, toolCalls, events, error: message };
  }
}

function canProduceArtifact(skill: SkillDefinition, toolName: string) {
  return skill.id === 'excel-data-analysis' ? toolName === 'python.run' : toolName === 'filesystem.write';
}

async function executeRequestedTool(
  requestedCall: ModelToolCall,
  skill: SkillDefinition,
  request: RuntimeRequest,
  ids: RuntimeIds,
  toolResults: Array<{ name: string; result: unknown }>,
  emit: (eventType: string, payload: Record<string, unknown>, extra?: Partial<TraceEvent>) => Promise<TraceEvent>,
  parentSpanId: string
) {
  const definition = toolDefinitions.find((tool) => tool.name === requestedCall.name);
  if (!definition || !skill.requiredTools.includes(requestedCall.name)) throw new Error(`Skill ${skill.id} 未授权工具 ${requestedCall.name}`);
  const args = await prepareToolArguments(requestedCall, skill, toolResults);
  const startedAt = performance.now();
  let result: unknown;
  let success = true;
  let error: string | undefined;
  try {
    result = await executeTool(requestedCall.name, args, { workspacePath: request.workspacePath, runId: ids.runId });
    toolResults.push({ name: requestedCall.name, result });
  } catch (caught) {
    success = false;
    error = caught instanceof Error ? caught.message : String(caught);
    result = { error };
  }
  const latencyMs = Math.round(performance.now() - startedAt);
  const spanId = `span_${randomUUID()}`;
  await emit('tool.call', {
    name: `tool.call: ${requestedCall.name}`,
    toolCallId: requestedCall.id,
    tool: requestedCall.name,
    reason: `Skill ${skill.id} requires ${requestedCall.name}`,
    arguments: args,
    permission: { required: [definition.permission], approved: true, approvalMode: 'runtime-policy' },
    execution: { latencyMs, success, exitCode: success ? 0 : 1 },
    result,
    error,
    contextInjection: { includedInNextLLMCall: true, tokens: Math.ceil(JSON.stringify(result).length / 3.2), summaryUsed: false }
  }, { spanId, parentSpanId });
  return { id: spanId, name: requestedCall.name, arguments: args, result, success };
}

async function prepareToolArguments(call: ModelToolCall, skill: SkillDefinition, toolResults: Array<{ name: string; result: unknown }>) {
  if (skill.id === 'excel-data-analysis' && call.name === 'filesystem.write') {
    const inspection = toolResults.find((item) => item.name === 'xlsx.inspect')?.result ?? {};
    return { path: '.jarvis-runtime/prepare-analysis.py', content: excelAnalysisScript(inspection) };
  }
  return call.arguments;
}

function excelAnalysisScript(inspection: unknown) {
  const data = JSON.stringify(inspection).replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'");
  return `import json, os\nDATA = json.loads(r'''${data}''')\nos.makedirs('output', exist_ok=True)\nsheets = DATA.get('sheets', [])\nlines = ['# Excel 数据分析报告', '', '## 数据概况']\nfor sheet in sheets:\n    lines.append(f\"- {sheet.get('name')}: {sheet.get('rows')} 行，{sheet.get('columns')} 列\")\n    lines.append(f\"- 字段: {', '.join(sheet.get('headers', []))}\")\nlines += ['', '## 异常发现']\nfor sheet in sheets:\n    missing = sheet.get('missingValues', {})\n    bad = [f\"{k} 缺失 {v}\" for k, v in missing.items() if v]\n    lines.append(f\"- {sheet.get('name')}: \" + ('；'.join(bad) if bad else '未发现缺失值'))\n    for field, stats in sheet.get('numericSummary', {}).items():\n        lines.append(f\"- {field}: 最小值 {stats.get('min')}，最大值 {stats.get('max')}，平均值 {stats.get('avg')}\")\nlines += ['', '## 营销建议', '- 优先核验异常值和高价值客户记录。', '- 按指标区间分层触达，并跟踪转化结果。', '', '## 方法说明', '- 本报告基于 xlsx.inspect 的真实工作簿结构和统计结果生成。']\nwith open('output/analysis_report.md', 'w', encoding='utf-8') as f:\n    f.write('\\n'.join(lines))\nprint(json.dumps({'report': 'output/analysis_report.md', 'sheets': len(sheets)}, ensure_ascii=False))\n`;
}

async function detectArtifact(skill: SkillDefinition, workspacePath: string) {
  if (!skill.outputFile) return undefined;
  const path = resolve(workspacePath, skill.outputFile);
  try {
    const info = await stat(path);
    const type = path.endsWith('.md') ? 'markdown' : path.split('.').at(-1) ?? 'file';
    return { id: `artifact_${randomUUID()}`, type, path: relative(workspacePath, path), sizeBytes: info.size };
  } catch {
    return undefined;
  }
}

export async function readRuntimeArtifact(workspacePath: string, path: string) {
  return readFile(resolve(workspacePath, path), 'utf8');
}
