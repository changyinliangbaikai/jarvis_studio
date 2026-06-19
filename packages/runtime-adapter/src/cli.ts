import type { RuntimeAdapter, RuntimeRunInput, RuntimeRunSession, RuntimeStartOptions } from './adapter.ts';
import type { RuntimeApprovalResult } from '@jarvis/shared-types';
import type { TraceEvent } from '@jarvis/trace-sdk';

export class CliRuntimeAdapter implements RuntimeAdapter {
  capabilities() {
    return { adapter: 'CliRuntimeAdapter', status: 'placeholder', implementation: 'v0.2' };
  }

  startRun(_input: RuntimeRunInput, _options: RuntimeStartOptions = {}): RuntimeRunSession {
    throw new Error('CliRuntimeAdapter is reserved for v0.2 process-spawn execution.');
  }

  async *streamEvents(_runId: string): AsyncIterable<TraceEvent> {
    return;
  }

  async approve(approvalId: string, _decision: RuntimeApprovalResult): Promise<{ ok: true; approvalId: string }> {
    throw new Error(`CliRuntimeAdapter does not manage approval ${approvalId} in v0.1.`);
  }

  async cancel(runId: string) {
    return { ok: true as const, runId, status: 'cancel_requested' as const };
  }

  async getArtifacts(_runId: string) {
    return [];
  }

  async getRunStatus(runId: string) {
    return { runId, status: 'unknown', active: false };
  }
}
