import type { EvalCase } from './evalCase.ts';

export const issueTags = [
  'skill_selection_error', 'tool_missing', 'tool_wrong', 'tool_error', 'tool_timeout',
  'model_error', 'model_timeout', 'context_overflow', 'context_missing', 'context_pollution',
  'hallucinated_field', 'hallucinated_fact', 'format_error', 'artifact_missing',
  'artifact_invalid', 'permission_denied', 'unsafe_action', 'incomplete_answer',
  'low_quality', 'unknown'
] as const;

export interface RuleScoringInput {
  output: string;
  selectedSkills?: string[];
  toolNames: string[];
  failedToolNames?: string[];
  artifacts: Array<{ type: string; path: string }>;
  latencyMs?: number;
  permissionDeniedCount?: number;
}

export interface RuleCheck {
  checkId: string;
  label: string;
  passed: boolean;
  score: number;
  reason: string;
  issueTag?: string;
}

export interface RuleScore {
  score: number;
  pass: boolean;
  checks: RuleCheck[];
  reason: string;
  issueTags: string[];
  metrics: {
    toolCorrectnessRate: number;
    artifactSuccessRate: number;
    forbiddenToolCallCount: number;
    permissionDeniedCount: number;
  };
}

function check(checkId: string, label: string, passed: boolean, reason: string, issueTag?: string): RuleCheck {
  return { checkId, label, passed, score: passed ? 1 : 0, reason, issueTag: passed ? undefined : issueTag };
}

export function scoreRules(evalCase: EvalCase, input: RuleScoringInput): RuleScore {
  const checks: RuleCheck[] = [];
  for (const skill of evalCase.expected.mustSelectSkill) {
    const passed = (input.selectedSkills ?? []).some((selected) => selected.replace(/@.*$/, '') === skill.replace(/@.*$/, ''));
    checks.push(check('must_select_skill', `选择 Skill ${skill}`, passed, passed ? `已选择 ${skill}` : `未选择 ${skill}`, 'skill_selection_error'));
  }
  for (const tool of evalCase.expected.mustCallTools) {
    const passed = input.toolNames.includes(tool);
    checks.push(check('must_call_tools', `调用工具 ${tool}`, passed, passed ? `已调用 ${tool}` : `缺少工具调用 ${tool}`, 'tool_missing'));
  }
  for (const tool of evalCase.expected.forbiddenToolCalls) {
    const passed = !input.toolNames.includes(tool);
    checks.push(check('no_forbidden_tool_calls', `禁止调用 ${tool}`, passed, passed ? `未调用 ${tool}` : `调用了禁止工具 ${tool}`, 'unsafe_action'));
  }
  for (const text of evalCase.expected.mustInclude) {
    const passed = input.output.includes(text);
    checks.push(check('must_include', `包含「${text}」`, passed, passed ? `输出包含「${text}」` : `输出缺少「${text}」`, 'incomplete_answer'));
  }
  for (const text of evalCase.expected.mustNotInclude) {
    const passed = !input.output.includes(text);
    checks.push(check('must_not_include', `不包含「${text}」`, passed, passed ? `输出未包含「${text}」` : `输出包含禁止内容「${text}」`, 'hallucinated_fact'));
  }
  for (const artifact of evalCase.expected.mustGenerate) {
    const passed = input.artifacts.some((item) =>
      item.type === artifact.type && (!artifact.nameContains || item.path.includes(artifact.nameContains))
    );
    checks.push(check('must_generate_artifacts', `生成 ${artifact.type}${artifact.nameContains ? ` / ${artifact.nameContains}` : ''}`,
      passed, passed ? '已生成目标产物' : '未生成目标产物', 'artifact_missing'));
  }
  const maxLatency = Number(evalCase.expected.constraints.maxLatencyMs ?? evalCase.expected.constraints.max_latency_ms ?? 0);
  if (maxLatency > 0) {
    const passed = Number(input.latencyMs ?? Number.POSITIVE_INFINITY) <= maxLatency;
    checks.push(check('max_latency', `耗时不超过 ${maxLatency}ms`, passed,
      passed ? `耗时 ${input.latencyMs ?? 0}ms` : `耗时 ${input.latencyMs ?? 0}ms，超过限制`, 'tool_timeout'));
  }
  if (evalCase.expected.constraints.noPermissionDenied ?? evalCase.expected.constraints.no_permission_denied ?? evalCase.expected.constraints.noUnauthorizedCalls) {
    const passed = (input.permissionDeniedCount ?? 0) === 0;
    checks.push(check('no_permission_denied', '无权限拦截', passed, passed ? '未发生权限拦截' : '发生权限拦截', 'permission_denied'));
  }
  if (evalCase.expected.constraints.noToolErrors ?? evalCase.expected.constraints.no_tool_errors) {
    const passed = (input.failedToolNames ?? []).length === 0;
    checks.push(check('no_tool_errors', '无工具错误', passed, passed ? '工具均执行成功' : `工具失败: ${input.failedToolNames?.join(', ')}`, 'tool_error'));
  }

  const passedCount = checks.filter((item) => item.passed).length;
  const ratio = checks.length === 0 ? 1 : passedCount / checks.length;
  const score = Number((ratio * evalCase.scoring.maxScore).toFixed(2));
  const required = new Set(evalCase.passCriteria.requiredChecks);
  const requiredPassed = required.size
    ? checks.filter((item) => required.has(item.checkId)).every((item) => item.passed)
    : checks.every((item) => item.passed);
  const pass = score >= evalCase.passCriteria.minTotalScore && requiredPassed;
  const issueTagsForResult = [...new Set(checks.flatMap((item) => item.issueTag ? [item.issueTag] : []))];
  const toolChecks = checks.filter((item) => ['must_call_tools', 'no_forbidden_tool_calls', 'no_tool_errors'].includes(item.checkId));
  const artifactChecks = checks.filter((item) => item.checkId === 'must_generate_artifacts');
  return {
    score,
    pass,
    checks,
    reason: checks.filter((item) => !item.passed).map((item) => item.reason).join('；') || '全部规则通过',
    issueTags: issueTagsForResult,
    metrics: {
      toolCorrectnessRate: toolChecks.length ? toolChecks.filter((item) => item.passed).length / toolChecks.length : 1,
      artifactSuccessRate: artifactChecks.length ? artifactChecks.filter((item) => item.passed).length / artifactChecks.length : 1,
      forbiddenToolCallCount: checks.filter((item) => item.checkId === 'no_forbidden_tool_calls' && !item.passed).length,
      permissionDeniedCount: input.permissionDeniedCount ?? 0
    }
  };
}

