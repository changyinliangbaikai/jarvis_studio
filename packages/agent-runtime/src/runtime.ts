import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { buildContext } from '@jarvis/context-builder';
import { callModel, deterministicToolArguments } from '@jarvis/model-gateway';
import { defaultPolicyVersion, evaluateToolPolicy, summarizeArguments } from '@jarvis/permission-engine';
import type { ModelToolCall, RuntimeApprovalRequest, RuntimeApprovalResult, RuntimeIds, RuntimeRequest, RuntimeResult, RuntimeRunOptions, SkillDefinition } from '@jarvis/shared-types';
import { explainSkillSelection, listSkills } from '@jarvis/skill-loader';
import { executeTool, toolDefinitions } from '@jarvis/tool-registry';
import type { TraceEvent } from '@jarvis/trace-sdk';

export function createRuntimeIds(): RuntimeIds {
  return {
    projectId: 'jarvis-studio-local',
    sessionId: `session_${randomUUID()}`,
    turnId: `turn_${randomUUID()}`,
    runId: `runtime_${randomUUID()}`
  };
}

export type { RuntimeRunOptions } from '@jarvis/shared-types';

export async function runAgent(request: RuntimeRequest, options: RuntimeRunOptions = {}): Promise<RuntimeResult> {
  const ids = options.ids ?? createRuntimeIds();
  const registry = listSkills();
  const selection = explainSkillSelection(request.message, request.skill, request.files ?? []);
  const skill = selection.skill;
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
      toolSchemaVersion: 'jarvis-runtime-tools@v0.5',
      runtimeVersion: 'agent-runtime@0.5.0',
      contextStrategyVersion: request.contextStrategy ?? 'balanced-v1',
      policyVersion: request.policyVersion ?? defaultPolicyVersion,
      workspacePath: request.workspacePath
    });
    await emit('turn.start', { index: 1, userMessage: request.message, files: request.files ?? [] });
    await emit('skill.registry.loaded', {
      name: 'skill.registry.loaded',
      skills: registry.length,
      skillIds: registry.map((item) => item.id),
      registryVersion: 'skill-registry@0.5.0'
    }, { spanId: `span_${randomUUID()}` });
    await emit('skill.select', {
      name: `skill.select: ${skill.id}`,
      selectedSkillId: skill.id,
      selected_skill_id: skill.id,
      selected: `${skill.id}@${skill.version}`,
      reason: request.skill ? '用户显式选择' : '基于消息与文件类型自动选择',
      candidates: selection.candidates,
      conflict: selection.candidates.filter((candidate) => candidate.status !== 'disabled' && candidate.score >= 0.7).length > 1,
      injectedPromptPreview: `${skill.systemPrompt}\n\n${skill.instructions}`.slice(0, 1200),
      requiredTools: skill.requiredTools,
      permissions: skill.permissions
    }, { spanId: `span_${randomUUID()}` });

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const context = buildContext({
        skill,
        message: request.message,
        history: request.history ?? [],
        tools: toolDefinitions.filter((tool) => skill.requiredTools.includes(tool.name)),
        toolResults,
        strategy: request.contextStrategy ?? 'balanced-v1'
      });
      const contextSpanId = `span_${randomUUID()}`;
      await emit('context.build', {
        name: `context.build #${iteration + 1}`,
        contextSnapshotId: context.id,
        budgetStrategy: context.budgetStrategy,
        reservedOutputTokens: context.reservedOutputTokens,
        totalTokensBeforeBudget: context.totalTokensBeforeBudget,
        totalTokensAfterBudget: context.totalTokensAfterBudget,
        totalTokens: context.totalTokens,
        maxContextTokens: context.maxContextTokens,
        truncated: context.truncated,
        compressed: context.compressed,
        risks: context.risks,
        finalPrompt: context.finalPrompt,
        segments: context.segments
      }, { spanId: contextSpanId });
      await emit('context.budget.apply', {
        name: `context.budget.apply: ${context.budgetStrategy}`,
        contextSnapshotId: context.id,
        strategy: context.budgetStrategy,
        beforeTokens: context.totalTokensBeforeBudget,
        before_tokens: context.totalTokensBeforeBudget,
        afterTokens: context.totalTokensAfterBudget,
        after_tokens: context.totalTokensAfterBudget,
        maxContextTokens: context.maxContextTokens,
        reservedOutputTokens: context.reservedOutputTokens,
        compressionRate: context.totalTokensBeforeBudget ? Number((1 - context.totalTokensAfterBudget / context.totalTokensBeforeBudget).toFixed(4)) : 0,
        risks: context.risks
      }, { spanId: `span_${randomUUID()}`, parentSpanId: contextSpanId });
      for (const segment of context.segments) {
        await emit('context.segment', {
          name: `context.segment: ${segment.type}`,
          contextSnapshotId: context.id,
          segmentId: segment.id,
          segment_id: segment.id,
          type: segment.type,
          action: segment.action,
          priority: segment.priority,
          tokensBefore: segment.tokensBefore,
          tokens_before: segment.tokensBefore,
          tokensAfter: segment.tokensAfter,
          tokens_after: segment.tokensAfter,
          included: segment.included,
          reason: segment.reason
        }, { spanId: `span_${randomUUID()}`, parentSpanId: contextSpanId });
      }

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
        const call = await executeRequestedTool(requestedCall, skill, request, ids, toolResults, emit, llmSpanId, options.waitForApproval);
        toolCalls.push(call);
        if (call.success && !completedTools.includes(call.name)) completedTools.push(call.name);
        const artifact = call.success && canProduceArtifact(skill, call.name) ? await detectArtifact(skill, request.workspacePath, call) : undefined;
        if (artifact && !artifacts.some((item) => item.path === artifact.path)) {
          artifacts.push(artifact);
          await emit('artifact.write', { name: `artifact.write: ${artifact.path}`, artifacts: [artifact] }, { spanId: `span_${randomUUID()}`, parentSpanId: call.spanId ?? call.id });
        }
      }
    }

    if (!output) {
      const missing = skill.requiredTools.filter((tool) => !completedTools.includes(tool));
      if (missing.length) throw new Error(`Agent Loop 达到最大轮次，未完成工具: ${missing.join(', ')}`);
      output = `Runtime completed ${skill.name}.`;
    }
    await emit('turn.end', { status: 'success', assistantMessage: output });
    await emit('replay.snapshot.created', createReplaySnapshotPayload(ids.runId, request, skill), { spanId: `span_${randomUUID()}` });
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
    await emit('failure.detected', {
      name: 'failure.detected: runtime.error',
      failureType: classifyFailureFromError(message),
      failure_type: classifyFailureFromError(message),
      severity: /permission|拒绝|审批/i.test(message) ? 'high' : 'medium',
      summary: message,
      evidence: [{ message }],
      suggestedFix: suggestedFixFor(message),
      status: 'open'
    }, { spanId: `span_${randomUUID()}` });
    await emit('error', { name: 'runtime.error', status: 'failed', error: message }, { spanId: `span_${randomUUID()}` });
    await emit('turn.end', { status: 'failed', assistantMessage: message });
    await emit('replay.snapshot.created', createReplaySnapshotPayload(ids.runId, request, skill), { spanId: `span_${randomUUID()}` });
    await emit('run.end', { status: 'failed', latencyMs: Date.now() - startedAt, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, error: message, finalOutput: output });
    return { ids, status: 'failed', output, artifacts, toolCalls, events, error: message };
  }
}

