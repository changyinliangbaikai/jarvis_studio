import { mkdtempSync, readFileSync } from 'node:fs';
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
let compareEvalRuns: typeof import('./compareService.ts').compareEvalRuns;
let modelProviderRoutes: typeof import('../routes/modelProviders.ts').modelProviderRoutes;

beforeAll(async () => {
  process.env.JARVIS_STUDIO_DB = join(mkdtempSync(join(tmpdir(), 'jarvis-studio-test-')), 'test.db');
  process.env.JARVIS_STUDIO_PROVIDER_KEY = 'provider-test-key';
  ({ importTraceJsonl } = await import('./traceImportService.ts'));
  evalService = await import('./evalService.ts');
  ({ importEvalYaml } = evalService);
  ({ get } = await import('../db/database.ts'));
  ({ createModelProvider, updateModelProvider, deleteModelProvider, listModelProviders, resolveModelProvider, testModelProvider, testModelProviderDraft } = await import('./modelProviderService.ts'));
  ({ compareEvalRuns } = await import('./compareService.ts'));
  ({ modelProviderRoutes } = await import('../routes/modelProviders.ts'));
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
});

async function waitForEvalRun(id: string) {
  for (let index = 0; index < 200; index += 1) {
    const item = evalService.getEvalRun(id)!;
    if (['completed', 'failed', 'cancelled'].includes(String(item.status))) return item;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Eval Run ${id} did not finish`);
}
