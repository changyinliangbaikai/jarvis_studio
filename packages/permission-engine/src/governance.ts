import { randomUUID } from 'node:crypto';
import type { PermissionDecision, SkillDefinition, ToolDefinition } from '@jarvis/shared-types';

export const defaultPolicyVersion = 'default-local-policy@0.4.0';

export function evaluateToolPolicy(input: {
  tool: ToolDefinition;
  skill: SkillDefinition;
  args: Record<string, unknown>;
  toolCallId: string;
  policyVersion?: string;
}): PermissionDecision {
  const riskLevel = input.tool.riskLevel ?? 'medium';
  const requestedPermissions = [...new Set([input.tool.permission, ...flattenPermissions(input.tool.permissions)])];
  const policyId = input.policyVersion ?? defaultPolicyVersion;
  const allowedBySkill = input.skill.requiredTools.includes(input.tool.name)
    && input.skill.permissions.includes(input.tool.permission);

  if (!allowedBySkill) {
    return decision(input, riskLevel, requestedPermissions, 'deny', `Skill ${input.skill.id} 未声明工具 ${input.tool.name} 或权限 ${input.tool.permission}`, 'skill-permission-contract', policyId);
  }
  if (riskLevel === 'critical') {
    return decision(input, riskLevel, requestedPermissions, 'deny', 'critical 风险工具默认拒绝，需要显式人工放行策略。', 'deny-critical-by-default', policyId);
  }
  if (riskLevel === 'high') {
    return decision(input, riskLevel, requestedPermissions, 'approve', 'high 风险工具需要人工审批。', 'approve-high-risk', policyId);
  }
  if (riskLevel === 'low') {
    return decision(input, riskLevel, requestedPermissions, 'allow', 'low 风险只读工具自动允许。', 'allow-low-risk-readonly', policyId);
  }
  if (input.tool.name === 'python.run' && Boolean(input.tool.runtime?.sandbox)) {
    return decision(input, riskLevel, requestedPermissions, 'allow', 'python.run 在固定解释器和 workspace 沙箱中执行。', 'allow-medium-sandbox-python', policyId);
  }
  if (input.tool.name === 'filesystem.write') {
    const scope = pathScope(input.args.path);
    if (scope === 'workspace/output' || scope === 'workspace/.jarvis-runtime') {
      return decision(input, riskLevel, requestedPermissions, 'allow', `写入范围限制在 ${scope}。`, 'allow-medium-owned-output', policyId);
    }
    return decision(input, riskLevel, requestedPermissions, 'approve', `写入路径 ${String(input.args.path ?? '') || 'unknown'} 不在默认输出范围。`, 'approve-medium-write-outside-output', policyId);
  }
  return decision(input, riskLevel, requestedPermissions, input.tool.defaultPolicy ?? 'approve', `匹配工具默认策略 ${input.tool.defaultPolicy ?? 'approve'}。`, 'tool-default-policy', policyId);
}

export function summarizeArguments(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (typeof item === 'string') return [key, item.length > 180 ? `${item.slice(0, 180)}...` : item];
    if (Array.isArray(item)) return [key, item.slice(0, 8)];
    if (item && typeof item === 'object') return [key, '[object]'];
    return [key, item];
  }));
}

function decision(
  input: { tool: ToolDefinition; toolCallId: string },
  riskLevel: PermissionDecision['riskLevel'],
  requestedPermissions: string[],
  result: PermissionDecision['decision'],
  reason: string,
  matchedRule: string,
  policyId: string
): PermissionDecision {
  return {
    decisionId: `perm_${randomUUID()}`,
    toolCallId: input.toolCallId,
    toolId: input.tool.name,
    riskLevel,
    requestedPermissions,
    decision: result,
    reason,
    policyId: `${policyId}:${matchedRule}`
  };
}

function flattenPermissions(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const out: string[] = [];
  const walk = (prefix: string, item: unknown) => {
    if (Array.isArray(item)) {
      for (const entry of item) out.push(`${prefix}:${String(entry)}`);
      return;
    }
    if (item && typeof item === 'object') {
      for (const [key, nested] of Object.entries(item)) walk(prefix ? `${prefix}.${key}` : key, nested);
      return;
    }
    out.push(prefix);
  };
  walk('', value);
  return out.filter(Boolean);
}

function pathScope(path: unknown) {
  if (typeof path !== 'string') return 'workspace/unknown';
  const clean = path.replace(/^\.?\//, '');
  if (clean.startsWith('output/')) return 'workspace/output';
  if (clean.startsWith('.jarvis-runtime/')) return 'workspace/.jarvis-runtime';
  return 'workspace/other';
}