function canProduceArtifact(skill: SkillDefinition, toolName: string) {
  return skill.id === 'excel-data-analysis' ? toolName === 'python.run' : ['filesystem.write', 'docx.write'].includes(toolName);
}

async function executeRequestedTool(
  requestedCall: ModelToolCall,
  skill: SkillDefinition,
  request: RuntimeRequest,
  ids: RuntimeIds,
  toolResults: Array<{ name: string; result: unknown }>,
  emit: (eventType: string, payload: Record<string, unknown>, extra?: Partial<TraceEvent>) => Promise<TraceEvent>,
  parentSpanId: string,
  waitForApproval?: (request: RuntimeApprovalRequest) => Promise<RuntimeApprovalResult>
) {
  const definition = toolDefinitions.find((tool) => tool.name === requestedCall.name);
  if (!definition || !skill.requiredTools.includes(requestedCall.name)) throw new Error(`Skill ${skill.id} 未授权工具 ${requestedCall.name}`);
  let args = await prepareToolArguments(requestedCall, skill, toolResults);
  let permissionDecision = evaluateToolPolicy({
    tool: definition,
    skill,
    args,
    toolCallId: requestedCall.id,
    policyVersion: request.policyVersion
  });
  if (permissionDecision.decision === 'approve' && (request.approvedTools ?? []).includes(requestedCall.name)) {
    permissionDecision = {
      ...permissionDecision,
      decision: 'allow',
      reason: `人工审批已通过，允许恢复执行工具 ${requestedCall.name}。`,
      policyId: `${permissionDecision.policyId}:approved-runtime-resume`
    };
  }
  await emit('tool.policy.check', {
    name: `tool.policy.check: ${requestedCall.name}`,
    ...permissionDecision,
    decisionId: permissionDecision.decisionId,
    decision_id: permissionDecision.decisionId,
    toolCallId: requestedCall.id,
    tool_call_id: requestedCall.id,
    toolId: requestedCall.name,
    tool_id: requestedCall.name,
    workspaceId: request.workspaceId,
    workspace_id: request.workspaceId,
    taskId: request.taskId,
    task_id: request.taskId,
    requestedPermissions: permissionDecision.requestedPermissions,
    requested_permissions: permissionDecision.requestedPermissions,
    argumentsSummary: summarizeArguments(args),
    status: permissionDecision.decision === 'deny' ? 'denied' : permissionDecision.decision
  }, { spanId: `span_${randomUUID()}`, parentSpanId });
  if (permissionDecision.decision === 'approve' && waitForApproval) {
    const approvalId = permissionDecision.decisionId;
    await emit('run.pause_for_approval', {
      name: `run.pause_for_approval: ${requestedCall.name}`,
      approvalId,
      approval_id: approvalId,
      decisionId: permissionDecision.decisionId,
      decision_id: permissionDecision.decisionId,
      toolCallId: requestedCall.id,
      tool_call_id: requestedCall.id,
      toolId: requestedCall.name,
      tool_id: requestedCall.name,
      workspaceId: request.workspaceId,
      workspace_id: request.workspaceId,
      taskId: request.taskId,
      task_id: request.taskId,
      riskLevel: permissionDecision.riskLevel,
      reason: permissionDecision.reason,
      argumentsSummary: summarizeArguments(args),
      status: 'waiting_approval'
    }, { spanId: `span_${randomUUID()}`, parentSpanId });
    const approval = await waitForApproval({
      approvalId,
      decisionId: permissionDecision.decisionId,
      toolCallId: requestedCall.id,
      toolId: requestedCall.name,
      riskLevel: permissionDecision.riskLevel,
      reason: permissionDecision.reason,
      requestedPermissions: permissionDecision.requestedPermissions,
      argumentsSummary: summarizeArguments(args),
      args,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      runId: ids.runId
    });
    if (approval.decision === 'rejected') {
      // approval.rejected: 协议标准事件（计划 Section 4.1）
      await emit('approval.rejected', {
        name: `approval.rejected: ${requestedCall.name}`,
        approvalId,
        approval_id: approvalId,
        toolCallId: requestedCall.id,
        tool_call_id: requestedCall.id,
        toolId: requestedCall.name,
        tool_id: requestedCall.name,
        decision: 'rejected',
        note: approval.note,
        status: 'rejected'
      }, { spanId: `span_${randomUUID()}`, parentSpanId });
      // run.stop_after_rejection: 保留为工程内部事件，向前兼容
      await emit('run.stop_after_rejection', {
        name: `run.stop_after_rejection: ${requestedCall.name}`,
        approvalId,
        approval_id: approvalId,
        toolCallId: requestedCall.id,
        tool_call_id: requestedCall.id,
        toolId: requestedCall.name,
        tool_id: requestedCall.name,
        note: approval.note,
        status: 'rejected'
      }, { spanId: `span_${randomUUID()}`, parentSpanId });
      throw new Error(`工具 ${requestedCall.name} 的人工审批已拒绝`);
    }
    if (approval.args && typeof approval.args === 'object') args = approval.args;
    permissionDecision = {
      ...permissionDecision,
      decision: 'allow',
      reason: approval.decision === 'approved_with_changes'
        ? `人工审批带修改通过，允许执行工具 ${requestedCall.name}。`
        : `人工审批已通过，允许执行工具 ${requestedCall.name}。`,
      policyId: `${permissionDecision.policyId}:approved-runtime-resume`
    };
    // approval.approved: 协议标准事件（计划 Section 4.1）
    await emit('approval.approved', {
      name: `approval.approved: ${requestedCall.name}`,
      approvalId,
      approval_id: approvalId,
      toolCallId: requestedCall.id,
      tool_call_id: requestedCall.id,
      toolId: requestedCall.name,
      tool_id: requestedCall.name,
      decision: approval.decision,
      note: approval.note,
      status: 'approved'
    }, { spanId: `span_${randomUUID()}`, parentSpanId });
    await emit('run.resume_after_approval', {
      name: `run.resume_after_approval: ${requestedCall.name}`,
      approvalId,
      approval_id: approvalId,
      toolCallId: requestedCall.id,
      tool_call_id: requestedCall.id,
      toolId: requestedCall.name,
      tool_id: requestedCall.name,
      decision: approval.decision,
      note: approval.note,
      status: 'running'
    }, { spanId: `span_${randomUUID()}`, parentSpanId });
  }
  if (permissionDecision.decision !== 'allow') {
    const summary = permissionDecision.decision === 'approve'
      ? `工具 ${requestedCall.name} 需要人工审批`
      : `工具 ${requestedCall.name} 被权限策略拒绝`;
    await emit('failure.detected', {
      name: `failure.detected: ${requestedCall.name}`,
      failureType: 'permission_denied',
      failure_type: 'permission_denied',
      severity: permissionDecision.decision === 'deny' ? 'critical' : 'high',
      summary,
      evidence: [{ toolCallId: requestedCall.id, decision: permissionDecision }],
      suggestedFix: '调整 Skill 权限声明、Tool 风险策略，或在 Approvals 页面处理该工具调用。',
      status: 'open',
      toolId: requestedCall.name
    }, { spanId: `span_${randomUUID()}`, parentSpanId });
    throw new Error(`${summary}: ${permissionDecision.reason}`);
  }
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
    await emit('failure.detected', {
      name: `failure.detected: ${requestedCall.name}`,
      failureType: 'tool_execution_error',
      failure_type: 'tool_execution_error',
      severity: 'high',
      summary: error,
      evidence: [{ toolCallId: requestedCall.id, toolId: requestedCall.name, message: error }],
      suggestedFix: '检查工具参数、workspace 文件路径和运行沙箱输出。',
      status: 'open',
      toolId: requestedCall.name
    }, { spanId: `span_${randomUUID()}`, parentSpanId });
  }
  const latencyMs = Math.round(performance.now() - startedAt);
  const spanId = `span_${randomUUID()}`;
  await emit('tool.call', {
    name: `tool.call: ${requestedCall.name}`,
    toolCallId: requestedCall.id,
    tool: requestedCall.name,
    reason: `Skill ${skill.id} requires ${requestedCall.name}`,
    arguments: args,
    permission: { required: [definition.permission], approved: true, approvalMode: 'runtime-policy', decision: permissionDecision },
    execution: { latencyMs, success, exitCode: success ? 0 : 1 },
    result,
    error,
    contextInjection: { includedInNextLLMCall: true, tokens: Math.ceil(JSON.stringify(result).length / 3.2), summaryUsed: false }
  }, { spanId, parentSpanId });
  return { id: requestedCall.id, spanId, name: requestedCall.name, arguments: args, result, success };
}

