import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { diagnosticErrorDetails, logModelProviderError } from '@jarvis/model-gateway';
import type { ModelProfile } from '@jarvis/shared-types';
import { all, get, run, storageRoot } from '../db/database.ts';

export type ProviderType = 'deterministic' | 'openai-compatible';
export type ProviderSource = 'builtin' | 'environment' | 'registry';

export interface ModelProviderInput {
  name: string;
  providerType?: 'openai-compatible';
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
  defaultModel: string;
  enabled?: boolean;
  isDefault?: boolean;
  inputPricePer1MTokens?: number;
  outputPricePer1MTokens?: number;
  currency?: string;
}

interface ProviderRow {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  api_key_encrypted: string | null;
  api_key_hint: string | null;
  default_model: string;
  enabled: number;
  is_default: number;
  last_test_status: string | null;
  last_test_latency_ms: number | null;
  last_test_message: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
  input_price_per_1m_tokens: number | null;
  output_price_per_1m_tokens: number | null;
  currency: string | null;
}

export interface ModelProviderView {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl?: string;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  readOnly: boolean;
  source: ProviderSource;
  apiKeyConfigured: boolean;
  apiKeyHint?: string;
  lastTestStatus?: string;
  lastTestLatencyMs?: number;
  lastTestMessage?: string;
  lastTestedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  inputPricePer1MTokens: number;
  outputPricePer1MTokens: number;
  currency: string;
}

export interface ResolvedModelProvider {
  id: string;
  name: string;
  profile: ModelProfile;
  pricing: { inputPricePer1MTokens: number; outputPricePer1MTokens: number; currency: string };
}

const deterministicProvider: ModelProviderView = {
  id: 'builtin-deterministic',
  name: 'Deterministic Local',
  providerType: 'deterministic',
  defaultModel: 'deterministic-local',
  enabled: true,
  isDefault: false,
  readOnly: true,
  source: 'builtin',
  apiKeyConfigured: false,
  inputPricePer1MTokens: 0,
  outputPricePer1MTokens: 0,
  currency: 'USD',
  lastTestStatus: 'healthy',
  lastTestMessage: '内置离线 Provider，无需网络连接'
};

export function listModelProviders(): ModelProviderView[] {
  const registry = all<ProviderRow>(`SELECT * FROM model_providers ORDER BY is_default DESC, updated_at DESC`).map(normalizeRow);
  const environment = environmentProvider();
  const hasDefault = registry.some((item) => item.enabled && item.isDefault);
  return [
    { ...deterministicProvider, isDefault: !hasDefault },
    ...(environment ? [environment] : []),
    ...registry
  ];
}

export function getModelProvider(id: string): ModelProviderView | undefined {
  return listModelProviders().find((item) => item.id === id);
}

