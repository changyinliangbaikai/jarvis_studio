import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TraceEvent } from '../../../../packages/trace-schema/src/events.ts';
import { createRuntimeIds, listSkills, runAgent, toolDefinitions, type RuntimeRequest, type RuntimeResult } from '../../../../packages/jarvis-runtime-lite/src/index.ts';
import { all, parseJson } from '../db/database.ts';
import { importTraceJsonl } from '../services/traceImportService.ts';
import { listModelProviders } from '../services/modelProviderService.ts';

const hub = new EventEmitter();
hub.setMaxListeners(100);
const activeRuns = new Map<string, Promise<RuntimeResult>>();

export const runtimeWorkspace = resolve(import.meta.dirname, '../../../../fixtures/runtime-workspace');
mkdirSync(runtimeWorkspace, { recursive: true });

export function runtimeCapabilities() {
  return {
    version: 'jarvis-runtime-lite@0.3.0',
    workspacePath: runtimeWorkspace,
    providers: listModelProviders().filter((provider) => provider.enabled).map((provider) => ({
      id: provider.id,
      label: provider.name,
      provider: provider.providerType,
      available: provider.enabled,
      model: provider.defaultModel,
      baseUrl: provider.baseUrl,
      source: provider.source,
      isDefault: provider.isDefault,
      lastTestStatus: provider.lastTestStatus
    })),
    skills: listSkills(),
    tools: toolDefinitions
  };
}

export function startRuntimeRun(input: Omit<RuntimeRequest, 'workspacePath'> & { workspacePath?: string }) {
  const ids = createRuntimeIds();
  const request: RuntimeRequest = { ...input, workspacePath: runtimeWorkspace };
  const promise = runAgent(request, {
    ids,
    onEvent: async (event) => {
      importTraceJsonl(JSON.stringify(event));
      hub.emit(ids.runId, event);
      hub.emit('*', event);
    }
  });
  activeRuns.set(ids.runId, promise);
  void promise.finally(() => {
    setTimeout(() => activeRuns.delete(ids.runId), 60_000).unref();
  });
  return { ids, promise };
}

export async function executeRuntimeRun(input: Omit<RuntimeRequest, 'workspacePath'> & { workspacePath?: string }) {
  const { promise } = startRuntimeRun(input);
  return promise;
}

export function subscribeToRun(runId: string, listener: (event: TraceEvent) => void) {
  hub.on(runId, listener);
  return () => hub.off(runId, listener);
}

export function runtimeEventHistory(runId: string) {
  return all<{ raw_json: string }>(`SELECT raw_json FROM raw_trace_events WHERE run_id=? ORDER BY timestamp`, runId)
    .map((row) => parseJson<TraceEvent | null>(row.raw_json, null))
    .filter((event): event is TraceEvent => Boolean(event));
}

export function isRuntimeActive(runId: string) {
  return activeRuns.has(runId);
}