function createReplaySnapshotPayload(runId: string, request: RuntimeRequest, skill: SkillDefinition) {
  const snapshotId = `snap_${randomUUID()}`;
  return {
    name: `replay.snapshot.created: ${runId}`,
    snapshotId,
    snapshot_id: snapshotId,
    runId,
    snapshot: {
      input: {
        userMessage: request.message,
        user_message: request.message,
        files: (request.files ?? []).map((path) => ({ originalPath: path, original_path: path }))
      },
      versions: {
        promptVersion: request.promptVersion ?? `${skill.id}@${skill.version}`,
        prompt_version: request.promptVersion ?? `${skill.id}@${skill.version}`,
        skillVersion: `${skill.id}@${skill.version}`,
        skill_version: `${skill.id}@${skill.version}`,
        toolVersions: Object.fromEntries(toolDefinitions.filter((tool) => skill.requiredTools.includes(tool.name)).map((tool) => [tool.name, tool.version ?? '0.4.0'])),
        tool_versions: Object.fromEntries(toolDefinitions.filter((tool) => skill.requiredTools.includes(tool.name)).map((tool) => [tool.name, tool.version ?? '0.4.0'])),
        runtimeVersion: 'agent-runtime@0.5.0',
        runtime_version: 'agent-runtime@0.5.0',
        contextStrategy: request.contextStrategy ?? 'balanced-v1',
        context_strategy: request.contextStrategy ?? 'balanced-v1',
        policyVersion: request.policyVersion ?? defaultPolicyVersion,
        policy_version: request.policyVersion ?? defaultPolicyVersion
      },
      modelConfig: {
        provider: request.modelProfile.provider,
        model: request.modelProfile.model,
        baseUrl: request.modelProfile.baseUrl,
        temperature: request.modelProfile.temperature ?? 0.2,
        maxTokens: request.modelProfile.maxOutputTokens ?? 2048
      }
    }
  };
}

