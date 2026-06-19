import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import YAML from 'yaml';
import type {
  ContextPolicyConfig,
  JarvisWorkspaceConfig,
  LoadedConfig,
  ModelProviderProfileConfig,
  PermissionPolicyConfig,
  ResolvedModel
} from '../types.ts';
import type { ModelProfile } from '../runtime.ts';

// 同时兼容 snake_case 与 camelCase 字段读取，保证与 Studio 的 ModelProviderProfile 双向兼容。
function pick<T = unknown>(source: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key] as T;
  }
  return undefined;
}

function readYaml(path: string): Record<string, unknown> {
  if (!existsSync(path)) throw new Error(`配置文件缺失: ${path}`);
  const parsed = YAML.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error(`配置文件格式非法: ${path}`);
  return parsed as Record<string, unknown>;
}

// 解析 jarvis.yaml；所有目录都归一化为绝对路径，baseDir 为配置目录的父目录（通常是项目根）。
function loadWorkspace(configDir: string, baseDir: string, silent: boolean): JarvisWorkspaceConfig {
  const doc = readYaml(resolve(configDir, 'jarvis.yaml'));
  const ws = (doc.workspace ?? {}) as Record<string, unknown>;
  const defaults = (doc.defaults ?? {}) as Record<string, unknown>;
  const root = abs(baseDir, String(pick(ws, 'root') ?? './workspaces/default'));
  if (!silent) console.log(`[config] 解析 jarvis.yaml: workspace.root=${root}`);
  return {
    workspace: {
      id: String(pick(ws, 'id') ?? 'default'),
      root,
      artifactDir: abs(baseDir, String(pick(ws, 'artifact_dir', 'artifactDir') ?? `${root}/artifacts`)),
      traceDir: abs(baseDir, String(pick(ws, 'trace_dir', 'traceDir') ?? `${root}/traces`)),
      tmpDir: abs(baseDir, String(pick(ws, 'tmp_dir', 'tmpDir') ?? `${root}/tmp`))
    },
    defaults: {
      modelProfile: String(pick(defaults, 'model_profile', 'modelProfile') ?? 'deterministic-default'),
      permissionPolicy: pick<string>(defaults, 'permission_policy', 'permissionPolicy'),
      contextPolicy: pick<string>(defaults, 'context_policy', 'contextPolicy'),
      skills: Array.isArray(defaults.skills) ? defaults.skills.map(String) : []
    }
  };
}

