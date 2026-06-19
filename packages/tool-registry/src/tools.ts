import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import XLSX from 'xlsx';
import type { ToolDefinition, ToolExecutionContext } from '@jarvis/shared-types';

const execFileAsync = promisify(execFile);

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'filesystem.read',
    description: 'Read a UTF-8 text file inside the configured workspace.',
    version: '0.4.0',
    category: 'filesystem',
    riskLevel: 'low',
    defaultPolicy: 'allow',
    permission: 'filesystem.read',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, sizeBytes: { type: 'number' }, sha256: { type: 'string' } } },
    permissions: { filesystem: { read: ['workspace'] }, network: false, shell: false },
    runtime: { sandbox: true, timeoutSeconds: 5 },
    contextInjection: { mode: 'summary', maxTokens: 1200 }
  },
  {
    name: 'filesystem.write',
    description: 'Write UTF-8 content to a file inside the configured workspace.',
    version: '0.4.0',
    category: 'filesystem',
    riskLevel: 'medium',
    defaultPolicy: 'allow',
    permission: 'filesystem.write',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { path: { type: 'string' }, sizeBytes: { type: 'number' }, sha256: { type: 'string' } } },
    permissions: { filesystem: { write: ['workspace/output', 'workspace/.jarvis-runtime'] }, network: false, shell: false },
    runtime: { sandbox: true, timeoutSeconds: 10 },
    contextInjection: { mode: 'summary', maxTokens: 800 }
  },
  {
    name: 'python.run',
    description: 'Run a Python script located inside the configured workspace using the fixed python3 executable.',
    version: '0.4.0',
    category: 'execution',
    riskLevel: 'medium',
    defaultPolicy: 'allow',
    permission: 'process.python',
    inputSchema: { type: 'object', properties: { scriptPath: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['scriptPath'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { exitCode: { type: 'number' }, stdout: { type: 'string' }, stderr: { type: 'string' }, latencyMs: { type: 'number' } } },
    permissions: { filesystem: { read: ['workspace'], write: ['workspace/output'] }, network: false, shell: false },
    runtime: { sandbox: true, timeoutSeconds: 30, maxStdoutTokens: 3000, maxStderrTokens: 3000 },
    contextInjection: { mode: 'summary', maxTokens: 1500 }
  },
  {
    name: 'xlsx.inspect',
    description: 'Inspect workbook sheets, headers, samples, missing values, and numeric summaries.',
    version: '0.4.0',
    category: 'office',
    riskLevel: 'low',
    defaultPolicy: 'allow',
    permission: 'filesystem.read',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, sampleRows: { type: 'number' } }, required: ['path'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { path: { type: 'string' }, sheetNames: { type: 'array' }, sheets: { type: 'array' } } },
    permissions: { filesystem: { read: ['workspace'] }, network: false, shell: false },
    runtime: { sandbox: true, timeoutSeconds: 15 },
    contextInjection: { mode: 'summary', maxTokens: 1800 }
  },
  {
    name: 'git.status',
    description: 'Read git branch and working tree status for the configured workspace.',
    version: '0.5.0',
    category: 'version-control',
    riskLevel: 'low',
    defaultPolicy: 'allow',
    permission: 'process.git',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: { branch: { type: 'string' }, clean: { type: 'boolean' }, lines: { type: 'array' }, stdout: { type: 'string' } } },
    permissions: { filesystem: { read: ['workspace'] }, network: false, shell: false, process: ['git status'] },
    runtime: { sandbox: true, timeoutSeconds: 10 },
    contextInjection: { mode: 'summary', maxTokens: 1200 }
  },
  {
    name: 'git.diff',
    description: 'Read git diff output for the configured workspace without modifying files.',
    version: '0.5.0',
    category: 'version-control',
    riskLevel: 'low',
    defaultPolicy: 'allow',
    permission: 'process.git',
    inputSchema: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } }, staged: { type: 'boolean' } },
      additionalProperties: false
    },
    outputSchema: { type: 'object', properties: { paths: { type: 'array' }, staged: { type: 'boolean' }, stdout: { type: 'string' }, truncated: { type: 'boolean' } } },
    permissions: { filesystem: { read: ['workspace'] }, network: false, shell: false, process: ['git diff'] },
    runtime: { sandbox: true, timeoutSeconds: 10, maxStdoutTokens: 8000 },
    contextInjection: { mode: 'summary', maxTokens: 2400 }
  },
  {
    name: 'docx.read',
    description: 'Read a text, Markdown, or DOCX input file inside the workspace. DOCX extraction is metadata-only in the Agent Runtime.',
    version: '0.5.0',
    category: 'office',
    riskLevel: 'low',
    defaultPolicy: 'allow',
    permission: 'filesystem.read',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' }, sizeBytes: { type: 'number' }, warning: { type: 'string' } } },
    permissions: { filesystem: { read: ['workspace'] }, network: false, shell: false },
    runtime: { sandbox: true, timeoutSeconds: 5 },
    contextInjection: { mode: 'summary', maxTokens: 1200 }
  },
  {
    name: 'docx.write',
    description: 'Write a lightweight document artifact inside the workspace. Markdown output remains the authoritative Agent Runtime format.',
    version: '0.5.0',
    category: 'office',
    riskLevel: 'medium',
    defaultPolicy: 'allow',
    permission: 'filesystem.write',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { path: { type: 'string' }, sizeBytes: { type: 'number' }, sha256: { type: 'string' }, warning: { type: 'string' } } },
    permissions: { filesystem: { write: ['workspace/output'] }, network: false, shell: false },
    runtime: { sandbox: true, timeoutSeconds: 10 },
    contextInjection: { mode: 'summary', maxTokens: 800 }
  },
  {
    name: 'patch.apply',
    description: 'Check or apply a git patch inside the workspace. Non-dry-run usage requires approval by policy.',
    version: '0.5.0',
    category: 'version-control',
    riskLevel: 'high',
    defaultPolicy: 'approve',
    permission: 'filesystem.write',
    inputSchema: {
      type: 'object',
      properties: { patchPath: { type: 'string' }, patch: { type: 'string' }, dryRun: { type: 'boolean' } },
      additionalProperties: false
    },
    outputSchema: { type: 'object', properties: { dryRun: { type: 'boolean' }, exitCode: { type: 'number' }, stdout: { type: 'string' }, stderr: { type: 'string' } } },
    permissions: { filesystem: { read: ['workspace'], write: ['workspace'] }, network: false, shell: false, process: ['git apply'] },
    runtime: { sandbox: true, timeoutSeconds: 15 },
    contextInjection: { mode: 'summary', maxTokens: 1200 }
  },
  {
    name: 'shell.safe_run',
    description: 'Run an allow-listed command in the workspace. This is high risk and approval-gated by default.',
    version: '0.5.0',
    category: 'execution',
    riskLevel: 'high',
    defaultPolicy: 'approve',
    permission: 'process.shell',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'array', items: { type: 'string' } }, timeoutMs: { type: 'number' } },
      required: ['command'],
      additionalProperties: false
    },
    outputSchema: { type: 'object', properties: { exitCode: { type: 'number' }, stdout: { type: 'string' }, stderr: { type: 'string' }, latencyMs: { type: 'number' } } },
    permissions: { filesystem: { read: ['workspace'], write: ['workspace/output'] }, network: false, shell: true },
    runtime: { sandbox: true, timeoutSeconds: 30, maxStdoutTokens: 3000, maxStderrTokens: 3000 },
    contextInjection: { mode: 'summary', maxTokens: 1500 }
  }
];