function classifyFailureFromError(message: string) {
  if (/timeout/i.test(message)) return 'timeout';
  if (/permission|拒绝|审批/i.test(message)) return 'permission_denied';
  if (/tool|工具/i.test(message)) return 'tool_execution_error';
  if (/context|上下文/i.test(message)) return 'context_overflow';
  return 'model_reasoning_error';
}

function suggestedFixFor(message: string) {
  if (/permission|拒绝|审批/i.test(message)) return '检查 Tool Registry 风险等级、Skill 权限声明和审批策略。';
  if (/timeout/i.test(message)) return '降低并发、缩短上下文或调高模型服务超时时间。';
  return '查看 Trace、Context Budget 和 Tool 调用证据后定位 Prompt、Skill、Tool 或模型配置。';
}

async function prepareToolArguments(call: ModelToolCall, skill: SkillDefinition, toolResults: Array<{ name: string; result: unknown }>) {
  if (skill.id === 'excel-data-analysis' && call.name === 'filesystem.write') {
    const inspection = toolResults.find((item) => item.name === 'xlsx.inspect')?.result ?? {};
    return { path: '.jarvis-runtime/prepare-analysis.py', content: excelAnalysisScript(inspection) };
  }
  if (skill.id === 'weekly-report' && call.name === 'filesystem.write') {
    const read = toolResults.find((item) => item.name === 'filesystem.read')?.result;
    return { path: skill.outputFile ?? 'output/weekly_report.md', content: weeklyReportFromInput(read) };
  }
  if (skill.id === 'weekly-report' && call.name === 'docx.write') {
    const read = toolResults.find((item) => item.name === 'filesystem.read')?.result;
    return { path: 'output/weekly_report.docx', content: weeklyReportFromInput(read) };
  }
  if (skill.id === 'code-review' && call.name === 'filesystem.write') {
    const status = toolResults.find((item) => item.name === 'git.status')?.result;
    const diff = toolResults.find((item) => item.name === 'git.diff')?.result;
    return { path: skill.outputFile ?? 'output/code_review.md', content: codeReviewFromGit(status, diff) };
  }
  return call.arguments;
}

