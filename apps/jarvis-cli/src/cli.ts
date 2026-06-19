#!/usr/bin/env node
// Jarvis Agent CLI v0.1 入口。手写参数解析，避免引入额外依赖。
import { resolve } from 'node:path';
import { runCommand } from './commands/run.ts';
import { cmdSkillList, cmdToolList, cmdConfigList } from './commands/info.ts';
import { cmdTraceView } from './commands/trace.ts';
import { loadConfig } from './config/loader.ts';
import type { RunOptions } from './types.ts';

const VERSION = '0.1.0';

const HELP = `
Jarvis Agent CLI ${VERSION}
用法: jarvis <command> [options]

命令:
  run                  运行一个 Agent 任务
  version              显示版本
  skill list           列出可用的 Skill
  tool  list           列出可用的工具
  config list          查看当前配置
  trace view <path>    查看 trace.jsonl 运行轨迹

run 用法:
  jarvis run "任务描述" [options]
  jarvis run --task "任务描述" [options]

run 选项:
  --task, -t <text>             任务描述（可用位置参数代替）
  --skill, -s <id>              指定 Skill ID（可选，自动推断）
  --file, -f <path>             输入文件（可多次，相对 workspace）
  --workspace, -w <path>        工作空间目录（默认从 jarvis.yaml）
  --model-profile, -m <id>      模型 profile ID（默认从 jarvis.yaml）
  --prompt-version <version>    指定 Prompt 版本
  --permission-policy <id>      权限策略 ID（可选）
  --context-policy <id>         上下文策略 ID（可选）
  --trace-out <path>            trace.jsonl 输出路径（默认 <traceDir>/<runId>.trace.jsonl）
  --artifact-dir <path>         产物输出目录（默认从 jarvis.yaml）
  --json                        以 JSON 格式输出运行摘要
  --event-stream                将事件流实时写入 stdout（JSONL，供 CliRuntimeAdapter 使用）
  --non-interactive             完全禁止终端交互（Studio/CI 调用时使用）
  --yes                         自动批准所有审批请求
  --auto-approve-low-risk       自动批准 low 风险工具调用
  --deny-high-risk              自动拒绝 high/critical 风险工具调用
  --max-approvals <n>           审批上限（默认 10）

全局选项:
  --version      显示版本
  --help         显示帮助
`.trim();

// 短参数 -> 长参数 的集中映射表。新增参数只需在此追加一条，调用侧不再重复 fallback。
const FLAG_ALIASES: Record<string, string> = {
  t: 'task',
  s: 'skill',
  f: 'file',
  w: 'workspace',
  m: 'model-profile',
  y: 'yes',
  h: 'help'
};

// 纯布尔标志（出现即 true，不接受值）。命中后下个 token 仍按独立参数解析。
const BOOL_FLAGS = new Set([
  'json', 'event-stream', 'non-interactive', 'yes',
  'auto-approve-low-risk', 'deny-high-risk', 'version', 'help'
]);

// 允许重复追加成数组的非布尔标志（典型如 --file 多次指定）。
const ARRAY_FLAGS = new Set(['file']);

