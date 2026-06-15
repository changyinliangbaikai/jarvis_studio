export interface EvalDataset {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  owner: string;
  caseCount: number;
  releaseGateId?: string;
  latestRun?: { id: string; status: string; passRate: number; avgScore: number; createdAt: string };
}

export interface EvalCase {
  id: string;
  datasetId?: string;
  name: string;
  category: string;
  priority: string;
  version: string;
  tags: string[];
  input: { message: string; files: Array<{ path: string }> };
  expected: Record<string, unknown>;
  scoring: Record<string, unknown>;
  passCriteria: Record<string, unknown>;
  latestResult?: { status: string; passed: boolean; score: number; issueTags: string[] };
}

export interface EvalCaseResult {
  id: string;
  evalRunId: string;
  evalCaseId: string;
  evalCaseName: string;
  priority: string;
  category: string;
  runId?: string;
  status: string;
  passed: boolean;
  totalScore: number;
  ruleScore: number;
  llmJudgeScore?: number;
  humanScore?: number;
  latencyMs: number;
  totalTokens: number;
  cost: number;
  issueTags: string[];
  ruleResults: { pass?: boolean; checks?: Array<{ checkId: string; label: string; passed: boolean; reason: string }> };
  judgeResult?: Record<string, unknown>;
  humanReview?: Record<string, unknown>;
  finalOutput?: string;
  error?: string;
}

export interface EvalRun {
  id: string;
  datasetId: string;
  datasetName: string;
  datasetVersion: string;
  name: string;
  status: string;
  modelProviderId: string;
  modelName: string;
  promptVersion: string;
  runtimeVersion: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  avgScore: number;
  avgLatencyMs: number;
  avgTotalTokens: number;
  totalCost: number;
  avgCostPerCase: number;
  currency: string;
  enableLlmJudge: boolean;
  releaseGateResultId?: string;
  reportPath?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  error?: string;
  results?: EvalCaseResult[];
  gateResult?: GateResult;
  failureStats?: Array<{ tag: string; count: number }>;
}

export interface ReleaseGate {
  id: string;
  name: string;
  version: string;
  scope: Record<string, unknown>;
  criteria: Record<string, number>;
  requiredP0Cases: Record<string, number>;
}

export interface GateResult {
  id: string;
  gateId: string;
  gateName: string;
  evalRunId: string;
  passed: boolean;
  summary: Record<string, number>;
  failedCriteria: Array<{ label: string; actual: number; expected: string }>;
  createdAt: string;
}

export interface ModelProviderOption {
  id: string;
  name: string;
  defaultModel: string;
  enabled: boolean;
}