function toolContent(value: unknown, key: string) {
  return value && typeof value === 'object' && typeof (value as Record<string, unknown>)[key] === 'string'
    ? String((value as Record<string, unknown>)[key])
    : '';
}

function weeklyReportFromInput(readResult: unknown) {
  const source = toolContent(readResult, 'content').trim();
  const bullets = source.split(/\r?\n/).map((line) => line.replace(/^[-*\s]+/, '').trim()).filter(Boolean).slice(0, 8);
  return [
    '# 周报',
    '',
    '## 本周完成',
    ...(bullets.length ? bullets.slice(0, 4).map((line) => `- ${line}`) : ['- 已根据输入材料整理本周进展。']),
    '',
    '## 问题与风险',
    ...(bullets.filter((line) => /风险|问题|阻塞|延期|待确认/.test(line)).map((line) => `- ${line}`) || []),
    bullets.some((line) => /风险|问题|阻塞|延期|待确认/.test(line)) ? '' : '- 未在输入材料中发现明确风险，需持续跟踪关键依赖。',
    '',
    '## 下周计划',
    ...(bullets.filter((line) => /下周|计划|推进|完成/.test(line)).slice(0, 4).map((line) => `- ${line}`) || []),
    bullets.some((line) => /下周|计划|推进|完成/.test(line)) ? '' : '- 继续推进重点任务，补齐待确认事项并同步结果。',
    '',
    '## 输入依据',
    `- 来源文件摘要长度：${source.length} 字符。`
  ].filter((line) => line !== '').join('\n');
}