// 简单参数解析：返回 { flags, positional }。
// 关键修复：
//   1. 通过 FLAG_ALIASES 统一短参→长参，调用方不必再写 `flags['skill'] ?? flags['s']`。
//   2. 非布尔标志若缺少值（下一个 token 不存在或又是 `-` 开头）直接抛错，不再静默丢失。
function parseArgs(argv: string[]): { flags: Record<string, string | true | string[]>; positional: string[] } {
  const flags: Record<string, string | true | string[]> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) {
      const rawKey = arg.replace(/^-+/, '');
      const key = FLAG_ALIASES[rawKey] ?? rawKey;
      if (BOOL_FLAGS.has(key)) {
        flags[key] = true;
        i += 1;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`选项 ${arg} 需要一个参数值，但下一个 token 是 ${next === undefined ? '(无)' : `"${next}"`}`);
      }
      if (ARRAY_FLAGS.has(key)) {
        const prev = flags[key];
        flags[key] = Array.isArray(prev) ? [...prev, next] : prev ? [String(prev), next] : [next];
      } else {
        flags[key] = next;
      }
      i += 2;
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  return { flags, positional };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function strArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  return [];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`[cli] 参数错误: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
  const { flags, positional } = parsed;

  if (flags['version']) { console.log(`jarvis ${VERSION}`); return; }
  // alias 已在 parseArgs 中归一为 'help'，调用方无需再 fallback 到 'h'
  if (flags['help'] || positional.length === 0) { console.log(HELP); return; }

  const [cmd, sub, ...rest] = positional;

  // jarvis version（子命令形式，与 --version 等价）
  if (cmd === 'version') {
    console.log(`jarvis ${VERSION}`);
    return;
  }

  if (cmd === 'skill' && sub === 'list') {
    cmdSkillList(Boolean(flags['json']));
    return;
  }
  if (cmd === 'tool' && sub === 'list') {
    cmdToolList(Boolean(flags['json']));
    return;
  }
  if (cmd === 'config' && sub === 'list') {
    cmdConfigList(Boolean(flags['json']));
    return;
  }
  // jarvis trace view <path>
  if (cmd === 'trace' && sub === 'view') {
    const tracePath = rest[0] ?? str(flags['file']);
    if (!tracePath) {
      console.error('用法: jarvis trace view <trace.jsonl 路径>');
      process.exit(1);
    }
    await cmdTraceView(tracePath, Boolean(flags['json']));
    return;
  }

  if (cmd === 'run') {
    // task 支持位置参数（sub 为任务文本，非子命令）或 --task / -t 标志
    // 短参数 -t 已在 parseArgs 中映射为 task，这里只读长名。
    const task = str(flags['task']) ?? sub;
    if (!task) {
      console.error('错误: 请提供任务描述，例如: jarvis run "分析客户清单" 或 jarvis run --task "..."');
      process.exit(1);
    }

    // 加载配置获取默认值；若加载失败则降级使用 CLI 参数或硬编码 fallback。
    // 这里加载一次后透传给 runCommand，避免下游重复读取磁盘和重复日志。
    let config: ReturnType<typeof loadConfig> | undefined;
    try { config = loadConfig(); } catch (e) {
      console.warn(`[cli] 配置加载失败（将使用命令行参数）: ${e instanceof Error ? e.message : e}`);
    }

    const workspacePath = resolve(process.cwd(), str(flags['workspace']) ?? config?.workspace.workspace.root ?? './workspaces/default');
    const modelProfileId = str(flags['model-profile']) ?? config?.workspace.defaults.modelProfile ?? 'deterministic-default';
    const artifactDir = resolve(process.cwd(), str(flags['artifact-dir']) ?? config?.workspace.workspace.artifactDir ?? './workspaces/default/artifacts');

    const options: RunOptions = {
      task,
      skill: str(flags['skill']),
      files: strArr(flags['file']),
      workspacePath,
      modelProfileId,
      promptVersion: str(flags['prompt-version']),
      permissionPolicyId: str(flags['permission-policy']),
      contextPolicyId: str(flags['context-policy']),
      traceOut: str(flags['trace-out']),
      artifactDir,
      json: Boolean(flags['json']),
      eventStream: Boolean(flags['event-stream']),
      nonInteractive: Boolean(flags['non-interactive']),
      yes: Boolean(flags['yes']),
      autoApproveLowRisk: Boolean(flags['auto-approve-low-risk']),
      denyHighRisk: Boolean(flags['deny-high-risk']),
      maxApprovals: flags['max-approvals'] ? Number(flags['max-approvals']) : 10
    };

    const code = await runCommand(options, config);
    process.exit(code);
    return;
  }

  console.error(`未知命令: ${cmd}。运行 jarvis --help 查看帮助。`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[cli] 未处理异常:', err instanceof Error ? err.message : err);
  process.exit(1);
});
