import type { TraceEvent } from '../../trace-schema/src/events.ts';

export interface RuntimeIds {
  projectId: string;
  sessionId: string;
  turnId: string;
  runId: string;
}

export interface ModelProfile {
  provider: 'deterministic' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
  inputPricePer1MTokens?: number;
  outputPricePer1MTokens?: number;
  currency?: string;
}

export interface RuntimeRequest {
  name?: string;
  message: string;
  skill?: string;
  files?: string[];
  workspacePath: string;
  modelProfile: ModelProfile;
  promptVersion?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface RuntimeResult {
  ids: RuntimeIds;
  status: 'success' | 'failed';
  output: string;
  artifacts: Array<{ id: string; type: string; path: string; sizeBytes: number }>;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown>; result: unknown; success: boolean }>;
  events: TraceEvent[];
  error?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  systemPrompt: string;
  instructions: string;
  requiredTools: string[];
  permissions: string[];
  outputFile?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: string;
}

export interface ToolExecutionContext {
  workspacePath: string;
  runId: string;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;
  toolCalls: ModelToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
  model: string;
  provider: string;
}

export type TraceSink = (event: TraceEvent) => void | Promise<void>;