function codeReviewFromGit(statusResult: unknown, diffResult: unknown) {
  const status = toolContent(statusResult, 'stdout').trim() || '工作区无状态输出。';
  const diff = toolContent(diffResult, 'stdout').trim();
  const hasDiff = Boolean(diff);
  return [
    '# Code Review',
    '',
    '## Findings',
    hasDiff
      ? '- [P1] 检测到工作区存在代码差异，合并前需要结合业务语义确认行为变化并补充覆盖测试。'
      : '- 未发现工作区 diff。当前审查没有可定位的代码变更风险。',
    '',
    '## Evidence',
    '### git status',
    '```text',
    status,
    '```',
    '',
    '### git diff 摘要',
    '```diff',
    hasDiff ? diff.slice(0, 6000) : 'no diff',
    '```',
    '',
    '## Test Suggestions',
    '- 针对变更路径补充边界条件测试。',
    '- 对涉及文件写入、权限和运行状态的变更增加回归用例。',
    '',
    '## Summary',
    hasDiff ? '已基于 git.status 和 git.diff 完成审查。' : '已完成空 diff 审查。'
  ].join('\n');
}

function excelAnalysisScript(inspection: unknown) {
  const data = JSON.stringify(inspection).replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'");
  return [
    'import json, os',
    `DATA = json.loads(r'''${data}''')`,
    "os.makedirs('output', exist_ok=True)",
    "sheets = DATA.get('sheets', [])",
    "lines = ['# Excel 数据分析报告', '', '## 数据概况']",
    'for sheet in sheets:',
    '    lines.append(f"- {sheet.get(\'name\')}: {sheet.get(\'rows\')} 行，{sheet.get(\'columns\')} 列")',
    '    lines.append(f"- 字段: {\', \'.join(sheet.get(\'headers\', []))}")',
    "lines += ['', '## 关键发现']",
    'for sheet in sheets:',
    "    for field, stats in sheet.get('numericSummary', {}).items():",
    '        lines.append(f"- {field}: 最小值 {stats.get(\'min\')}，最大值 {stats.get(\'max\')}，平均值 {stats.get(\'avg\')}")',
    "lines += ['', '## 异常点 / 异常发现']",
    'for sheet in sheets:',
    "    missing = sheet.get('missingValues', {})",
    '    bad = [f"{k} 缺失 {v}" for k, v in missing.items() if v]',
    '    lines.append(f"- {sheet.get(\'name\')}: " + ("；".join(bad) if bad else "未发现缺失值"))',
    "lines += ['', '## 建议', '- 优先核验异常值和高价值客户记录。', '- 按指标区间分层触达，并跟踪转化结果。', '', '## 方法说明', '- 本报告基于 xlsx.inspect 的真实工作簿结构和统计结果生成。']",
    "with open('output/analysis_report.md', 'w', encoding='utf-8') as f:",
    "    f.write('\\n'.join(lines))",
    "print(json.dumps({'report': 'output/analysis_report.md', 'sheets': len(sheets)}, ensure_ascii=False))",
    ''
  ].join('\n');
}

async function detectArtifact(skill: SkillDefinition, workspacePath: string, call: RuntimeResult['toolCalls'][number]) {
  const resultPath = call.result && typeof call.result === 'object' && typeof (call.result as Record<string, unknown>).path === 'string'
    ? String((call.result as Record<string, unknown>).path)
    : undefined;
  const artifactPath = resultPath ?? skill.outputFile;
  if (!artifactPath) return undefined;
  const path = resolve(workspacePath, artifactPath);
  try {
    const info = await stat(path);
    const type = path.endsWith('.md') ? 'markdown' : path.split('.').at(-1) ?? 'file';
    return { id: `artifact_${randomUUID()}`, type, path: relative(workspacePath, path), sizeBytes: info.size, toolCallId: call.id };
  } catch {
    return undefined;
  }
}

export async function readRuntimeArtifact(workspacePath: string, path: string) {
  return readFile(resolve(workspacePath, path), 'utf8');
}
