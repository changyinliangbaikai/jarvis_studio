import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import XLSX from 'xlsx';
import type { ToolDefinition, ToolExecutionContext } from './types.ts';

const execFileAsync = promisify(execFile);

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'filesystem.read',
    description: 'Read a UTF-8 text file inside the configured workspace.',
    permission: 'filesystem.read',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
  },
  {
    name: 'filesystem.write',
    description: 'Write UTF-8 content to a file inside the configured workspace.',
    permission: 'filesystem.write',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false }
  },
  {
    name: 'python.run',
    description: 'Run a Python script located inside the configured workspace using the fixed python3 executable.',
    permission: 'process.python',
    inputSchema: { type: 'object', properties: { scriptPath: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['scriptPath'], additionalProperties: false }
  },
  {
    name: 'xlsx.inspect',
    description: 'Inspect workbook sheets, headers, samples, missing values, and numeric summaries.',
    permission: 'filesystem.read',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, sampleRows: { type: 'number' } }, required: ['path'], additionalProperties: false }
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

export async function executeTool(name: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
  if (name === 'filesystem.read') return filesystemRead(args, context);
  if (name === 'filesystem.write') return filesystemWrite(args, context);
  if (name === 'python.run') return pythonRun(args, context);
  if (name === 'xlsx.inspect') return xlsxInspect(args, context);
  throw new Error(`未知工具: ${name}`);
}