function safePath(workspacePath: string, requested: unknown): string {
  if (typeof requested !== 'string' || !requested.trim()) throw new Error('path 不能为空');
  const root = resolve(workspacePath);
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) throw new Error(`路径超出 workspace: ${requested}`);
  return candidate;
}

async function filesystemRead(args: Record<string, unknown>, context: ToolExecutionContext) {
  const path = safePath(context.workspacePath, args.path);
  const content = await readFile(path, 'utf8');
  return { path: relative(context.workspacePath, path), content, sizeBytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
}

async function filesystemWrite(args: Record<string, unknown>, context: ToolExecutionContext) {
  const path = safePath(context.workspacePath, args.path);
  if (typeof args.content !== 'string') throw new Error('content 必须是字符串');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, args.content, 'utf8');
  const info = await stat(path);
  return { path: relative(context.workspacePath, path), sizeBytes: info.size, sha256: createHash('sha256').update(args.content).digest('hex') };
}

async function pythonRun(args: Record<string, unknown>, context: ToolExecutionContext) {
  const scriptPath = safePath(context.workspacePath, args.scriptPath);
  if (!scriptPath.endsWith('.py')) throw new Error('python.run 只允许执行 workspace 内的 .py 文件');
  const scriptArgs = Array.isArray(args.args) ? args.args.map(String) : [];
  const started = performance.now();
  const { stdout, stderr } = await execFileAsync('/usr/bin/python3', [scriptPath, ...scriptArgs], {
    cwd: context.workspacePath,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', PYTHONIOENCODING: 'utf-8' }
  });
  return { exitCode: 0, stdout, stderr, latencyMs: Math.round(performance.now() - started) };
}

function summarizeNumeric(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: sorted[0],
    max: sorted.at(-1),
    avg: Number((sum / values.length).toFixed(2))
  };
}

async function xlsxInspect(args: Record<string, unknown>, context: ToolExecutionContext) {
  const path = safePath(context.workspacePath, args.path);
  const workbook = XLSX.readFile(path, { cellDates: true });
  const sampleRows = Math.max(1, Math.min(Number(args.sampleRows ?? 10), 50));
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return { name: sheetName, rows: 0, columns: 0, headers: [], sample: [] };
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const missingValues = Object.fromEntries(headers.map((header) => [header, rows.filter((row) => row[header] === null || row[header] === '').length]));
    const numericSummary = Object.fromEntries(headers.flatMap((header) => {
      const summary = summarizeNumeric(rows.map((row) => row[header]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
      return summary ? [[header, summary]] : [];
    }));
    return { name: sheetName, rows: rows.length, columns: headers.length, headers, missingValues, numericSummary, sample: rows.slice(0, sampleRows) };
  });
  return { path: relative(context.workspacePath, path), sheetNames: workbook.SheetNames, sheets };
}

