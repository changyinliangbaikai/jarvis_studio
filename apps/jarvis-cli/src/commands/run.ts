import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { collectArtifacts } from '@jarvis/artifact-manager';
import { loadConfig, resolveModel } from '../config/loader.ts';
import { TraceEmitter } from '../trace/emitter.ts';
import { runAgent } from '../runtime.ts';
import type {
  RuntimeApprovalRequest,
  RuntimeApprovalResult,
  RuntimeIds,
  RuntimeRequest
} from '../runtime.ts';
import type { LoadedConfig, RunOptions } from '../types.ts';

// 将 CLI 传入的文件路径（相对 cwd 或绝对）归一化为相对 workspace 的路径，供 Runtime 工具解析。
function toWorkspaceRelativeFile(file: string, workspacePath: string): string {
  const absFile = isAbsolute(file) ? file : resolve(process.cwd(), file);
  const rel = relative(workspacePath, absFile);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`文件越界，必须位于 workspace 内: ${file}`);
  }
  return rel.split('\\').join('/');
}

// 构造审批处理器：
//   1. --yes: 自动批准一切
//   2. --auto-approve-low-risk: 仅自动批准 low 风险
//   3. --deny-high-risk: 自动拒绝 high/critical 风险
//   4. --non-interactive / 非 TTY: 不弹出交互提示，依策略决策
//   5. 交互式 TTY: 弹出确认提示
// 关键修复：传入复用的 ReadlineInterface 实例，避免每次审批都 createInterface + rl.close()，
// 反复关闭会导致底层 process.stdin 被暂停或销毁，第二次审批将卡死无法读取键盘输入。
function buildApprovalHandler(
  options: RunOptions,
  emitNotice: (msg: string) => void,
  getReadline: () => ReadlineInterface
) {
  let used = 0;
  const isInteractiveTty = process.stdin.isTTY && !options.nonInteractive && !options.yes && !options.json;
  return async (request: RuntimeApprovalRequest): Promise<RuntimeApprovalResult> => {
    used += 1;
    if (used > options.maxApprovals) {
      emitNotice(`审批次数超过上限 ${options.maxApprovals}，拒绝工具 ${request.toolId}`);
      return { decision: 'rejected', note: 'exceeded max approvals' };
    }
    // --yes 覆盖一切，直接批准
    if (options.yes) {
      emitNotice(`自动审批通过 (--yes): ${request.toolId} [${request.riskLevel}]`);
      return { decision: 'approved' };
    }
    // --deny-high-risk 优先检查：拒绝 high/critical
    if (options.denyHighRisk && (request.riskLevel === 'high' || request.riskLevel === 'critical')) {
      emitNotice(`自动拒绝高风险工具 (--deny-high-risk): ${request.toolId} [${request.riskLevel}]`);
      return { decision: 'rejected', note: '--deny-high-risk policy' };
    }
    // --auto-approve-low-risk：自动批准 low 风险
    if (options.autoApproveLowRisk && request.riskLevel === 'low') {
      emitNotice(`自动批准低风险工具 (--auto-approve-low-risk): ${request.toolId}`);
      return { decision: 'approved' };
    }
    // 非交互模式（--non-interactive 或非 TTY）：无法弹出提示，拒绝
    if (!isInteractiveTty) {
      emitNotice(`非交互模式，拒绝工具 ${request.toolId} (可添加 --yes 或 --auto-approve-low-risk 放行)`);
      return { decision: 'rejected', note: 'non-interactive: no approval channel' };
    }
    // 交互式 TTY：复用全局 readline 实例发起一次提示，由用户决定。
    const rl = getReadline();
    const answer = await rl.question(
      `\n需要审批工具 "${request.toolId}" [风险:${request.riskLevel}]\n原因: ${request.reason}\n参数: ${JSON.stringify(request.argumentsSummary)}\n是否批准? (y/N) `
    );
    const approved = /^y(es)?$/i.test(answer.trim());
    return approved ? { decision: 'approved' } : { decision: 'rejected', note: 'user rejected' };
  };
}

