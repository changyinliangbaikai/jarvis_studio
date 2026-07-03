import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let get: typeof import('../db/database.ts').get;
let listAgents: typeof import('./agentService.ts').listAgents;
let createAgentWithDefaultPrompt: typeof import('./agentService.ts').createAgentWithDefaultPrompt;
let updateAgent: typeof import('./agentService.ts').updateAgent;
let createPrompt: typeof import('./promptService.ts').createPrompt;
let activatePrompt: typeof import('./promptService.ts').activatePrompt;
let testPrompt: typeof import('./promptService.ts').testPrompt;
let getRun: typeof import('./queryService.ts').getRun;
let listRawTraceEvents: typeof import('./queryService.ts').listRawTraceEvents;
let createCaseFromRun: typeof import('./caseService.ts').createCaseFromRun;
let getCase: typeof import('./caseService.ts').getCase;
let runCase: typeof import('./caseService.ts').runCase;
let createEvalSuite: typeof import('./lightEvalService.ts').createEvalSuite;
let runEvalSuite: typeof import('./lightEvalService.ts').runEvalSuite;
let getEvalRun: typeof import('./lightEvalService.ts').getEvalRun;

beforeAll(async () => {
  process.env.JARVIS_STUDIO_DB = join(mkdtempSync(join(tmpdir(), 'jarvis-studio-v06-')), 'test.db');
  ({ get } = await import('../db/database.ts'));
  ({ listAgents, createAgentWithDefaultPrompt, updateAgent } = await import('./agentService.ts'));
  ({ createPrompt, activatePrompt, testPrompt } = await import('./promptService.ts'));
  ({ getRun, listRawTraceEvents } = await import('./queryService.ts'));
  ({ createCaseFromRun, getCase, runCase } = await import('./caseService.ts'));
  ({ createEvalSuite, runEvalSuite, getEvalRun } = await import('./lightEvalService.ts'));
});

describe('Jarvis Studio v0.6 prompt-first flow', () => {
  it('creates an Agent with a default Prompt draft and exposes active defaults', () => {
    const created = createAgentWithDefaultPrompt({
      name: '代码审查助手',
      description: '检查代码风险并输出可复盘建议。',
      defaultModelProviderId: 'builtin-deterministic',
      defaultModel: 'deterministic-local',
      defaultRuntimeId: 'local-runtime',
      tags: ['coding', 'review']
    });

    expect(created).toMatchObject({
      name: '代码审查助手',
      status: 'active',
      defaultModel: 'deterministic-local',
      defaultRuntimeId: 'local-runtime',
      tags: ['coding', 'review']
    });
    expect(created.defaultPromptVersionId).toMatch(/^prompt_/);
    expect(listAgents().find((agent) => agent.id === created.id)).toMatchObject({
      defaultPromptVersionId: created.defaultPromptVersionId
    });
  });

  it('runs Playground with a Prompt Version snapshot that remains available on the historical Run', () => {
    const agent = createAgentWithDefaultPrompt({ name: '资料整理助手', description: '整理资料。' });
    const prompt = createPrompt({
      name: '资料整理 Prompt',
      agentId: agent.id,
      status: 'draft',
      systemPrompt: '你是资料整理助手，必须输出 Markdown。',
      developerPrompt: '先提炼重点，再列风险。',
      userTemplate: '请整理：{{input}}',
      toolPolicy: { allowedTools: ['filesystem.read'], maxToolCalls: 2 },
      outputSchema: { format: 'markdown', mustInclude: ['重点', '风险'] },
      successCriteria: { mustAnswerUser: true },
      riskNotes: '可能忽略最后一个约束。',
      changelog: '初始版本'
    })!;
    const active = activatePrompt(String(prompt.id))!;
    updateAgent(agent.id, { defaultPromptVersionId: String(active.id) });

    const result = testPrompt(String(active.id), {}, '请整理这段会议纪要', {
      modelProviderId: 'builtin-deterministic',
      modelName: 'deterministic-local',
      source: 'playground'
    });
    const run = getRun(result.runId);

    expect(run).toMatchObject({
      id: result.runId,
      status: 'success',
      agentId: agent.id,
      promptVersionId: active.id,
      source: 'playground',
      userInput: '请整理这段会议纪要'
    });
    expect(run?.metadata?.promptSnapshot).toMatchObject({
      id: active.id,
      version: active.version,
      systemPrompt: '你是资料整理助手，必须输出 Markdown。',
      developerPrompt: '先提炼重点，再列风险。',
      userTemplate: '请整理：{{input}}',
      renderedPrompt: expect.stringContaining('请整理这段会议纪要'),
      outputSchema: { format: 'markdown', mustInclude: ['重点', '风险'] }
    });
    expect(listRawTraceEvents(result.runId).map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['run.start', 'prompt.render', 'context.build', 'llm.call', 'run.end'])
    );
  });

  it('converts a Run to Case, runs the Case, and evaluates it in a lightweight Suite', () => {
    const agent = createAgentWithDefaultPrompt({ name: '回归测试助手', description: '用于 Case 和 Eval。' });
    const activePrompt = activatePrompt(String(agent.defaultPromptVersionId))!;
    const playground = testPrompt(String(activePrompt.id), {}, '请输出包含 OK 的结果', { source: 'playground' });

    const createdCase = createCaseFromRun(playground.runId, {
      name: '输出 OK',
      expectedOutput: 'OK',
      assertionType: 'keyword',
      assertionConfig: { mustInclude: ['OK'], matchMode: 'all' },
      priority: 'P0',
      tags: ['regression']
    });
    expect(createdCase).toMatchObject({
      agentId: agent.id,
      sourceRunId: playground.runId,
      input: '请输出包含 OK 的结果',
      assertionType: 'keyword',
      priority: 'P0',
      status: 'active'
    });
    expect(getCase(createdCase.id)?.sourceTraceId).toBe(playground.runId);

    const caseResult = runCase(createdCase.id, { promptVersionId: String(activePrompt.id) });
    expect(caseResult).toMatchObject({ caseId: createdCase.id, status: 'passed', passed: true });
    expect(getRun(caseResult.runId)?.promptVersionId).toBe(activePrompt.id);

    const suite = createEvalSuite({
      agentId: agent.id,
      name: '核心回归',
      description: 'v0.6 轻量评测集',
      caseIds: [createdCase.id],
      defaultAssertionMode: 'keyword',
      tags: ['smoke']
    });
    const evalRun = runEvalSuite(suite.id, { promptVersionId: String(activePrompt.id), maxParallel: 1 });
    expect(evalRun).toMatchObject({
      suiteId: suite.id,
      agentId: agent.id,
      promptVersionId: activePrompt.id,
      status: 'completed',
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      passRate: 1
    });
    expect(getEvalRun(evalRun.id)?.results?.[0]).toMatchObject({
      caseId: createdCase.id,
      runId: expect.stringMatching(/^playground_/),
      status: 'passed'
    });
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM eval_runs_light')?.n).toBe(1);
  });
});
