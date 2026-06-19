import { z } from 'zod';
export type { TraceEvent } from '@jarvis/shared-types';

export const traceEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  timestamp: z.string().datetime(),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  runId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
  payload: z.record(z.unknown()).default({})
});

export const runStatuses = ['running', 'success', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof runStatuses)[number];

export interface RunSummary {
  id: string;
  sessionId?: string;
  name: string;
  status: RunStatus;
  model?: string;
  modelProvider?: string;
  promptVersion?: string;
  skillVersions: string[];
  toolSchemaVersion?: string;
  runtimeVersion?: string;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  score?: number;
  toolCallCount: number;
  artifactCount: number;
  error?: string;
}
