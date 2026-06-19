import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx';
import { diagnosticErrorDetails, redactDiagnostic, callModel } from '@jarvis/model-gateway';
import { evaluateToolPolicy } from '@jarvis/permission-engine';
import { loadSkill } from '@jarvis/skill-loader';
import { executeTool, toolDefinitions } from '@jarvis/tool-registry';
import { runAgent } from './runtime.ts';

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-runtime-'));
  mkdirSync(join(root, 'input'), { recursive: true });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { customer: 'A', assets: 100, phone: '1' },
    { customer: 'B', assets: -5, phone: null }
  ]), 'customers');
  XLSX.writeFile(workbook, join(root, 'input', 'customers.xlsx'));
  writeFileSync(join(root, 'input', 'sample.ts'), 'export const value = 1;\n');
  return root;
}

describe('agent-runtime', () => {
  it('executes the real Excel tool chain and generates a report', async () => {
    const workspacePath = createWorkspace();
    const result = await runAgent({
      message: '分析 Excel 异常并给出营销建议',
      skill: 'excel-data-analysis',
      files: ['input/customers.xlsx'],
      workspacePath,
      modelProfile: { provider: 'deterministic', model: 'deterministic-local' }
    });
    expect(result.status).toBe('success');
    expect(result.toolCalls.map((tool) => tool.name)).toEqual(['xlsx.inspect', 'filesystem.write', 'python.run']);
    expect(result.artifacts[0]?.path).toBe('output/analysis_report.md');
    expect(readFileSync(join(workspacePath, 'output', 'analysis_report.md'), 'utf8')).toContain('异常发现');
    const contextEvents = result.events.filter((event) => event.eventType === 'context.build');
    expect(contextEvents.length).toBe(4);
    expect((contextEvents[0]?.payload.segments as Array<{ type: string }>).map((segment) => segment.type)).toEqual([
      'system_prompt', 'skill_instruction', 'user_message', 'tool_descriptions', 'conversation_history', 'tool_result'
    ]);
  });

  it('records a cost on every LLM call when provider pricing is configured', async () => {
    const workspacePath = createWorkspace();
    const result = await runAgent({
      message: '生成周报',
      skill: 'weekly-report',
      workspacePath,
      modelProfile: {
        provider: 'deterministic', model: 'deterministic-local',
        inputPricePer1MTokens: 2, outputPricePer1MTokens: 8, currency: 'USD'
      }
    });
    const calls = result.events.filter((event) => event.eventType === 'llm.call');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((event) => Number(event.payload.cost) > 0 && event.payload.currency === 'USD')).toBe(true);
  });

  it('emits v0.4 governance events for skill, permission, context, failure, and replay', async () => {
    const workspacePath = createWorkspace();
    const result = await runAgent({
      message: '生成周报',
      skill: 'weekly-report',
      workspacePath,
      modelProfile: { provider: 'deterministic', model: 'deterministic-local' }
    });
    expect(result.status).toBe('success');
    const eventTypes = result.events.map((event) => event.eventType);
    expect(eventTypes).toContain('skill.registry.loaded');
    expect(eventTypes).toContain('skill.select');
    expect(eventTypes).toContain('context.budget.apply');
    expect(eventTypes).toContain('context.segment');
    expect(eventTypes).toContain('tool.policy.check');
    expect(eventTypes).toContain('replay.snapshot.created');
    const skillSelect = result.events.find((event) => event.eventType === 'skill.select');
    expect(skillSelect?.payload.selected_skill_id).toBe('weekly-report');
    expect(skillSelect?.payload.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ skillId: 'weekly-report', status: 'selected' })]));
    const policy = result.events.find((event) => event.eventType === 'tool.policy.check' && event.payload.tool_id === 'filesystem.write');
    expect(policy?.payload).toMatchObject({ tool_id: 'filesystem.write', decision: 'allow', riskLevel: 'medium' });
    const budget = result.events.find((event) => event.eventType === 'context.budget.apply');
    expect(Number(budget?.payload.before_tokens)).toBeGreaterThanOrEqual(Number(budget?.payload.after_tokens));
  });

  it('classifies high and critical tool calls through the permission engine', () => {
    const skill = loadSkill('code-review');
    const shellTool = { ...toolDefinitions[0]!, name: 'shell.run', permission: 'process.shell', riskLevel: 'high' as const, defaultPolicy: 'approve' as const };
    const mailTool = { ...toolDefinitions[0]!, name: 'email.send', permission: 'network.email', riskLevel: 'critical' as const, defaultPolicy: 'deny' as const };
    const shellSkill = { ...skill, requiredTools: ['shell.run'], permissions: ['process.shell'] };
    const mailSkill = { ...skill, requiredTools: ['email.send'], permissions: ['network.email'] };
    expect(evaluateToolPolicy({ tool: shellTool, skill: shellSkill, args: {}, toolCallId: 'call_shell' })).toMatchObject({ decision: 'approve', riskLevel: 'high' });
    expect(evaluateToolPolicy({ tool: mailTool, skill: mailSkill, args: {}, toolCallId: 'call_email' })).toMatchObject({ decision: 'deny', riskLevel: 'critical' });
  });

  it('supports OpenAI-compatible chat completions with tool calls', async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: 'test-model',
        choices: [{ message: { content: 'inspect', tool_calls: [{ id: 'call_1', function: { name: 'xlsx_inspect', arguments: '{"path":"input/customers.xlsx"}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const response = await callModel({
        profile: { provider: 'openai-compatible', model: 'test-model', baseUrl: 'http://example.invalid/v1', apiKey: 'test' },
        messages: [{ role: 'user', content: 'inspect' }],
        tools: toolDefinitions,
        skill: loadSkill('excel-data-analysis'),
        completedTools: [],
        files: ['input/customers.xlsx']
      });
      expect(response.provider).toBe('openai-compatible');
      expect(response.toolCalls[0]).toMatchObject({ name: 'xlsx.inspect', arguments: { path: 'input/customers.xlsx' } });
      expect(response.usage.totalTokens).toBe(14);
      expect(JSON.stringify(requestBody)).toContain('"name":"xlsx_inspect"');
      expect(JSON.stringify(requestBody)).not.toContain('"name":"xlsx.inspect"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('redacts provider credentials from diagnostic entries', () => {
    const redacted = JSON.stringify(redactDiagnostic({
      authorization: 'Bearer sk-secret-token-value',
      responseBody: '{"api_key":"sk-another-secret-value"}',
      message: 'failed with sk-third-secret-value',
      error: diagnosticErrorDetails(new Error('upstream rejected sk-fourth-secret-value'))
    }));
    expect(redacted).not.toContain('sk-secret');
    expect(redacted).not.toContain('sk-another');
    expect(redacted).not.toContain('sk-third');
    expect(redacted).not.toContain('sk-fourth');
    expect(redacted).toContain('[REDACTED]');
  });

  it('rejects filesystem traversal and arbitrary process execution', async () => {
    const workspacePath = createWorkspace();
    await expect(executeTool('filesystem.read', { path: '../outside.txt' }, { workspacePath, runId: 'test' })).rejects.toThrow('路径超出 workspace');
    await expect(executeTool('python.run', { scriptPath: 'input/sample.ts' }, { workspacePath, runId: 'test' })).rejects.toThrow('只允许执行');
  });
});
