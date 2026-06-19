import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let importTraceJsonl: typeof import('./traceImportService.ts').importTraceJsonl;
let importEvalYaml: typeof import('./evalService.ts').importEvalYaml;
let get: typeof import('../db/database.ts').get;
let createModelProvider: typeof import('./modelProviderService.ts').createModelProvider;
let updateModelProvider: typeof import('./modelProviderService.ts').updateModelProvider;
let deleteModelProvider: typeof import('./modelProviderService.ts').deleteModelProvider;
let listModelProviders: typeof import('./modelProviderService.ts').listModelProviders;
let resolveModelProvider: typeof import('./modelProviderService.ts').resolveModelProvider;
let testModelProvider: typeof import('./modelProviderService.ts').testModelProvider;
let testModelProviderDraft: typeof import('./modelProviderService.ts').testModelProviderDraft;
let evalService: typeof import('./evalService.ts');
let recordFailure: typeof import('./failureService.ts').recordFailure;
let compareEvalRuns: typeof import('./compareService.ts').compareEvalRuns;
let modelProviderRoutes: typeof import('../routes/modelProviders.ts').modelProviderRoutes;
let governanceRoutes: typeof import('../routes/governance.ts').governanceRoutes;
let workbenchService: typeof import('./workbenchService.ts');
let LocalRuntimeAdapter: typeof import('../runtime/runtimeAdapter.ts').LocalRuntimeAdapter;

beforeAll(async () => {
  process.env.JARVIS_STUDIO_DB = join(mkdtempSync(join(tmpdir(), 'jarvis-studio-test-')), 'test.db');
  process.env.JARVIS_STUDIO_PROVIDER_KEY = 'provider-test-key';
  ({ importTraceJsonl } = await import('./traceImportService.ts'));
  evalService = await import('./evalService.ts');
  ({ importEvalYaml } = evalService);
  ({ get } = await import('../db/database.ts'));
  ({ createModelProvider, updateModelProvider, deleteModelProvider, listModelProviders, resolveModelProvider, testModelProvider, testModelProviderDraft } = await import('./modelProviderService.ts'));
  ({ recordFailure } = await import('./failureService.ts'));
  ({ compareEvalRuns } = await import('./compareService.ts'));
  ({ modelProviderRoutes } = await import('../routes/modelProviders.ts'));
  ({ governanceRoutes } = await import('../routes/governance.ts'));
  ({ LocalRuntimeAdapter } = await import('../runtime/runtimeAdapter.ts'));
  workbenchService = await import('./workbenchService.ts');
});