// 接受外部已加载的 LoadedConfig（由 CLI 入口加载，避免重复读盘和日志重复）。
// 若未提供则降级到内部加载，保证仍可作为独立模块调用。
export async function runCommand(options: RunOptions, externalConfig?: LoadedConfig): Promise<number> {
  const config = externalConfig ?? loadConfig({ silent: true });
  const workspacePath = options.workspacePath || config.workspace.workspace.root;
  mkdirSync(workspacePath, { recursive: true });

  // 解析模型 profile（API Key 从环境变量注入，绝不出现在日志/trace 中）。
  const resolved = resolveModel(config, options.modelProfileId);
  console.log(`[run] 模型 profile=${resolved.profile.id} provider=${resolved.profile.provider} model=${resolved.profile.model} apiKey=${resolved.apiKeyPresent ? '已注入' : '无'}`);

  // 生成稳定 runId，使 trace 与 artifacts manifest 命名可控。
  const runId = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const ids: RuntimeIds = {
    projectId: 'jarvis-cli-local',
    sessionId: `session_${randomUUID()}`,
    turnId: `turn_${randomUUID()}`,
    runId
  };

  const traceOut = options.traceOut
    ? (isAbsolute(options.traceOut) ? options.traceOut : resolve(process.cwd(), options.traceOut))
    : resolve(config.workspace.workspace.traceDir, `${runId}.trace.jsonl`);
  const artifactDir = isAbsolute(options.artifactDir) ? options.artifactDir : resolve(process.cwd(), options.artifactDir);

  const files = options.files.map((file) => toWorkspaceRelativeFile(file, workspacePath));
  console.log(`[run] runId=${runId} workspace=${workspacePath} files=${JSON.stringify(files)}`);

  const emitter = new TraceEmitter({ traceOut, toStdout: options.eventStream });
  const notices: string[] = [];
  const emitNotice = (msg: string) => {
    notices.push(msg);
    console.log(`[approval] ${msg}`);
  };

  // 全命令周期共享一个 readline 实例：仅在真正需要交互（首次审批）时懒加载创建，
  // 命令结束时统一 close。避免在每个审批回调里反复 createInterface + rl.close() 把 stdin 关掉。
  let sharedReadline: ReadlineInterface | undefined;
  const getReadline = (): ReadlineInterface => {
    if (!sharedReadline) {
      sharedReadline = createInterface({ input: process.stdin, output: process.stdout });
    }
    return sharedReadline;
  };
  const closeReadlineIfOpened = (): void => {
    if (sharedReadline) {
      sharedReadline.close();
      sharedReadline = undefined;
    }
  };

  const request: RuntimeRequest = {
    name: options.task.slice(0, 60),
    message: options.task,
    skill: options.skill,
    files,
    workspacePath,
    modelProfile: resolved.modelProfile,
    promptVersion: options.promptVersion,
    contextStrategy: options.contextPolicyId,
    policyVersion: options.permissionPolicyId
  };

  let exitCode = 0;
  try {
    const result = await runAgent(request, {
      ids,
      onEvent: emitter.handle,
      waitForApproval: buildApprovalHandler(options, emitNotice, getReadline)
    });

    // 收集产物并补发 artifact.register（manifest 可被 Studio 导入）。
    const artifacts = collectArtifacts({
      result,
      workspacePath,
      artifactDir,
      runId,
      taskId: ids.turnId,
      emit: emitter.handle,
      ids: { projectId: ids.projectId, sessionId: ids.sessionId, turnId: ids.turnId }
    });

    await emitter.close();

    const summary = {
      runId,
      status: result.status,
      skill: options.skill ?? '(auto)',
      modelProfile: resolved.profile.id,
      output: result.output,
      toolCalls: result.toolCalls.map((call) => ({ name: call.name, success: call.success })),
      artifacts: artifacts.map((item) => ({ name: item.name, path: item.path, sizeBytes: item.sizeBytes, checksum: item.checksum })),
      traceOut,
      artifactManifest: resolve(artifactDir, `${runId}.artifacts.json`),
      events: emitter.eventCount,
      error: result.error
    };

    if (options.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      printHumanSummary(summary);
    }
    exitCode = result.status === 'success' ? 0 : 1;
  } catch (error) {
    await emitter.close();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run] 执行失败: ${message}`);
    if (options.json) process.stdout.write(`${JSON.stringify({ runId, status: 'failed', error: message, traceOut }, null, 2)}\n`);
    exitCode = 1;
  } finally {
    // 任务全部结束后再统一关闭交互通道；若从未触发审批则不会创建实例，nothing-to-close。
    closeReadlineIfOpened();
  }
  return exitCode;
}

function printHumanSummary(summary: Record<string, unknown>): void {
  const artifacts = summary.artifacts as Array<{ name: string; path: string; sizeBytes: number }>;
  const toolCalls = summary.toolCalls as Array<{ name: string; success: boolean }>;
  console.log('\n========== Jarvis Run Summary ==========');
  console.log(`run_id     : ${summary.runId}`);
  console.log(`status     : ${summary.status}`);
  console.log(`skill      : ${summary.skill}`);
  console.log(`model      : ${summary.modelProfile}`);
  console.log(`events     : ${summary.events}  -> ${summary.traceOut}`);
  console.log(`tool calls : ${toolCalls.map((c) => `${c.name}${c.success ? '✓' : '✗'}`).join(', ') || '(none)'}`);
  console.log(`artifacts  : ${artifacts.length ? '' : '(none)'}`);
  for (const item of artifacts) console.log(`  - ${item.path} (${item.sizeBytes} bytes)`);
  if (summary.error) console.log(`error      : ${summary.error}`);
  console.log('----------------------------------------');
  console.log(String(summary.output ?? ''));
  console.log('========================================');
}
