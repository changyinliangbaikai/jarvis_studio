export interface TraceSpan {
  id: string;
  runId: string;
  parentId?: string;
  type: string;
  name: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  input?: unknown;
  output?: unknown;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}