export function createModelProvider(input: ModelProviderInput) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const clean = normalizeInput(input);
  if (clean.isDefault) clearRegistryDefaults();
  const encrypted = clean.apiKey ? encryptSecret(clean.apiKey) : null;
  run(`INSERT INTO model_providers (
    id, name, provider_type, base_url, api_key_encrypted, api_key_hint, default_model,
    enabled, is_default, created_at, updated_at, input_price_per_1m_tokens,
    output_price_per_1m_tokens, currency
  ) VALUES (?, ?, 'openai-compatible', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  id, clean.name, clean.baseUrl, encrypted, secretHint(clean.apiKey), clean.defaultModel,
  clean.enabled ? 1 : 0, clean.isDefault ? 1 : 0, now, now, clean.inputPricePer1MTokens,
  clean.outputPricePer1MTokens, clean.currency);
  return getModelProvider(id);
}

export function updateModelProvider(id: string, input: ModelProviderInput) {
  const current = requireRegistryRow(id);
  const clean = normalizeInput(input);
  if (clean.isDefault) clearRegistryDefaults();
  const encrypted = clean.clearApiKey ? null : clean.apiKey ? encryptSecret(clean.apiKey) : current.api_key_encrypted;
  const hint = clean.clearApiKey ? null : clean.apiKey ? secretHint(clean.apiKey) : current.api_key_hint;
  run(`UPDATE model_providers SET name=?, base_url=?, api_key_encrypted=?, api_key_hint=?,
    default_model=?, enabled=?, is_default=?, updated_at=?, input_price_per_1m_tokens=?,
    output_price_per_1m_tokens=?, currency=? WHERE id=?`,
  clean.name, clean.baseUrl, encrypted, hint, clean.defaultModel, clean.enabled ? 1 : 0,
  clean.isDefault ? 1 : 0, new Date().toISOString(), clean.inputPricePer1MTokens,
  clean.outputPricePer1MTokens, clean.currency, id);
  return getModelProvider(id);
}

export function deleteModelProvider(id: string) {
  requireRegistryRow(id);
  run(`DELETE FROM model_providers WHERE id=?`, id);
  return { ok: true };
}

export function resolveModelProvider(id?: string): ResolvedModelProvider {
  const providerId = id ?? defaultProviderId();
  if (providerId === deterministicProvider.id) {
    return {
      id: deterministicProvider.id,
      name: deterministicProvider.name,
      profile: { provider: 'deterministic', model: deterministicProvider.defaultModel, inputPricePer1MTokens: 0, outputPricePer1MTokens: 0, currency: 'USD' }
      , pricing: { inputPricePer1MTokens: 0, outputPricePer1MTokens: 0, currency: 'USD' }
    };
  }
  if (providerId === 'env-openai-compatible') {
    const environment = environmentProvider();
    if (!environment) throw new Error('环境变量 Provider 未配置');
    return {
      id: environment.id,
      name: environment.name,
      profile: {
        provider: 'openai-compatible',
        model: environment.defaultModel,
        baseUrl: environment.baseUrl,
        apiKey: process.env.OPENAI_API_KEY ?? '',
        inputPricePer1MTokens: Number(process.env.OPENAI_INPUT_PRICE_PER_1M_TOKENS ?? 0),
        outputPricePer1MTokens: Number(process.env.OPENAI_OUTPUT_PRICE_PER_1M_TOKENS ?? 0),
        currency: process.env.OPENAI_PRICE_CURRENCY ?? 'USD'
      },
      pricing: {
        inputPricePer1MTokens: Number(process.env.OPENAI_INPUT_PRICE_PER_1M_TOKENS ?? 0),
        outputPricePer1MTokens: Number(process.env.OPENAI_OUTPUT_PRICE_PER_1M_TOKENS ?? 0),
        currency: process.env.OPENAI_PRICE_CURRENCY ?? 'USD'
      }
    };
  }
  const row = requireRegistryRow(providerId);
  if (!row.enabled) throw new Error(`Provider「${row.name}」已停用`);
  return {
    id: row.id,
    name: row.name,
    profile: {
      provider: 'openai-compatible',
      model: row.default_model,
      baseUrl: row.base_url ?? undefined,
      apiKey: row.api_key_encrypted ? decryptSecret(row.api_key_encrypted) : '',
      inputPricePer1MTokens: Number(row.input_price_per_1m_tokens ?? 0),
      outputPricePer1MTokens: Number(row.output_price_per_1m_tokens ?? 0),
      currency: row.currency ?? 'USD'
    },
    pricing: {
      inputPricePer1MTokens: Number(row.input_price_per_1m_tokens ?? 0),
      outputPricePer1MTokens: Number(row.output_price_per_1m_tokens ?? 0),
      currency: row.currency ?? 'USD'
    }
  };
}

export async function testModelProvider(id: string, fetchImpl: typeof fetch = fetch) {
  const resolved = resolveModelProvider(id);
  const result = await probeModelProfile(resolved.profile, fetchImpl);
  return recordTest(id, result.status, result.latencyMs, result.message, result.modelCount);
}

export async function testModelProviderDraft(input: ModelProviderInput & { providerId?: string }, fetchImpl: typeof fetch = fetch) {
  const clean = normalizeInput(input);
  let apiKey = clean.apiKey;
  if (!apiKey && !clean.clearApiKey && input.providerId) {
    const row = requireRegistryRow(input.providerId);
    apiKey = row.api_key_encrypted ? decryptSecret(row.api_key_encrypted) : undefined;
  }
  return probeModelProfile({
    provider: 'openai-compatible',
    model: clean.defaultModel,
    baseUrl: clean.baseUrl,
    apiKey
  }, fetchImpl);
}

async function probeModelProfile(profile: ModelProfile, fetchImpl: typeof fetch) {
  const started = performance.now();
  try {
    if (profile.provider === 'deterministic') {
      return { status: 'healthy' as const, latencyMs: 0, message: '内置离线 Provider 可用', modelCount: 1, testedAt: new Date().toISOString() };
    }
    const baseUrl = requireBaseUrl(profile.baseUrl ?? '');
    const endpoint = `${baseUrl}/models`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (profile.apiKey) headers.authorization = `Bearer ${profile.apiKey}`;
    const response = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(8_000) });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      const responseBody = await response.text();
      logModelProviderError('models.http_error', {
        endpoint,
        model: profile.model,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        requestId: response.headers.get('x-request-id') ?? response.headers.get('x-client-request-id'),
        latencyMs,
        responseBody: responseBody.slice(0, 4000)
      });
      const detail = responseBody.slice(0, 240);
      return { status: 'failed' as const, latencyMs, message: `HTTP ${response.status}${detail ? ` · ${detail}` : ''}`, modelCount: 0, testedAt: new Date().toISOString() };
    }
    const body = await response.text();
    if (!body.trim()) {
      logModelProviderError('models.empty_response', {
        endpoint,
        model: profile.model,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        requestId: response.headers.get('x-request-id') ?? response.headers.get('x-client-request-id'),
        latencyMs
      });
      return {
        status: 'healthy' as const,
        latencyMs,
        message: '连接成功，但 /models 返回空响应',
        modelCount: 0,
        testedAt: new Date().toISOString()
      };
    }
    const payload = parseModelList(body);
    if (!payload) {
      const contentType = response.headers.get('content-type') ?? 'unknown content-type';
      logModelProviderError('models.invalid_json', {
        endpoint,
        model: profile.model,
        status: response.status,
        statusText: response.statusText,
        contentType,
        requestId: response.headers.get('x-request-id') ?? response.headers.get('x-client-request-id'),
        latencyMs,
        responseBody: body.slice(0, 4000)
      });
      return {
        status: 'healthy' as const,
        latencyMs,
        message: `连接成功，但 /models 返回非 JSON 响应（${contentType}）`,
        modelCount: 0,
        testedAt: new Date().toISOString()
      };
    }
    const modelCount = modelListCount(payload);
    return { status: 'healthy' as const, latencyMs, message: `连接成功，发现 ${modelCount} 个模型`, modelCount, testedAt: new Date().toISOString() };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : '未知连接错误';
    logModelProviderError('models.request_error', {
      endpoint: profile.baseUrl ? `${profile.baseUrl.replace(/\/$/, '')}/models` : 'unresolved',
      model: profile.model,
      latencyMs,
      error: diagnosticErrorDetails(error)
    });
    return { status: 'failed' as const, latencyMs, message: message.slice(0, 280), modelCount: 0, testedAt: new Date().toISOString() };
  }
}

function parseModelList(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function modelListCount(payload: unknown) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== 'object') return 0;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data.length;
  if (Array.isArray(record.models)) return record.models.length;
  return 0;
}

function recordTest(id: string, status: 'healthy' | 'failed', latencyMs: number, message: string, modelCount: number) {
  const testedAt = new Date().toISOString();
  if (!id.startsWith('builtin-') && !id.startsWith('env-')) {
    run(`UPDATE model_providers SET last_test_status=?, last_test_latency_ms=?, last_test_message=?,
      last_tested_at=?, updated_at=? WHERE id=?`, status, latencyMs, message, testedAt, testedAt, id);
  }
  return { id, status, latencyMs, message, modelCount, testedAt };
}

function environmentProvider(): ModelProviderView | undefined {
  if (!process.env.OPENAI_BASE_URL && !process.env.OPENAI_API_KEY && !process.env.OPENAI_MODEL) return undefined;
  return {
    id: 'env-openai-compatible',
    name: 'Environment OpenAI Compatible',
    providerType: 'openai-compatible',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:11434/v1',
    defaultModel: process.env.OPENAI_MODEL ?? 'qwen3',
    enabled: true,
    isDefault: false,
    readOnly: true,
    source: 'environment',
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    apiKeyHint: process.env.OPENAI_API_KEY ? secretHint(process.env.OPENAI_API_KEY) ?? undefined : undefined
    , inputPricePer1MTokens: Number(process.env.OPENAI_INPUT_PRICE_PER_1M_TOKENS ?? 0)
    , outputPricePer1MTokens: Number(process.env.OPENAI_OUTPUT_PRICE_PER_1M_TOKENS ?? 0)
    , currency: process.env.OPENAI_PRICE_CURRENCY ?? 'USD'
  };
}

function normalizeRow(row: ProviderRow): ModelProviderView {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url ?? undefined,
    defaultModel: row.default_model,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    readOnly: false,
    source: 'registry',
    apiKeyConfigured: Boolean(row.api_key_encrypted),
    apiKeyHint: row.api_key_hint ?? undefined,
    lastTestStatus: row.last_test_status ?? undefined,
    lastTestLatencyMs: row.last_test_latency_ms ?? undefined,
    lastTestMessage: row.last_test_message ?? undefined,
    lastTestedAt: row.last_tested_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
    , inputPricePer1MTokens: Number(row.input_price_per_1m_tokens ?? 0)
    , outputPricePer1MTokens: Number(row.output_price_per_1m_tokens ?? 0)
    , currency: row.currency ?? 'USD'
  };
}

function normalizeInput(input: ModelProviderInput) {
  const name = input.name?.trim();
  const defaultModel = input.defaultModel?.trim();
  const enabled = input.enabled !== false;
  if (!name) throw new Error('Provider 名称不能为空');
  if (!defaultModel) throw new Error('默认模型不能为空');
  return {
    name,
    baseUrl: requireBaseUrl(input.baseUrl),
    apiKey: input.apiKey?.trim() || undefined,
    clearApiKey: Boolean(input.clearApiKey),
    defaultModel,
    enabled,
    isDefault: Boolean(input.isDefault && enabled)
    , inputPricePer1MTokens: nonnegative(input.inputPricePer1MTokens)
    , outputPricePer1MTokens: nonnegative(input.outputPricePer1MTokens)
    , currency: input.currency?.trim().toUpperCase() || 'USD'
  };
}

function nonnegative(value?: number) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error('模型价格必须是非负数');
  return number;
}

function requireBaseUrl(value: string) {
  const raw = value?.trim().replace(/\/$/, '');
  if (!raw) throw new Error('Base URL 不能为空');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Base URL 仅支持 http 或 https');
  if (parsed.username || parsed.password) throw new Error('Base URL 不允许包含用户名或密码');
  return raw;
}

function requireRegistryRow(id: string) {
  const row = get<ProviderRow>(`SELECT * FROM model_providers WHERE id=?`, id);
  if (!row) throw new Error('Provider 不存在或为只读配置');
  return row;
}

function defaultProviderId() {
  return get<{ id: string }>(`SELECT id FROM model_providers WHERE enabled=1 AND is_default=1 ORDER BY updated_at DESC LIMIT 1`)?.id
    ?? deterministicProvider.id;
}

function clearRegistryDefaults() {
  run(`UPDATE model_providers SET is_default=0 WHERE is_default=1`);
}

function secretHint(secret?: string) {
  return secret ? `••••${secret.slice(-4)}` : null;
}

function encryptionKey() {
  if (process.env.JARVIS_STUDIO_PROVIDER_KEY) {
    return createHash('sha256').update(process.env.JARVIS_STUDIO_PROVIDER_KEY).digest();
  }
  const path = resolve(storageRoot, 'provider-secret.key');
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  const key = randomBytes(32);
  writeFileSync(path, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  return key;
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Provider API Key 密文格式无效');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}
