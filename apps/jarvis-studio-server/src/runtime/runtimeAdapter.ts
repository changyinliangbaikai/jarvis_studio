import { resolve } from 'node:path';
import { LocalRuntimeAdapter as BaseLocalRuntimeAdapter } from '@jarvis/runtime-adapter';
import type { RuntimeApprovalRequest, RuntimeApprovalResult } from '@jarvis/shared-types';
import type { TraceEvent } from '@jarvis/trace-sdk';
import type {
  RunArtifact,
  RuntimeAdapter,
  RuntimeRunInput,
  RuntimeRunSession,
  RuntimeStartOptions,
  RuntimeStatus
} from '@jarvis/runtime-adapter';
import { all, get, parseJson } from '../db/database.ts';
import { listModelProviders } from '../services/modelProviderService.ts';
import { importTraceJsonl } from '../services/traceImportService.ts';

export const runtimeWorkspace = resolve(import.meta.dirname, '../../../../fixtures/runtime-workspace');

type ArtifactRow = {
  id: string;
  run_id: string | null;
  workspace_id: string | null;
  task_id: string | null;
  tool_call_id: string | null;
  type: string;
  name: string | null;
  path: string;
  mime_type: string | null;
  checksum: string | null;
  size_bytes: number | null;
  created_at: string;
};

type RunRow = {
  id: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
};

function getArtifacts(runId: string): RunArtifact[] {
  return all<ArtifactRow>(`SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at DESC`, runId).map((row) => ({
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    toolCallId: row.tool_call_id,
    type: row.type,
    name: row.name,
    path: row.path,
    mimeType: row.mime_type,
    checksum: row.checksum,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at
  }));
}

function getRunStatus(runId: string): Pick<RuntimeStatus, 'status' | 'startedAt' | 'endedAt' | 'error'> | undefined {
  const row = get<RunRow>(`SELECT id, status, started_at, ended_at, error FROM runs WHERE id=?`, runId);
  return row ? {
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    error: row.error
  } : undefined;
}

function eventHistory(runId: string): TraceEvent[] {
  return all<{ raw_json: string }>(`SELECT raw_json FROM raw_trace_events WHERE run_id=? ORDER BY timestamp`, runId)
    .map((row) => parseJson<TraceEvent | null>(row.raw_json, null))
    .filter((event): event is TraceEvent => Boolean(event));
}

export class LocalRuntimeAdapter extends BaseLocalRuntimeAdapter {
  constructor() {
    super({
      workspacePath: runtimeWorkspace,
      importTrace: (jsonl) => { importTraceJsonl(jsonl); },
      eventHistory,
      getArtifacts,
      getRunStatus,
      listModelProviders
    });
  }
}

export const runtimeAdapter = new LocalRuntimeAdapter();
export type {
  RuntimeApprovalRequest,
  RuntimeApprovalResult,
  RuntimeAdapter,
  RuntimeRunInput,
  RuntimeRunSession,
  RuntimeStartOptions,
  RuntimeStatus,
  RunArtifact
};