async function gitStatus(_args: Record<string, unknown>, context: ToolExecutionContext) {
  const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], {
    cwd: context.workspacePath,
    timeout: 10_000,
    maxBuffer: 1024 * 1024
  });
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branch = lines.find((line) => line.startsWith('## '))?.replace(/^##\s+/, '') ?? 'unknown';
  return { branch, clean: lines.length <= 1, lines, stdout };
}

async function gitDiff(args: Record<string, unknown>, context: ToolExecutionContext) {
  const paths = Array.isArray(args.paths) ? args.paths.map((item) => relative(context.workspacePath, safePath(context.workspacePath, item))) : [];
  const gitArgs = ['diff'];
  if (args.staged) gitArgs.push('--cached');
  gitArgs.push('--', ...paths);
  const { stdout } = await execFileAsync('git', gitArgs, {
    cwd: context.workspacePath,
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024
  });
  const truncated = stdout.length > 80_000;
  return { paths, staged: Boolean(args.staged), stdout: truncated ? stdout.slice(0, 80_000) : stdout, truncated };
}

async function docxRead(args: Record<string, unknown>, context: ToolExecutionContext) {
  const path = safePath(context.workspacePath, args.path);
  const buffer = await readFile(path);
  const rel = relative(context.workspacePath, path);
  if (/\.(md|txt)$/i.test(path)) {
    return { path: rel, text: buffer.toString('utf8'), sizeBytes: buffer.byteLength, warning: null };
  }
  return {
    path: rel,
    text: '',
    sizeBytes: buffer.byteLength,
    warning: 'agent-runtime 暂不解包 DOCX 正文；请同时提供 txt/md 材料作为可审计输入。'
  };
}

async function docxWrite(args: Record<string, unknown>, context: ToolExecutionContext) {
  const path = safePath(context.workspacePath, args.path);
  if (typeof args.content !== 'string') throw new Error('content 必须是字符串');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, args.content, 'utf8');
  const info = await stat(path);
  return {
    path: relative(context.workspacePath, path),
    sizeBytes: info.size,
    sha256: createHash('sha256').update(args.content).digest('hex'),
    warning: path.endsWith('.docx') ? 'Lite runtime 写入的是文本内容，不生成完整 OOXML DOCX 包。' : null
  };
}

async function patchApply(args: Record<string, unknown>, context: ToolExecutionContext) {
  const dryRun = args.dryRun !== false;
  let patchPath: string;
  if (typeof args.patchPath === 'string') {
    patchPath = safePath(context.workspacePath, args.patchPath);
  } else if (typeof args.patch === 'string' && args.patch.trim()) {
    patchPath = safePath(context.workspacePath, `.jarvis-runtime/patches/${context.runId}.patch`);
    await mkdir(dirname(patchPath), { recursive: true });
    await writeFile(patchPath, args.patch, 'utf8');
  } else {
    throw new Error('patch.apply 需要 patchPath 或 patch');
  }
  const gitArgs = ['apply', dryRun ? '--check' : '--index', patchPath];
  const started = performance.now();
  const { stdout, stderr } = await execFileAsync('git', gitArgs, {
    cwd: context.workspacePath,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return { dryRun, exitCode: 0, stdout, stderr, latencyMs: Math.round(performance.now() - started) };
}

async function shellSafeRun(args: Record<string, unknown>, context: ToolExecutionContext) {
  const command = Array.isArray(args.command) ? args.command.map(String) : [];
  if (!command.length) throw new Error('command 不能为空');
  const binary = command[0];
  const binaryArgs = command.slice(1);
  if (!binary) throw new Error('command 不能为空');
  const allowList = new Set(['git', 'node', 'npm', 'python3']);
  if (!allowList.has(binary)) throw new Error(`shell.safe_run 不允许执行命令: ${binary}`);
  const started = performance.now();
  const { stdout, stderr } = await execFileAsync(binary, binaryArgs, {
    cwd: context.workspacePath,
    timeout: Math.min(Number(args.timeoutMs ?? 30_000), 30_000),
    maxBuffer: 2 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin', PYTHONIOENCODING: 'utf-8' }
  });
  return { exitCode: 0, stdout, stderr, latencyMs: Math.round(performance.now() - started) };
}

export async function executeTool(name: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
  if (name === 'filesystem.read') return filesystemRead(args, context);
  if (name === 'filesystem.write') return filesystemWrite(args, context);
  if (name === 'python.run') return pythonRun(args, context);
  if (name === 'xlsx.inspect') return xlsxInspect(args, context);
  if (name === 'git.status') return gitStatus(args, context);
  if (name === 'git.diff') return gitDiff(args, context);
  if (name === 'docx.read') return docxRead(args, context);
  if (name === 'docx.write') return docxWrite(args, context);
  if (name === 'patch.apply') return patchApply(args, context);
  if (name === 'shell.safe_run') return shellSafeRun(args, context);
  throw new Error(`未知工具: ${name}`);
}
