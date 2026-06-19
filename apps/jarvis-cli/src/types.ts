// CLI 层类型定义。这些类型只描述 CLI 的配置与编排结构，
// 执行协议（TraceEvent / RuntimeRequest 等）一律复用 agent-runtime。
import type { ModelProfile } from './runtime.ts';

// 归一化后的模型服务商 profile，字段兼容 Studio 的 ModelProviderProfile。
export interface ModelProviderProfileConfig {
  id: string;
  name: string;
  provider: 'deterministic' | 'openai-compatible';
  baseUrl?: string;
  apiKeyEnv?: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  inputPricePer1MTokens?: number;
  outputPricePer1MTokens?: number;
  currency?: string;
}

// 权限策略（工作空间级声明意图）。
export interface PermissionPolicyConfig {
  id: string;
  raw: Record<string, unknown>;
  approvalRequiredFor: string[];
}

// 上下文预算策略。
export interface ContextPolicyConfig {
  id: string;
  maxPromptTokens?: number;
  reserveCompletionTokens?: number;
  segmentBudgets?: Record<string, number>;
  raw: Record<string, unknown>;
}

// jarvis.yaml 解析结果。
export interface JarvisWorkspaceConfig {
  workspace: {
    id: string;
    root: string;
    artifactDir: string;
    traceDir: string;
    tmpDir: string;
  };
  defaults: {
    modelProfile: string;
    permissionPolicy?: string;
    contextPolicy?: string;
    skills: string[];
  };
}

// ConfigLoader 聚合后的完整配置视图。
export interface LoadedConfig {
  configDir: string;
  workspace: JarvisWorkspaceConfig;
  modelProfiles: ModelProviderProfileConfig[];
  permissionPolicies: PermissionPolicyConfig[];
  contextPolicies: ContextPolicyConfig[];
}

// run 命令解析后的有效参数。
export interface RunOptions {
  task: string;
  skill?: string;
  files: string[];
  workspacePath: string;
  modelProfileId: string;
  permissionPolicyId?: string;
  contextPolicyId?: string;
  promptVersion?: string;
  traceOut?: string;
  artifactDir: string;
  json: boolean;
  eventStream: boolean;
  // --non-interactive: 完全禁止终端交互（供 Studio CliRuntimeAdapter 使用）
  nonInteractive: boolean;
  // --yes: 自动批准所有审批请求（非交互 + 无选择时也放行）
  yes: boolean;
  // --auto-approve-low-risk: 自动批准 low 风险工具
  autoApproveLowRisk: boolean;
  // --deny-high-risk: 自动拒绝 high/critical 风险工具
  denyHighRisk: boolean;
  maxApprovals: number;
}

// 解析后的模型 profile 与可注入 Runtime 的 ModelProfile。
export interface ResolvedModel {
  profile: ModelProviderProfileConfig;
  modelProfile: ModelProfile;
  apiKeyPresent: boolean;
}
