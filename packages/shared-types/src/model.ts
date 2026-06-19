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
