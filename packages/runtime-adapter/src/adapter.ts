import type {
  RuntimeApprovalRequest,
  RuntimeApprovalResult,
  RuntimeIds,
  RuntimeRequest,
  RuntimeResult
} from '@jarvis/shared-types';
import type { TraceEvent } from '@jarvis/trace-sdk';

export type RuntimeRunInput = Omit<RuntimeRequest, 'workspacePath'> & { workspacePath?: string };

export interface RuntimeStartOptions {
  waitForApproval?: (request: RuntimeApprovalRequest) => Promise<RuntimeApprovalResult>;
  useAdapterApproval?: boolean;
}

export interface RuntimeRunHandle {
  ids: RuntimeIds;
  runId: string;
  status: 'running';
  startedAt: string;
  eventsUrl: string;
}

export interface RuntimeRunSession {
  ids: RuntimeIds;
  handle: RuntimeRunHandle;
  promise: Promise<RuntimeResult>;
}

export interface RuntimeStatus {
  runId: string;
  status: string;
  active: boolean;
  startedAt?: string | null;
  endedAt?: string | null;
  error?: string | null;
}

export interface RunArtifact {
  id: string;
  runId: string | null;
  workspaceId: string | null;
  taskId: string | null;
  toolCallId: string | null;
  type: string;
  name: string | null;
  path: string;
  mimeType: string | null;
  checksum: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface RuntimeAdapter {
  capabilities(): Record<string, unknown>;
  startRun(input: RuntimeRunInput, options?: RuntimeStartOptions): RuntimeRunSession;
  streamEvents(runId: string): AsyncIterable<TraceEvent>;
  approve(approvalId: string, decision: RuntimeApprovalResult): Promise<{ ok: true; approvalId: string }>;
  cancel(runId: string): Promise<{ ok: true; runId: string; status: 'cancel_requested' }>;
  getArtifacts(runId: string): Promise<RunArtifact[]>;
  getRunStatus(runId: string): Promise<RuntimeStatus>;
}
