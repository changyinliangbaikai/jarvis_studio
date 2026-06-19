#!/usr/bin/env node
// Jarvis CLI 可执行入口。
// 透明地以 --experimental-transform-types 重新启动，使 Node.js 直接运行 TypeScript 源码，
// 无需单独的编译步骤——与 agent-runtime / Studio Server 的开发模式保持一致。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliTs = resolve(__dirname, '../src/cli.ts');

// 已经在带 --experimental-transform-types 的进程中：直接 import cli.ts。
// cli.ts 顶层会自行调用 main()，本文件无需再次调用（cli.ts 没有 default 导出）。
if (process.execArgv.includes('--experimental-transform-types')) {
  await import(cliTs);
} else {
  // 首次进入：以 --experimental-transform-types 重新启动子进程，桥接 stdio/exit/error。
  const child = spawn(
    process.execPath,
    ['--experimental-transform-types', cliTs, ...process.argv.slice(2)],
    { stdio: 'inherit', env: process.env }
  );
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => { console.error('[jarvis] 启动失败:', err.message); process.exit(1); });
}
