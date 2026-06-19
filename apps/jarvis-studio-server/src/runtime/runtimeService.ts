import type { RuntimeResult } from '@jarvis/agent-runtime';
import type { TraceEvent } from '@jarvis/trace-sdk';
import {
  runtimeAdapter,
  runtimeWorkspace,
  type RuntimeRunInput,
  type RuntimeStartOptions
} from './runtimeAdapter.ts';

export { runtimeAdapter, runtimeWorkspace, type RuntimeStartOptions };

export function runtimeCapabilities() {
  return runtimeAdapter.capabilities();
}

export function startRuntimeRun(input: RuntimeRunInput, options: RuntimeStartOptions = {}) {
  return runtimeAdapter.startRun(input, options);
}

export async function executeRuntimeRun(input: RuntimeRunInput): Promise<RuntimeResult> {
  const { promise } = startRuntimeRun(input);
  return promise;
}

export function subscribeToRun(runId: string, listener: (event: TraceEvent) => void) {
  return runtimeAdapter.subscribeToRun(runId, listener);
}

export function runtimeEventHistory(runId: string) {
  return runtimeAdapter.eventHistory(runId);
}

export function isRuntimeActive(runId: string) {
  return runtimeAdapter.isActive(runId);
}