describe('trace import service', () => {
  it('validates, preserves, and maps trace events', () => {
    const events = [
      { eventId: 'e1', eventType: 'run.start', timestamp: '2026-06-15T00:00:00.000Z', sessionId: 's1', runId: 'r1', payload: { name: 'test run', model: 'mock' } },
      { eventId: 'e2', eventType: 'context.build', timestamp: '2026-06-15T00:00:01.000Z', runId: 'r1', spanId: 'sp1', payload: { contextSnapshotId: 'c1', totalTokens: 10, maxContextTokens: 100, segments: [{ id: 'seg1', type: 'system_prompt', name: 'base', tokens: 10, included: true }] } },
      { eventId: 'e3', eventType: 'tool.call', timestamp: '2026-06-15T00:00:02.000Z', runId: 'r1', spanId: 'sp2', payload: { toolCallId: 't1', tool: 'demo.tool', execution: { success: true } } },
      { eventId: 'e4', eventType: 'run.end', timestamp: '2026-06-15T00:00:03.000Z', sessionId: 's1', runId: 'r1', payload: { status: 'success', totalTokens: 10 } }
    ];
    expect(importTraceJsonl(events.map((event) => JSON.stringify(event)).join('\n'))).toEqual({ importedEvents: 4, runIds: ['r1'] });
    expect(get<{ status: string }>('SELECT status FROM runs WHERE id=?', 'r1')?.status).toBe('success');
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM raw_trace_events')?.n).toBe(4);
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM context_segments')?.n).toBe(1);
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM tool_calls')?.n).toBe(1);
  });

  it('rejects invalid JSONL with a useful line number', () => {
    expect(() => importTraceJsonl('{"eventId":"missing-fields"}')).toThrow('第 1 行');
  });

  it('maps v0.4 governance events into dedicated tables', () => {
    const events = [
      { eventId: 'g1', eventType: 'run.start', timestamp: '2026-06-15T01:00:00.000Z', sessionId: 'sg1', turnId: 'tg1', runId: 'rg1', payload: { name: 'governed run', model: 'deterministic-local' } },
      { eventId: 'g2', eventType: 'skill.select', timestamp: '2026-06-15T01:00:01.000Z', sessionId: 'sg1', turnId: 'tg1', runId: 'rg1', payload: { selected_skill_id: 'weekly-report', candidates: [{ skillId: 'weekly-report', score: 0.95, matchedBy: ['explicit_request'], status: 'selected' }] } },
      { eventId: 'g3', eventType: 'context.build', timestamp: '2026-06-15T01:00:02.000Z', sessionId: 'sg1', turnId: 'tg1', runId: 'rg1', payload: { contextSnapshotId: 'cg1', budgetStrategy: 'balanced-v1', totalTokensBeforeBudget: 120, totalTokensAfterBudget: 80, totalTokens: 80, maxContextTokens: 1000, risks: [{ severity: 'medium', message: 'risk' }], segments: [{ id: 'seg_g1', type: 'conversation_history', name: 'history', tokensBefore: 120, tokensAfter: 80, tokens: 80, action: 'summarize', included: true, priority: 60 }] } },
      { eventId: 'g4', eventType: 'tool.policy.check', timestamp: '2026-06-15T01:00:03.000Z', sessionId: 'sg1', turnId: 'tg1', runId: 'rg1', payload: { decision_id: 'perm_g1', tool_call_id: 'call_g1', tool_id: 'shell.run', riskLevel: 'high', decision: 'approve', reason: 'needs approval', policyId: 'default-local-policy@0.4.0:approve-high-risk', requestedPermissions: ['process.shell'], argumentsSummary: { cmd: 'echo hi' } } },
      { eventId: 'g5', eventType: 'failure.detected', timestamp: '2026-06-15T01:00:04.000Z', sessionId: 'sg1', turnId: 'tg1', runId: 'rg1', payload: { failure_type: 'permission_denied', severity: 'high', summary: 'approval required', evidence: [{ toolCallId: 'call_g1' }], suggested_fix: 'approve or deny' } },
      { eventId: 'g6', eventType: 'replay.snapshot.created', timestamp: '2026-06-15T01:00:05.000Z', sessionId: 'sg1', turnId: 'tg1', runId: 'rg1', payload: { snapshot_id: 'snap_g1', snapshot: { input: { userMessage: 'hello' }, versions: { contextStrategy: 'balanced-v1' } } } },
      { eventId: 'g7', eventType: 'run.end', timestamp: '2026-06-15T01:00:06.000Z', sessionId: 'sg1', turnId: 'tg1', runId: 'rg1', payload: { status: 'failed', totalTokens: 80 } }
    ];
    expect(importTraceJsonl(events.map((event) => JSON.stringify(event)).join('\n'))).toEqual({ importedEvents: 7, runIds: ['rg1'] });
    expect(get<{ selected_skill_id: string }>('SELECT selected_skill_id FROM skill_selection_events WHERE id=?', 'g2')?.selected_skill_id).toBe('weekly-report');
    expect(get<{ decision: string }>('SELECT decision FROM permission_decisions WHERE id=?', 'perm_g1')?.decision).toBe('approve');
    expect(get<{ type: string }>('SELECT type FROM failures WHERE id=?', 'g5')?.type).toBe('permission_denied');
    expect(get<{ id: string }>('SELECT id FROM replay_snapshots WHERE id=?', 'snap_g1')?.id).toBe('snap_g1');
    expect(get<{ tokens_after: number; action: string }>('SELECT tokens_after, action FROM context_segments WHERE id=?', 'seg_g1')).toMatchObject({ tokens_after: 80, action: 'summarize' });
  });

  it('imports an Eval Case YAML document', () => {
    const imported = importEvalYaml(`
id: yaml_001
name: YAML import
category: smoke
input: { message: test, files: [] }
expected: { mustCallTools: [], mustGenerate: [], mustInclude: [], mustNotInclude: [], constraints: {} }
scoring: { maxScore: 5, dimensions: [] }
releaseGate: { minScore: 4 }
`);
    expect(imported[0]?.id).toBe('yaml_001');
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM eval_cases')?.n).toBe(1);
  });

  it('stores encrypted provider secrets, tests connections, and resolves Runtime profiles', async () => {
    const created = createModelProvider({
      name: 'Test Gateway',
      baseUrl: 'https://gateway.example.test/v1/',
      apiKey: 'sk-private-value',
      defaultModel: 'test-model',
      enabled: true,
      isDefault: true,
      inputPricePer1MTokens: 2.5,
      outputPricePer1MTokens: 10,
      currency: 'USD'
    });
    expect(created?.apiKeyHint).toBe('••••alue');
    expect(JSON.stringify(created)).not.toContain('sk-private-value');
    expect(created).toMatchObject({ inputPricePer1MTokens: 2.5, outputPricePer1MTokens: 10, currency: 'USD' });
    expect(resolveModelProvider(created!.id).profile).toMatchObject({
      provider: 'openai-compatible',
      model: 'test-model',
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: 'sk-private-value'
    });

    const result = await testModelProvider(created!.id, async () =>
      new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(result).toMatchObject({ status: 'healthy', modelCount: 1 });

    let draftRequest: { url?: string; authorization?: string } = {};
    const draftResult = await testModelProviderDraft({
      providerId: created!.id,
      name: 'Unsaved Draft',
      baseUrl: 'https://draft.example.test/v1',
      defaultModel: 'draft-model',
      enabled: true
    }, async (input, init) => {
      draftRequest = { url: String(input), authorization: new Headers(init?.headers).get('authorization') ?? undefined };
      return new Response(JSON.stringify({ data: [{ id: 'draft-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(draftResult).toMatchObject({ status: 'healthy', modelCount: 1 });
    expect(draftRequest).toEqual({ url: 'https://draft.example.test/v1/models', authorization: 'Bearer sk-private-value' });
    expect(resolveModelProvider(created!.id).profile.baseUrl).toBe('https://gateway.example.test/v1');

    const emptyResult = await testModelProviderDraft({
      name: 'Empty Response Gateway',
      baseUrl: 'https://empty.example.test/v1',
      defaultModel: 'empty-model',
      enabled: true
    }, async () => new Response('', { status: 200 }));
    expect(emptyResult).toMatchObject({ status: 'healthy', modelCount: 0, message: '连接成功，但 /models 返回空响应' });

    const textResult = await testModelProviderDraft({
      name: 'Text Response Gateway',
      baseUrl: 'https://text.example.test/v1',
      defaultModel: 'text-model',
      enabled: true
    }, async () => new Response('service is ready', { status: 200, headers: { 'content-type': 'text/plain' } }));
    expect(textResult).toMatchObject({ status: 'healthy', modelCount: 0, message: '连接成功，但 /models 返回非 JSON 响应（text/plain）' });

    const alternateResult = await testModelProviderDraft({
      name: 'Alternate Gateway',
      baseUrl: 'https://alternate.example.test/v1',
      defaultModel: 'alternate-model',
      enabled: true
    }, async () => new Response(JSON.stringify({ models: [{ id: 'a' }, { id: 'b' }] }), { status: 200 }));
    expect(alternateResult).toMatchObject({ status: 'healthy', modelCount: 2 });

    updateModelProvider(created!.id, {
      name: 'Renamed Gateway',
      baseUrl: 'https://gateway.example.test/v1',
      defaultModel: 'test-model-2',
      enabled: true,
      isDefault: true,
      inputPricePer1MTokens: 2.5,
      outputPricePer1MTokens: 10,
      currency: 'USD'
    });
    expect(resolveModelProvider(created!.id).profile.apiKey).toBe('sk-private-value');
    expect(listModelProviders().find((item) => item.id === created!.id)?.lastTestStatus).toBe('healthy');
    expect(deleteModelProvider(created!.id)).toEqual({ ok: true });
  });

  it('starts a test run through LocalRuntimeAdapter, streams trace events, handles approval, and returns artifacts', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'jarvis-runtime-adapter-'));
    execFileSync('git', ['init'], { cwd: workspacePath });
    const adapter = new LocalRuntimeAdapter();
    const streamed: string[] = [];
    const { ids, promise } = adapter.startRun({
      name: 'RuntimeAdapter Approval Smoke',
      message: '验证审批暂停恢复',
      skill: 'approval-demo',
      workspacePath,
      modelProfile: { provider: 'deterministic', model: 'deterministic-local' }
    }, { useAdapterApproval: true });
    const streamTask = (async () => {
      for await (const event of adapter.streamEvents(ids.runId)) {
        streamed.push(event.eventType);
        if (event.eventType === 'run.pause_for_approval') {
          void adapter.approve(String(event.payload.approvalId), { decision: 'approved', note: 'adapter smoke approval' });
        }
        if (event.eventType === 'run.end') break;
      }
    })();
    const result = await promise;
    await streamTask;
    expect(result.status).toBe('success');
    expect(streamed).toContain('run.pause_for_approval');
    expect(streamed).toContain('run.resume_after_approval');
    expect(streamed).toContain('run.end');
    await expect(adapter.getRunStatus(ids.runId)).resolves.toMatchObject({ runId: ids.runId, active: true });

    mkdirSync(join(workspacePath, 'input'), { recursive: true });
    writeFileSync(join(workspacePath, 'input', 'weekly_raw.txt'), '本周完成：完成 RuntimeAdapter 调整。\n下周计划：验证评测流程。');
    const artifactRun = adapter.startRun({
      name: 'RuntimeAdapter Artifact Smoke',
      message: '根据输入生成周报',
      skill: 'weekly-report',
      files: ['input/weekly_raw.txt'],
      workspacePath,
      modelProfile: { provider: 'deterministic', model: 'deterministic-local' }
    });
    const artifactResult = await artifactRun.promise;
    expect(artifactResult.status).toBe('success');
    await expect(adapter.getArtifacts(artifactRun.ids.runId)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'output/weekly_report.md' })])
    );
  });

  it('prints safe backend diagnostics when a saved provider connection test throws', async () => {
    const app = Fastify({ logger: false });
    await app.register(modelProviderRoutes);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/model-providers/missing-provider/test' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: 'Provider 不存在或为只读配置' });
      const output = consoleError.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(output).toContain('[jarvis:model-provider:error]');
      expect(output).toContain('"event":"connection_test.route_error"');
      expect(output).toContain('"providerId":"missing-provider"');
      expect(output).toContain('"stack":');
    } finally {
      consoleError.mockRestore();
      await app.close();
    }
  });

  it('defaults remote Eval Runs to serial execution with transient 503 retries', async () => {
    evalService.importEvalDatasetYaml(`
id: retry_dataset_v1
name: Retry Dataset
version: 1.0.0
category: smoke
cases:
  - id: retry_weekly_001
    name: Retry weekly report
    category: writing
    priority: p0
    input:
      message: 生成包含本周完成和下周计划的周报
      files: []
    expected:
      must_call_tools: [filesystem.write]
      must_generate_artifacts: [{ type: markdown, nameContains: weekly_report }]
      must_include: [本周完成, 下周计划]
    scoring: { max_score: 5 }
    pass_criteria: { min_total_score: 4 }
`);
    const provider = createModelProvider({
      name: 'Retry Gateway',
      baseUrl: 'https://retry.example.test/v1',
      apiKey: 'sk-retry-private-value',
      defaultModel: 'retry-model',
      enabled: true,
      inputPricePer1MTokens: 0,
      outputPricePer1MTokens: 0,
      currency: 'USD'
    })!;
    const originalFetch = globalThis.fetch;
    let chatCalls = 0;
    globalThis.fetch = vi.fn(async () => {
      chatCalls += 1;
      if (chatCalls <= 2) return new Response('temporary overloaded', { status: 503, headers: { 'x-request-id': `retry-${chatCalls}` } });
      const payload = chatCalls === 3
        ? { choices: [{ message: { content: '', tool_calls: [{ id: 'call_write', function: { name: 'filesystem_write', arguments: JSON.stringify({ path: 'output/weekly_report.md', content: '# 周报\n\n## 本周完成\n已完成。\n\n## 下周计划\n继续推进。' }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
        : { choices: [{ message: { content: '# 周报\n\n## 本周完成\n已完成。\n\n## 下周计划\n继续推进。' } }], usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 } };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const created = evalService.createEvalRuns({ datasetId: 'retry_dataset_v1', modelProviderId: provider.id })[0]!;
      const savedConfig = JSON.parse(String(get<{ config_json: string }>('SELECT config_json FROM eval_runs WHERE id=?', String(created.id))?.config_json));
      expect(savedConfig).toMatchObject({ modelProviderId: provider.id, modelName: 'retry-model', maxParallel: 1, retryCount: 2 });
      const done = await waitForEvalRun(String(created.id));
      expect(done).toMatchObject({ status: 'completed', totalCases: 1, passedCases: 1, passRate: 1 });
      expect(chatCalls).toBeGreaterThanOrEqual(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('protects remote Eval Runs from user-supplied parallel no-retry settings', async () => {
    evalService.importEvalDatasetYaml(`
id: throttled_dataset_v1
name: Throttled Dataset
version: 1.0.0
category: smoke
cases:
  - id: throttled_weekly_001
    name: Throttled weekly report
    category: writing
    priority: p1
    input:
      message: 生成包含本周完成和下周计划的周报
      files: []
    expected:
      must_call_tools: [filesystem.write]
      must_generate_artifacts: [{ type: markdown, nameContains: weekly_report }]
      must_include: [本周完成, 下周计划]
    scoring: { max_score: 5 }
    pass_criteria: { min_total_score: 4 }
`);
    const provider = createModelProvider({
      name: 'Throttled Gateway',
      baseUrl: 'https://throttled.example.test/v1',
      apiKey: 'sk-throttled-private-value',
      defaultModel: 'throttled-model',
      enabled: true
    })!;
    const originalFetch = globalThis.fetch;
    let chatCalls = 0;
    globalThis.fetch = vi.fn(async () => {
      chatCalls += 1;
      const payload = chatCalls % 2 === 1
        ? { choices: [{ message: { content: '', tool_calls: [{ id: 'call_write', function: { name: 'filesystem_write', arguments: JSON.stringify({ path: 'output/weekly_report.md', content: '# 周报\n\n## 本周完成\n已完成。\n\n## 下周计划\n继续推进。' }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
        : { choices: [{ message: { content: '# 周报\n\n## 本周完成\n已完成。\n\n## 下周计划\n继续推进。' } }], usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 } };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const created = evalService.createEvalRuns({
        datasetId: 'throttled_dataset_v1',
        modelProviderId: provider.id,
        maxParallel: 3,
        retryCount: 0
      })[0]!;
      const savedConfig = JSON.parse(String(get<{ config_json: string }>('SELECT config_json FROM eval_runs WHERE id=?', String(created.id))?.config_json));
      expect(savedConfig).toMatchObject({ maxParallel: 1, retryCount: 2 });
      await waitForEvalRun(String(created.id));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exposes v0.4 governance mutation APIs with audit records', async () => {
    const app = Fastify({ logger: false });
    await app.register(governanceRoutes);
    try {
      const skillTest = await app.inject({ method: 'POST', url: '/api/skills/weekly-report/test', payload: {} });
      expect(skillTest.statusCode).toBe(200);
      expect(skillTest.json()).toMatchObject({ skillId: 'weekly-report', status: 'success' });
      const skillTestRunId = skillTest.json().runId as string;

      const disableTool = await app.inject({ method: 'POST', url: '/api/tools/filesystem.read/disable' });
      expect(disableTool.statusCode).toBe(200);
      expect(disableTool.json()).toMatchObject({ id: 'filesystem.read', enabled: false });
      const enableTool = await app.inject({ method: 'POST', url: '/api/tools/filesystem.read/enable' });
      expect(enableTool.statusCode).toBe(200);
      expect(enableTool.json()).toMatchObject({ id: 'filesystem.read', enabled: true });
      const updateToolPolicy = await app.inject({
        method: 'PATCH',
        url: '/api/tools/filesystem.read/policy',
        payload: { riskLevel: 'high', defaultPolicy: 'approve', enabled: true }
      });
      expect(updateToolPolicy.statusCode).toBe(200);
      expect(updateToolPolicy.json()).toMatchObject({ id: 'filesystem.read', riskLevel: 'high', defaultPolicy: 'approve', enabled: true });

      const policy = await app.inject({
        method: 'POST',
        url: '/api/permissions/policies',
        payload: { id: 'strict-local-test', name: 'Strict Local Test', config: { rules: [{ id: 'deny-network', decision: 'deny' }] } }
      });
      expect(policy.statusCode).toBe(200);
      expect(policy.json()).toMatchObject({ id: 'strict-local-test', enabled: true });

      const replay = await app.inject({
        method: 'POST',
        url: `/api/runs/${skillTestRunId}/replay-with-overrides`,
        payload: { promptVersion: 'base-agent@v0.4', contextStrategy: 'balanced-v1', toolPolicy: 'strict-local-test' }
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().changedDimensions).toContain('toolPolicy');

      const failure = recordFailure({
        runId: 'runtime_governance_api_test',
        type: 'tool_execution_error',
        severity: 'medium',
        summary: 'governance api test failure'
      })!;
      const linked = await app.inject({
        method: 'POST',
        url: `/api/failures/${failure.id}/link-fix`,
        payload: { skillVersion: 'weekly-report@v0.2', note: 'covered by governance API test' }
      });
      expect(linked.statusCode).toBe(200);
      expect(linked.json().fixLinks.at(-1)).toMatchObject({ skillVersion: 'weekly-report@v0.2' });

      const audit = await app.inject({ method: 'GET', url: '/api/audit-logs' });
      expect(audit.statusCode).toBe(200);
      const actions = audit.json().map((item: { action: string }) => item.action);
      expect(actions).toContain('skill.test');
      expect(actions).toContain('tool.policy.update');
      expect(actions).toContain('permission_policy.save');
      expect(actions).toContain('replay.run');
    } finally {
      await app.close();
    }
  });

  it('runs the v0.3 evaluation, human review, gate, compare, and report workflow', async () => {
    const root = resolve(import.meta.dirname, '../../../..');
    evalService.importEvalDatasetDirectory(resolve(root, 'fixtures/evals/smoke'));
    evalService.importEvalDatasetYaml(
      readFileSync(resolve(root, 'fixtures/evals/regression/dataset.yaml'), 'utf8'),
      [readFileSync(resolve(root, 'fixtures/evals/builtin.yaml'), 'utf8')]
    );
    expect(evalService.getEvalDataset('jarvis_smoke_v1')?.caseCount).toBe(5);
    expect(evalService.getEvalDataset('jarvis_regression_v1')?.caseCount).toBe(15);
    expect(() => evalService.createEvalRuns({
      datasetId: 'jarvis_smoke_v1',
      matrix: {
        modelProviderIds: ['builtin-deterministic', 'builtin-deterministic', 'builtin-deterministic'],
        modelNames: ['a', 'b', 'c'],
        promptVersions: ['p1', 'p2', 'p3']
      }
    })).toThrow('max_matrix_runs=20');
    const matrixRun = evalService.createEvalRuns({
      datasetId: 'jarvis_smoke_v1',
      caseIds: ['weekly_smoke_001'],
      modelProviderId: 'builtin-deterministic',
      matrix: {
        skillVersions: ['weekly-report'],
        contextStrategies: ['balanced-v1'],
        toolPolicies: ['strict-local-test']
      }
    })[0]!;
    const matrixBinding = get<{ config_json: string; version_hashes_json: string }>('SELECT config_json, version_hashes_json FROM eval_runs WHERE id=?', String(matrixRun.id));
    expect(JSON.parse(String(matrixBinding?.config_json))).toMatchObject({ skillVersion: 'weekly-report', contextStrategy: 'balanced-v1', toolPolicy: 'strict-local-test' });
    expect(JSON.parse(String(matrixBinding?.version_hashes_json))).toHaveProperty('toolPolicyHash');
    const gate = evalService.importReleaseGateYaml(readFileSync(resolve(root, 'fixtures/evals/release-gates/jarvis_regression_release_gate.yaml'), 'utf8'));
    const first = evalService.createEvalRuns({
      datasetId: 'jarvis_smoke_v1',
      caseIds: ['weekly_smoke_001', 'tool_smoke_001'],
      modelProviderId: 'builtin-deterministic',
      enableLlmJudge: true,
      maxParallel: 2
    })[0]!;
    const second = evalService.createEvalRuns({
      datasetId: 'jarvis_smoke_v1',
      caseIds: ['weekly_smoke_001', 'tool_smoke_001'],
      modelProviderId: 'builtin-deterministic',
      maxParallel: 1
    })[0]!;
    const firstDone = await waitForEvalRun(String(first.id));
    const secondDone = await waitForEvalRun(String(second.id));
    expect(firstDone).toMatchObject({ status: 'completed', totalCases: 2, passedCases: 2, passRate: 1 });
    expect(firstDone.results.every((item) => item.runId && item.ruleScore === 5 && item.llmJudgeScore === 5)).toBe(true);
    const reviewed = evalService.saveHumanReview(String(firstDone.results[0]!.id), { score: 5, issueTags: [], comment: '人工复核通过' });
    expect(reviewed?.humanReview).toMatchObject({ score: 5, comment: '人工复核通过' });
    expect(evalService.evaluateGate(String(gate?.id), String(first.id))?.passed).toBe(true);
    expect(compareEvalRuns(String(first.id), String(second.id))).toMatchObject({ summary: { regressed: 0 } });
    const report = evalService.generateEvalReport(String(first.id));
    expect(report.markdown).toContain('Jarvis Eval Report');
    expect(report.markdown).toContain('人工 Review 摘要');
  });

  it('runs weekly report, code review, and approval pause/resume task scenarios', async () => {
    const weeklyRoot = mkdtempSync(join(tmpdir(), 'jarvis-weekly-task-'));
    mkdirSync(join(weeklyRoot, 'input'), { recursive: true });
    writeFileSync(join(weeklyRoot, 'input', 'weekly_raw.txt'), [
      '完成 Workspace、Task、Artifact 页面建设。',
      '问题与风险：Approval resume 需要回归验证。',
      '下周计划：补齐 Task Compare 和 Dashboard 指标。'
    ].join('\n'));
    const weeklyWorkspace = workbenchService.createWorkspace({ name: 'Weekly Test Workspace', rootPath: weeklyRoot });
    const weeklyTask = workbenchService.createTask({
      workspaceId: weeklyWorkspace.id,
      title: 'Weekly E2E',
      scenarioTemplateId: 'scenario_weekly_report',
      inputFiles: ['input/weekly_raw.txt'],
      message: '根据输入生成周报'
    })!;
    workbenchService.startTask(weeklyTask.id);
    const finishedWeekly = await waitForTask(weeklyTask.id, ['success', 'failed']);
    expect(finishedWeekly.status).toBe('success');
    expect(finishedWeekly.artifacts.some((artifact) => artifact.path.endsWith('weekly_report.md'))).toBe(true);
    expect(finishedWeekly.artifacts.some((artifact) => artifact.path.endsWith('weekly_report.docx'))).toBe(true);
    expect(finishedWeekly.artifacts.every((artifact) => artifact.workspaceId === weeklyWorkspace.id && artifact.taskId === weeklyTask.id && artifact.runId && artifact.toolCallId)).toBe(true);
    const weeklyMarkdown = finishedWeekly.artifacts.find((artifact) => artifact.path.endsWith('weekly_report.md'))!;
    expect(String(workbenchService.previewArtifact(weeklyMarkdown.id).text)).toContain('问题与风险');
    expect(finishedWeekly.toolCalls.length).toBeGreaterThanOrEqual(3);
    expect(finishedWeekly.contextSnapshots.length).toBeGreaterThan(0);

    const reviewRoot = mkdtempSync(join(tmpdir(), 'jarvis-review-task-'));
    execFileSync('git', ['init'], { cwd: reviewRoot });
    mkdirSync(join(reviewRoot, 'src'), { recursive: true });
    writeFileSync(join(reviewRoot, 'src', 'sample.ts'), 'export const value = 1;\n');
    execFileSync('git', ['add', 'src/sample.ts'], { cwd: reviewRoot });
    writeFileSync(join(reviewRoot, 'src', 'sample.ts'), 'export const value = Number.NaN;\n');
    const reviewWorkspace = workbenchService.createWorkspace({ name: 'Review Test Workspace', rootPath: reviewRoot });
    const reviewTask = workbenchService.createTask({
      workspaceId: reviewWorkspace.id,
      title: 'Code Review E2E',
      scenarioTemplateId: 'scenario_code_review',
      message: '审查当前 git diff'
    })!;
    workbenchService.startTask(reviewTask.id);
    const finishedReview = await waitForTask(reviewTask.id, ['success', 'failed']);
    expect(finishedReview.status).toBe('success');
    expect(finishedReview.artifacts.some((artifact) => artifact.path.endsWith('code_review.md'))).toBe(true);
    expect(String(workbenchService.previewArtifact(finishedReview.artifacts[0]!.id).text)).toContain('git diff');

    const dashboard = workbenchService.getWorkbenchDashboard();
    expect(dashboard.totals.tasks).toBeGreaterThanOrEqual(2);
    expect(dashboard.metrics.taskCompletionRate).toBeGreaterThan(0);
    expect(dashboard.metrics.artifactGenerationRate).toBeGreaterThan(0);
    expect(dashboard.scenarioStats.some((scenario) => scenario.id === 'scenario_weekly_report')).toBe(true);

    const comparison = workbenchService.compareTasks(weeklyTask.id, reviewTask.id);
    expect(comparison.summary.changedDimensions).toBeGreaterThan(0);
    expect(comparison.dimensions.some((item) => item.key === 'skill' && !item.same)).toBe(true);
    expect(comparison.artifactDiff.added.length + comparison.artifactDiff.removed.length).toBeGreaterThan(0);

    const approvalRoot = mkdtempSync(join(tmpdir(), 'jarvis-approval-task-'));
    execFileSync('git', ['init'], { cwd: approvalRoot });
    const approvalWorkspace = workbenchService.createWorkspace({ name: 'Approval Test Workspace', rootPath: approvalRoot });
    const approvalTask = workbenchService.createTask({
      workspaceId: approvalWorkspace.id,
      title: 'Approval Pause E2E',
      selectedSkillId: 'approval-demo',
      message: '验证审批暂停恢复'
    })!;
    workbenchService.startTask(approvalTask.id);
    const paused = await waitForTask(approvalTask.id, ['waiting_approval', 'failed']);
    expect(paused.status).toBe('waiting_approval');
    const approval = workbenchService.listApprovals({ taskId: approvalTask.id, status: 'pending' })[0]!;
    expect(approval.requestedAction).toBe('shell.safe_run');
    const pausedRunId = paused.currentRunId;
    workbenchService.approveApproval(approval.id, { approvedBy: 'vitest', note: 'approve shell.safe_run for resume' });
    const finishedApproval = await waitForTask(approvalTask.id, ['success', 'failed']);
    expect(finishedApproval.status).toBe('success');
    expect(finishedApproval.currentRunId).toBe(pausedRunId);
    expect(finishedApproval.events.some((event) => event.type === 'run.pause_for_approval')).toBe(true);
    expect(finishedApproval.events.some((event) => event.type === 'run.resume_after_approval')).toBe(true);
  });
});

async function waitForTask(taskId: string, statuses: string[], timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const task = workbenchService.getTask(taskId)!;
    if (statuses.includes(task.status)) return task;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for task ${taskId}; last status=${task.status}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForEvalRun(id: string) {
  for (let index = 0; index < 500; index += 1) {
    const item = evalService.getEvalRun(id)!;
    if (['completed', 'failed', 'cancelled'].includes(String(item.status))) return item;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Eval Run ${id} did not finish`);
}
