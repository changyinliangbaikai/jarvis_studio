import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { traceEventSchema } from '@jarvis/trace-sdk';
import type { TraceEvent } from '../runtime.ts';

// 关键事件类型的可读名称映射
const EVENT_LABELS: Record<string, string> = {
  'run.start': '▶  run.start',
  'run.end': '■  run.end',
  'turn.start': '→  turn.start',
  'turn.end': '←  turn.end',
  'context.build': '📦 context.build',
  'llm.call': '🤖 llm.call',
  'tool.call': '🔧 tool.call',
  'tool.policy.check': '🔒 tool.policy.check',
  'artifact.register': '📄 artifact.register',
  'artifact.write': '✍️  artifact.write',
  'run.pause_for_approval': '⏸  run.pause_for_approval',
  'approval.approved': '✅ approval.approved',
  'approval.rejected': '❌ approval.rejected',
  'run.resume_after_approval': '▶  run.resume_after_approval',
  'run.stop_after_rejection': '🛑 run.stop_after_rejection',
  'error': '💥 error',
  'failure.detected': '⚠️  failure.detected'
};

// 从 payload 中提取最关键的摘要字段用于人类阅读
function summarizePayload(eventType: string, payload: Record<string, unknown>): string {
  if (eventType === 'run.start') return `model=${payload.model} skill=${(payload.skillVersions as string[])?.[0] ?? '?'}`;
  if (eventType === 'run.end') return `status=${payload.status} latency=${payload.latencyMs}ms tokens=${payload.totalTokens}`;
  if (eventType === 'turn.start') return `"${String(payload.userMessage ?? '').slice(0, 60)}"`;
  if (eventType === 'context.build') return `tokens=${payload.totalTokens} truncated=${payload.truncated}`;
  if (eventType === 'llm.call') {
    const calls = (payload.output as Record<string, unknown>)?.toolCalls;
    const callCount = Array.isArray(calls) ? calls.length : 0;
    return `prompt=${payload.promptTokens} completion=${payload.completionTokens} latency=${payload.latencyMs}ms toolCalls=${callCount}`;
  }
  if (eventType === 'tool.call') return `tool=${payload.tool} success=${(payload.execution as Record<string, unknown>)?.success}`;
  if (eventType === 'tool.policy.check') return `tool=${payload.toolId} decision=${payload.decision}`;
  if (eventType === 'artifact.register') return `name=${(payload.artifact as Record<string, unknown>)?.name} size=${(payload.artifact as Record<string, unknown>)?.sizeBytes}B`;
  if (eventType === 'run.pause_for_approval') return `tool=${payload.toolId} risk=${payload.riskLevel}`;
  if (eventType === 'approval.approved') return `tool=${payload.toolId} decision=${payload.decision}`;
  if (eventType === 'approval.rejected') return `tool=${payload.toolId} note=${payload.note}`;
  if (eventType === 'error') return String(payload.error ?? payload.name ?? '');
  if (eventType === 'failure.detected') return `type=${payload.failureType} ${String(payload.summary ?? '').slice(0, 80)}`;
  return '';
}

interface TraceReadResult {
  events: TraceEvent[];
  invalidLines: Array<{ line: number; error: string }>;
}

// 读取 trace.jsonl 并解析全部 TraceEvent，坏行会被记录并在 UI 层提示。
export async function readTraceJsonl(path: string): Promise<TraceReadResult> {
  const events: TraceEvent[] = [];
  const invalidLines: TraceReadResult['invalidLines'] = [];
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(traceEventSchema.parse(JSON.parse(trimmed)));
    } catch (error) {
      invalidLines.push({ line: lineNumber, error: error instanceof Error ? error.message : '未知错误' });
    }
  }
  return { events, invalidLines };
}

// jarvis trace view <path> 命令入口
export async function cmdTraceView(tracePath: string, json: boolean): Promise<void> {
  const absPath = resolve(process.cwd(), tracePath);
  console.log(`[trace] 读取: ${absPath}\n`);

  let result: TraceReadResult;
  try {
    result = await readTraceJsonl(absPath);
  } catch (err) {
    console.error(`[trace] 无法读取文件: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const { events, invalidLines } = result;
  if (invalidLines.length) {
    const preview = invalidLines.slice(0, 3).map((item) => `line ${item.line}: ${item.error}`).join('; ');
    console.error(`[trace] 已跳过 ${invalidLines.length} 行无效 TraceEvent: ${preview}`);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
    return;
  }

  // 统计摘要
  const runStart = events.find((e) => e.eventType === 'run.start');
  const runEnd = events.find((e) => e.eventType === 'run.end');
  const toolCalls = events.filter((e) => e.eventType === 'tool.call');
  const llmCalls = events.filter((e) => e.eventType === 'llm.call');
  const artifacts = events.filter((e) => e.eventType === 'artifact.register');
  const runId = runStart?.runId ?? '(unknown)';

  console.log('========== Jarvis Trace View ==========');
  console.log(`run_id    : ${runId}`);
  console.log(`events    : ${events.length}`);
  console.log(`llm calls : ${llmCalls.length}`);
  console.log(`tool calls: ${toolCalls.length}`);
  console.log(`artifacts : ${artifacts.length}`);
  if (runStart) console.log(`started   : ${runStart.timestamp}`);
  if (runEnd) {
    const p = runEnd.payload as Record<string, unknown>;
    console.log(`status    : ${p.status}  latency: ${p.latencyMs}ms  tokens: ${p.totalTokens}`);
  }
  console.log('---------------------------------------');

  // 逐行打印关键事件
  for (const event of events) {
    const label = EVENT_LABELS[event.eventType] ?? `   ${event.eventType}`;
    const summary = summarizePayload(event.eventType, event.payload as Record<string, unknown>);
    const ts = event.timestamp.slice(11, 23); // HH:MM:SS.mmm
    console.log(`${ts}  ${label.padEnd(36)} ${summary}`);
  }
  console.log('=======================================');
}
