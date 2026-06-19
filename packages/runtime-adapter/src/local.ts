import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { createRuntimeIds, runAgent } from '@jarvis/agent-runtime';
import type { RuntimeApprovalRequest, RuntimeApprovalResult, RuntimeRequest, RuntimeResult } from '@jarvis/shared-types';
import { listSkills } from '@jarvis/skill-loader';
import { toolDefinitions } from '@jarvis/tool-registry';
import type { TraceEvent } from '@jarvis/trace-sdk';
import type { RunArtifact, RuntimeAdapter, RuntimeRunInput, RuntimeRunSession, RuntimeStartOptions, RuntimeStatus } from './adapter.ts';

interface ApprovalWaiter {
  request: RuntimeApprovalRequest;
  resolve: (decision: RuntimeApprovalResult) => void;
}

export interface LocalRuntimeAdapterDependencies {
  workspacePath: string;
  importTrace: (jsonl: string) => void | Promise<void>;
  eventHistory: (runId: string) => TraceEvent[];
  getArtifacts: (runId: string) => RunArtifact[] | Promise<RunArtifact[]>;
  getRunStatus: (runId: string) => Omit<RuntimeStatus, 'runId' | 'active' | 'status'> & { status?: string | null } | undefined | Promise<Omit<RuntimeStatus, 'runId' | 'active' | 'status'> & { status?: string | null } | undefined>;
  listModelProviders: () => Array<{
    id: string;
    name: string;
    providerType: string;
    enabled: boolean;
    defaultModel: string;
    baseUrl?: string;
    source?: string;
    isDefault?: boolean;
    lastTestStatus?: string;
  }>;
}

export class LocalRuntimeAdapter implements RuntimeAdapter {
  private readonly hub = new EventEmitter();
  private readonly activeRuns = new Map<string, Promise<RuntimeResult>>();
  private readonly pendingApprovals = new Map<string, ApprovalWaiter>();
  private readonly cancelledRuns = new Set<string>();

  constructor(private readonly deps: LocalRuntimeAdapterDependencies) {
    mkdirSync(deps.workspacePath, { recursive: true });
    this.hub.setMaxListeners(100);
  }

  capabilities() {
    return {
      version: 'agent-runtime@0.5.0',
      adapter: 'LocalRuntimeAdapter',
      workspacePath: this.deps.workspacePath,
      governance: {
        skillRegistry: 'skill-registry@0.5.0',
        toolRegistry: 'jarvis-runtime-tools@v0.5',
        contextStrategy: 'balanced-v1',
        policyVersion: 'default-local-policy@0.5.0'
      },
      providers: this.deps.listModelProviders().filter((provider) => provider.enabled).map((provider) => ({
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

  startRun(input: RuntimeRunInput, options: RuntimeStartOptions = {}): RuntimeRunSession {
    const ids = createRuntimeIds();
    const request: RuntimeRequest = { ...input, workspacePath: input.workspacePath ?? this.deps.workspacePath };
    const waitForApproval = options.waitForApproval
      ?? (options.useAdapterApproval ? (approvalRequest) => this.waitForAdapterApproval(approvalRequest) : undefined);
    const promise = runAgent(request, {
      ids,
      waitForApproval,
      onEvent: async (event) => {
        await this.deps.importTrace(JSON.stringify(event));
        this.hub.emit(ids.runId, event);
        this.hub.emit('*', event);
      }
    });
    this.activeRuns.set(ids.runId, promise);
    this.cancelledRuns.delete(ids.runId);
    void promise.finally(() => {
      setTimeout(() => this.activeRuns.delete(ids.runId), 60_000).unref();
    });
    return {
      ids,
      handle: {
        ids,
        runId: ids.runId,
        status: 'running',
        startedAt: new Date().toISOString(),
        eventsUrl: `/api/runtime/runs/${ids.runId}/events`
      },
      promise
    };
  }

  async *streamEvents(runId: string): AsyncIterable<TraceEvent> {
    const queue: TraceEvent[] = [];
    let wake: (() => void) | undefined;
    let completed = false;
    const unsubscribe = this.subscribeToRun(runId, (event) => {
      queue.push(event);
      if (event.eventType === 'run.end') completed = true;
      wake?.();
      wake = undefined;
    });
    try {
      for (const event of this.eventHistory(runId)) {
        yield event;
        if (event.eventType === 'run.end') completed = true;
      }
      if (!this.isActive(runId)) completed = true;
      while (!completed || queue.length) {
        if (!queue.length) await new Promise<void>((resolvePromise) => { wake = resolvePromise; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      unsubscribe();
    }
  }

  async approve(approvalId: string, decision: RuntimeApprovalResult) {
    const waiter = this.pendingApprovals.get(approvalId);
    if (!waiter) throw new Error(`Runtime Approval 不存在或已处理: ${approvalId}`);
    this.pendingApprovals.delete(approvalId);
    waiter.resolve(decision);
    return { ok: true as const, approvalId };
  }

  async cancel(runId: string) {
    this.cancelledRuns.add(runId);
    return { ok: true as const, runId, status: 'cancel_requested' as const };
  }

  async getArtifacts(runId: string) {
    return this.deps.getArtifacts(runId);
  }

  async getRunStatus(runId: string): Promise<RuntimeStatus> {
    const row = await this.deps.getRunStatus(runId);
    return {
      runId,
      status: this.cancelledRuns.has(runId) ? 'cancel_requested' : row?.status ?? (this.isActive(runId) ? 'running' : 'unknown'),
      active: this.isActive(runId),
      startedAt: row?.startedAt,
      endedAt: row?.endedAt,
      error: row?.error
    };
  }

  subscribeToRun(runId: string, listener: (event: TraceEvent) => void) {
    this.hub.on(runId, listener);
    return () => this.hub.off(runId, listener);
  }

  eventHistory(runId: string) {
    return this.deps.eventHistory(runId);
  }

  isActive(runId: string) {
    return this.activeRuns.has(runId);
  }

  private waitForAdapterApproval(request: RuntimeApprovalRequest) {
    return new Promise<RuntimeApprovalResult>((resolvePromise) => {
      this.pendingApprovals.set(request.approvalId, { request, resolve: resolvePromise });
    });
  }
}
