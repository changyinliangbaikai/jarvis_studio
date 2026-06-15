import { describe, expect, it } from 'vitest';
import { evalCaseSchema, evalDatasetSchema } from './evalCase.ts';
import { evaluateReleaseGate, scoreRules } from './ruleScorer.ts';

describe('rule scorer', () => {
  it('scores a passing run', () => {
    const evalCase = evalCaseSchema.parse({
      id: 'case',
      name: 'case',
      category: 'test',
      priority: 'p0',
      input: { message: 'go' },
      expected: { must_call_tools: ['xlsx.inspect'], forbidden_tool_calls: ['shell.run'], must_include: ['数据概况'], must_not_include: ['无法分析'] },
      scoring: { max_score: 5 },
      pass_criteria: { min_total_score: 4, required_checks: ['must_call_tools'] }
    });
    expect(scoreRules(evalCase, { output: '数据概况', toolNames: ['xlsx.inspect'], artifacts: [] }).pass).toBe(true);
  });

  it('evaluates release gates', () => {
    expect(evaluateReleaseGate({ passRate: 0.9, avgScore: 4.2 }, { min_pass_rate: 0.85, min_avg_score: 4 })).toMatchObject({ passed: true });
  });

  it('normalizes the v0.3 dataset and case yaml shape', () => {
    expect(evalDatasetSchema.parse({
      id: 'dataset', name: 'Dataset', version: '1.0.0', case_glob: ['cases/*.yaml'], default_runtime: { timeout_seconds: 30 }
    })).toMatchObject({ caseGlob: ['cases/*.yaml'], defaultRuntime: { timeout_seconds: 30 } });
    expect(evalCaseSchema.parse({
      id: 'case', name: 'Case', category: 'smoke', input: { message: 'go' },
      expected: { must_select_skill: ['weekly-report'], must_generate_artifacts: [{ type: 'markdown' }] },
      scoring: { max_score: 5 }, pass_criteria: { min_total_score: 4 }
    })).toMatchObject({ expected: { mustSelectSkill: ['weekly-report'], mustGenerate: [{ type: 'markdown' }] } });
  });
});
