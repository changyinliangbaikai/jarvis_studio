import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '../../../..');
export const storageRoot = resolve(projectRoot, 'storage');
export const databasePath = process.env.JARVIS_STUDIO_DB ?? resolve(storageRoot, 'jarvis-studio.db');

mkdirSync(dirname(databasePath), { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec(readFileSync(resolve(import.meta.dirname, 'schema.sql'), 'utf8'));

const migrations: Array<[string, string]> = [
  ['eval_cases.dataset_id', `ALTER TABLE eval_cases ADD COLUMN dataset_id TEXT`],
  ['eval_cases.priority', `ALTER TABLE eval_cases ADD COLUMN priority TEXT`],
  ['eval_cases.version', `ALTER TABLE eval_cases ADD COLUMN version TEXT`],
  ['eval_cases.pass_criteria_json', `ALTER TABLE eval_cases ADD COLUMN pass_criteria_json TEXT`],
  ['eval_cases.file_path', `ALTER TABLE eval_cases ADD COLUMN file_path TEXT`],
  ['model_providers.input_price_per_1m_tokens', `ALTER TABLE model_providers ADD COLUMN input_price_per_1m_tokens REAL DEFAULT 0`],
  ['model_providers.output_price_per_1m_tokens', `ALTER TABLE model_providers ADD COLUMN output_price_per_1m_tokens REAL DEFAULT 0`],
  ['model_providers.currency', `ALTER TABLE model_providers ADD COLUMN currency TEXT DEFAULT 'USD'`],
  ['llm_calls.cost', `ALTER TABLE llm_calls ADD COLUMN cost REAL`],
  ['eval_runs.version_hashes_json', `ALTER TABLE eval_runs ADD COLUMN version_hashes_json TEXT`]
];
for (const [identity, sql] of migrations) {
  const [table, column] = identity.split('.');
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(sql);
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_eval_cases_dataset ON eval_cases(dataset_id, priority);
  CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset ON eval_runs(dataset_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_eval_case_results_run ON eval_case_results(eval_run_id, eval_case_id);
  CREATE INDEX IF NOT EXISTS idx_gate_results_run ON release_gate_results(eval_run_id, created_at DESC);
`);

export function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}