function abs(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

// 解析 model-providers.yaml -> 归一化 profile 列表。
function loadModelProfiles(configDir: string): ModelProviderProfileConfig[] {
  const doc = readYaml(resolve(configDir, 'model-providers.yaml'));
  const profiles = Array.isArray(doc.profiles) ? doc.profiles : [];
  return profiles.map((entry) => {
    const item = entry as Record<string, unknown>;
    const params = (pick<Record<string, unknown>>(item, 'default_parameters', 'defaultParameters') ?? {}) as Record<string, unknown>;
    const provider = pick<string>(item, 'provider') === 'openai-compatible' ? 'openai-compatible' : 'deterministic';
    return {
      id: String(pick(item, 'id') ?? `model_${Math.random().toString(36).slice(2, 8)}`),
      name: String(pick(item, 'name') ?? pick(item, 'id') ?? 'model'),
      provider,
      baseUrl: pick<string>(item, 'base_url', 'baseUrl'),
      apiKeyEnv: pick<string>(item, 'api_key_env', 'apiKeyEnv'),
      model: String(pick(item, 'model') ?? 'jarvis-sim-1'),
      temperature: num(pick(params, 'temperature') ?? pick(item, 'temperature')),
      maxOutputTokens: num(pick(params, 'max_tokens', 'maxTokens', 'max_output_tokens', 'maxOutputTokens') ?? pick(item, 'maxOutputTokens')),
      topP: num(pick(params, 'top_p', 'topP')),
      inputPricePer1MTokens: num(pick(item, 'input_price_per_1m', 'inputPricePer1MTokens')),
      outputPricePer1MTokens: num(pick(item, 'output_price_per_1m', 'outputPricePer1MTokens')),
      currency: pick<string>(item, 'currency')
    } satisfies ModelProviderProfileConfig;
  });
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// 解析 permissions.yaml。
function loadPermissionPolicies(configDir: string): PermissionPolicyConfig[] {
  const path = resolve(configDir, 'permissions.yaml');
  if (!existsSync(path)) return [];
  const doc = readYaml(path);
  const policies = Array.isArray(doc.policies) ? doc.policies : [];
  return policies.map((entry) => {
    const item = entry as Record<string, unknown>;
    const approval = (item.approval ?? {}) as Record<string, unknown>;
    return {
      id: String(pick(item, 'id') ?? 'policy'),
      raw: item,
      approvalRequiredFor: Array.isArray(approval.required_for) ? approval.required_for.map(String) : []
    } satisfies PermissionPolicyConfig;
  });
}

// 解析 context-policy.yaml。
function loadContextPolicies(configDir: string): ContextPolicyConfig[] {
  const path = resolve(configDir, 'context-policy.yaml');
  if (!existsSync(path)) return [];
  const doc = readYaml(path);
  const policies = Array.isArray(doc.policies) ? doc.policies : [];
  return policies.map((entry) => {
    const item = entry as Record<string, unknown>;
    const budgets = (pick<Record<string, unknown>>(item, 'segment_budgets', 'segmentBudgets') ?? {}) as Record<string, unknown>;
    return {
      id: String(pick(item, 'id') ?? 'context'),
      maxPromptTokens: num(pick(item, 'max_prompt_tokens', 'maxPromptTokens')),
      reserveCompletionTokens: num(pick(item, 'reserve_completion_tokens', 'reserveCompletionTokens')),
      segmentBudgets: Object.fromEntries(Object.entries(budgets).map(([k, v]) => [k, Number(v)])),
      raw: item
    } satisfies ContextPolicyConfig;
  });
}

// 加载选项：configDir 指向配置目录（默认 <cwd>/configs）；
// silent=true 时不打印解析日志，供同进程多次调用或需要安静模式时使用。
export interface LoadConfigOptions {
  configDir?: string;
  silent?: boolean;
}

// 入口：加载并聚合全部配置。
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const configDir = options.configDir ?? resolve(process.cwd(), 'configs');
  const silent = options.silent ?? false;
  const baseDir = resolve(configDir, '..');
  if (!silent) console.log(`[config] 开始加载配置目录: ${configDir}`);
  const config: LoadedConfig = {
    configDir,
    workspace: loadWorkspace(configDir, baseDir, silent),
    modelProfiles: loadModelProfiles(configDir),
    permissionPolicies: loadPermissionPolicies(configDir),
    contextPolicies: loadContextPolicies(configDir)
  };
  if (!silent) console.log(`[config] 已加载 ${config.modelProfiles.length} 个模型 profile, ${config.permissionPolicies.length} 条权限策略, ${config.contextPolicies.length} 条上下文策略`);
  return config;
}

// 把归一化 profile 解析为 Runtime 可用的 ModelProfile，并从环境变量注入 API Key。
export function resolveModel(config: LoadedConfig, profileId: string): ResolvedModel {
  const profile = config.modelProfiles.find((item) => item.id === profileId);
  if (!profile) {
    const ids = config.modelProfiles.map((item) => item.id).join(', ');
    throw new Error(`未找到模型 profile "${profileId}"，可用: ${ids || '(空)'}`);
  }
  const apiKey = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : undefined;
  if (profile.provider === 'openai-compatible' && profile.apiKeyEnv && !apiKey) {
    console.warn(`[config] 警告: 环境变量 ${profile.apiKeyEnv} 未设置, profile ${profile.id} 将以无密钥方式调用`);
  }
  const modelProfile: ModelProfile = {
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl,
    apiKey,
    temperature: profile.temperature,
    maxOutputTokens: profile.maxOutputTokens,
    inputPricePer1MTokens: profile.inputPricePer1MTokens,
    outputPricePer1MTokens: profile.outputPricePer1MTokens,
    currency: profile.currency
  };
  return { profile, modelProfile, apiKeyPresent: Boolean(apiKey) };
}
