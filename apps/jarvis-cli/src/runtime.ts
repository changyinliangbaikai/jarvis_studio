// Thin re-export so the CLI depends on a single stable path to the reusable
// agent runtime. The CLI never duplicates protocol or execution logic; it only
// orchestrates agent-runtime (runAgent) and adapts I/O for terminal use.
export * from '@jarvis/agent-runtime';
export type { TraceEvent } from '@jarvis/trace-sdk';