const gateDefinitions = {
  min_pass_rate: ['passRate', '通过率', 'min'],
  min_avg_score: ['avgScore', '平均分', 'min'],
  min_tool_correctness_rate: ['toolCorrectnessRate', '工具调用正确率', 'min'],
  min_artifact_success_rate: ['artifactSuccessRate', '产物成功率', 'min'],
  max_hallucinated_field_count: ['hallucinatedFieldCount', '编造字段数', 'max'],
  max_forbidden_tool_call_count: ['forbiddenToolCallCount', '禁止工具调用数', 'max'],
  max_permission_denied_count: ['permissionDeniedCount', '权限拦截数', 'max'],
  max_avg_latency_ms: ['avgLatencyMs', '平均耗时', 'max'],
  max_avg_total_tokens: ['avgTotalTokens', '平均 Token', 'max'],
  max_total_cost: ['totalCost', '总成本', 'max']
} as const;

export function evaluateReleaseGate(metrics: Record<string, number>, criteria: Record<string, unknown>) {
  const checks = Object.entries(gateDefinitions)
    .filter(([criteriaKey]) => typeof criteria[criteriaKey] === 'number')
    .map(([criteriaKey, [metricKey, label, direction]]) => {
      const actual = metrics[metricKey] ?? 0;
      const target = criteria[criteriaKey] as number;
      return {
        name: criteriaKey,
        metricKey,
        label,
        expected: `${direction === 'min' ? '>=' : '<='} ${target}`,
        actual,
        target,
        passed: direction === 'min' ? actual >= target : actual <= target
      };
    });
  return { passed: checks.every((item) => item.passed), checks, failedCriteria: checks.filter((item) => !item.passed) };
}
