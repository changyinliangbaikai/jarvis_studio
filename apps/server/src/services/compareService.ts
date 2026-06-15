import { all, get, parseJson } from '../db/database.ts';
import { getRun, listArtifacts, listSpans, listTools } from './queryService.ts';
import { getEvalRun, listEvalRunResults } from './evalService.ts';

function metricsFor(column: string, value: string) {
  const allowed = new Set(['prompt_version', 'model', 'skill_versions_json']);
  if (!allowed.has(column)) throw new Error('不支持的对比维度');
  const rows = all<Record<string, unknown>>(`SELECT * FROM runs WHERE ${column}=?`, value);
  const count = rows.length || 1;
  return {
    value,
    runCount: rows.length,
    successRate: rows.filter((row) => row.status === 'success').length / count,
    avgScore: rows.reduce((sum, row) => sum + Number(row.score ?? 0), 0) / count,
    avgLatencyMs: rows.reduce((sum, row) => sum + Number(row.latency_ms ?? 0), 0) / count,
    avgTokens: rows.reduce((sum, row) => sum + Number(row.total_tokens ?? 0), 0) / count,
    toolErrors: rows.reduce((sum, row) => sum + Number(parseJson<Record<string, unknown>>(row.metadata_json, {}).toolErrors ?? 0), 0)
  };
}

export function compareEvalRuns(baselineEvalRunId: string, candidateEvalRunId: string) {
  const baseline = getEvalRun(baselineEvalRunId);
  const candidate = getEvalRun(candidateEvalRunId);
  if (!baseline || !candidate) throw new Error('对比 Eval Run 不存在');
  const leftResults = new Map(listEvalRunResults(baselineEvalRunId).map((item) => [item.evalCaseId, item]));
  const rightResults = new Map(listEvalRunResults(candidateEvalRunId).map((item) => [item.evalCaseId, item]));
  const caseIds = [...new Set([...leftResults.keys(), ...rightResults.keys()])];
  const cases = caseIds.map((caseId) => {
    const left = leftResults.get(caseId);
    const right = rightResults.get(caseId);
    const scoreDelta = Number(right?.totalScore ?? 0) - Number(left?.totalScore ?? 0);
    const classification = !left || !right ? 'unmatched'
      : !left.passed && right.passed ? 'improved'
        : left.passed && !right.passed ? 'regressed'
          : Math.abs(scoreDelta) < 0.01 ? 'unchanged'
            : scoreDelta > 0 ? 'improved' : 'regressed';
    return {
      caseId,
      name: right?.evalCaseName ?? left?.evalCaseName,
      classification,
      scoreDelta,
      latencyDelta: Number(right?.latencyMs ?? 0) - Number(left?.latencyMs ?? 0),
      tokensDelta: Number(right?.totalTokens ?? 0) - Number(left?.totalTokens ?? 0),
      costDelta: Number(right?.cost ?? 0) - Number(left?.cost ?? 0),
      baseline: left,
      candidate: right
    };
  });
  return {
    id: `compare_${baselineEvalRunId}_${candidateEvalRunId}`,
    baseline,
    candidate,
    delta: {
      passRate: candidate.passRate - baseline.passRate,
      avgScore: candidate.avgScore - baseline.avgScore,
      avgLatencyMs: candidate.avgLatencyMs - baseline.avgLatencyMs,
      avgTotalTokens: candidate.avgTotalTokens - baseline.avgTotalTokens,
      totalCost: candidate.totalCost - baseline.totalCost,
      failedCases: candidate.failedCases - baseline.failedCases
    },
    summary: {
      improved: cases.filter((item) => item.classification === 'improved').length,
      regressed: cases.filter((item) => item.classification === 'regressed').length,
      unchanged: cases.filter((item) => item.classification === 'unchanged').length,
      newFailures: cases.filter((item) => item.baseline?.passed && item.candidate && !item.candidate.passed).length
    },
    cases
  };
}
export function compare(dimension: 'prompts' | 'models' | 'skills', left: string, right: string) {
  const column = dimension === 'prompts' ? 'prompt_version' : dimension === 'models' ? 'model' : 'skill_versions_json';
  const a = metricsFor(column, dimension === 'skills' ? JSON.stringify([left]) : left);
  const b = metricsFor(column, dimension === 'skills' ? JSON.stringify([right]) : right);
  return {
    dimension, left: a, right: b,
    delta: {
      successRate: b.successRate - a.successRate,
      avgScore: b.avgScore - a.avgScore,
      avgLatencyMs: b.avgLatencyMs - a.avgLatencyMs,
      avgTokens: b.avgTokens - a.avgTokens
    }
  };
}

export function compareRuns(leftRunId: string, rightRunId: string) {
  const left = runDetail(leftRunId);
  const right = runDetail(rightRunId);
  if (!left || !right) throw new Error('对比 Run 不存在');
  return {
    dimension: 'runs',
    left,
    right,
    delta: {
      latencyMs: Number(right.latencyMs ?? 0) - Number(left.latencyMs ?? 0),
      totalTokens: Number(right.totalTokens ?? 0) - Number(left.totalTokens ?? 0),
      score: Number(right.score ?? 0) - Number(left.score ?? 0),
      toolCalls: right.toolChain.length - left.toolChain.length
    },
    changes: {
      model: left.model === right.model ? 'same' : 'changed',
      prompt: left.promptVersion === right.promptVersion ? 'same' : 'changed',
      skill: JSON.stringify(left.skillVersions) === JSON.stringify(right.skillVersions) ? 'same' : 'changed',
      toolChain: JSON.stringify(left.toolChain) === JSON.stringify(right.toolChain) ? 'same' : 'changed',
      finalOutput: left.finalOutput === right.finalOutput ? 'same' : 'changed'
    }
  };
}

function runDetail(runId: string) {
  const item = getRun(runId);
  if (!item) return undefined;
  const tools = listTools(runId);
  const runEnd = get<{ raw_json: string }>(`SELECT raw_json FROM raw_trace_events WHERE run_id=? AND event_type='run.end' ORDER BY timestamp DESC LIMIT 1`, runId);
  const finalOutput = parseJson<{ payload?: { finalOutput?: string } }>(runEnd?.raw_json, {}).payload?.finalOutput ?? '';
  return {
    ...item,
    finalOutput,
    toolChain: tools.map((tool) => ({ name: tool.toolName, success: tool.success, latencyMs: tool.latencyMs, arguments: tool.arguments })),
    artifacts: listArtifacts(runId),
    spanTypes: listSpans(runId).map((span) => span.type)
  };
}
