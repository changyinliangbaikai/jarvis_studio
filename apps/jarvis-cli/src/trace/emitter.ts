import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import type { TraceEvent } from '../runtime.ts';

// 需要脱敏的字段名片段（防御性：Runtime 本身不写入密钥，这里做二次保护）。
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|secret|password|token|bearer)/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (SENSITIVE_KEY_PATTERN.test(key) && typeof item === 'string' && item) {
          return [key, '***redacted***'];
        }
        return [key, redactValue(item)];
      })
    );
  }
  return value;
}

export interface TraceEmitterOptions {
  // trace.jsonl 落盘路径；为空表示不落盘（仅内存/stdout）。
  traceOut?: string;
  // 是否将事件以 JSONL 形式同步输出到 stdout（--event-stream）。
  toStdout?: boolean;
}

// TraceEmitter：将 Runtime 实时发出的 TraceEvent 持久化为 JSONL，
// 严格保留原始事件（含 eventType），并补充 type 别名以兼容文档示例与下游读取。
export class TraceEmitter {
  private stream?: WriteStream;
  private count = 0;
  private readonly toStdout: boolean;
  readonly traceOut?: string;

  constructor(options: TraceEmitterOptions) {
    this.traceOut = options.traceOut;
    this.toStdout = Boolean(options.toStdout);
    if (this.traceOut) {
      mkdirSync(dirname(this.traceOut), { recursive: true });
      this.stream = createWriteStream(this.traceOut, { flags: 'w', encoding: 'utf8' });
      console.log(`[trace] trace 写入: ${this.traceOut}`);
    }
  }

  // 作为 runAgent 的 onEvent 回调；每个事件落盘一行 JSON。
  readonly handle = (event: TraceEvent): void => {
    const safe = redactValue(event) as TraceEvent & { type?: string };
    // 补充 type 别名（= eventType），保持对既有 trace-sdk 的完全兼容同时方便阅读。
    if (!safe.type) safe.type = event.eventType;
    const line = `${JSON.stringify(safe)}\n`;
    this.stream?.write(line);
    if (this.toStdout) process.stdout.write(line);
    this.count += 1;
  };

  get eventCount(): number {
    return this.count;
  }

  // 关闭写入流，确保所有事件落盘。
  async close(): Promise<void> {
    if (!this.stream) return;
    await new Promise<void>((resolveClose) => {
      this.stream!.end(() => resolveClose());
    });
    console.log(`[trace] 已写入 ${this.count} 个事件`);
  }
}
