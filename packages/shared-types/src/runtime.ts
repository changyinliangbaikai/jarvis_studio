import type { RuntimeApprovalRequest, RuntimeApprovalResult } from './approval.ts';
import type { ModelProfile } from './model.ts';

export interface TraceEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  projectId?: string;
  sessionId?: string;
  turnId?: string;
  runId?: string;
  spanId?: string;
  parentSpanId?: string;
  payload: Record<string, unknown>;
}

export interface RuntimeIds {
  projectId: string;
  sessionId: string;
  turnId: string;
  runId: string;
}

export interface RuntimeRequest {
  name?: string;
  message: string;
  skill?: string;
  files?: string[];
  workspacePath: string;
  modelProfile: ModelProfile;
  promptVersion?: string;
  contextStrategy?: string;
  policyVersion?: string;
  approvedTools?: string[];
  workspaceId?: string;
  taskId?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface RuntimeResult {
  ids: RuntimeIds;
  status: 'success' | 'failed';
  output: string;
  artifacts: Array<{ id: string; type: string; path: string; sizeBytes: number; toolCallId?: string; workspaceId?: string; taskId?: string }>;
  toolCalls: Array<{ id: string; spanId?: string; name: string; arguments: Record<string, unknown>; result: unknown; success: boolean }>;
  events: TraceEvent[];
  error?: string;
}

export type TraceSink = (event: TraceEvent) => void | Promise<void>;

export interface RuntimeRunOptions {
  ids?: RuntimeIds;
  onEvent?: TraceSink;
  waitForApproval?: (request: RuntimeApprovalRequest) => Promise<RuntimeApprovalResult>;
}
