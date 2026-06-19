import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '../../../..');
export const storageRoot = resolve(projectRoot, 'storage');
export const defaultWorkspaceRoot = resolve(projectRoot, 'fixtures/runtime-workspace');
export const databasePath = process.env.JARVIS_STUDIO_DB ?? resolve(storageRoot, 'jarvis-studio.db');

// db 实例本身仅占用极少资源，可在模块加载阶段创建；繁重的目录创建/schema 加载/迁移/seed
// 被收敛进 initializeDatabase()，由模块尾部安全调用一次，并对外暴露以便引导阶段显式重入。
export const db = new DatabaseSync(databasePath);

// Prepared statement 缓存：避免 traceImportService 这类批量 run 在事务循环里反复 prepare 同一条 SQL，
// 大数据量导入时可显著降低 CPU 与系统调用开销。schema/migrations 完成前不会写入缓存。
const statementCache = new Map<string, StatementSync>();
function getStatement(sql: string): StatementSync {
  let stmt = statementCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statementCache.set(sql, stmt);
  }
  return stmt;
}

let initialized = false;
let initializationError: Error | undefined;

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
  ['eval_runs.version_hashes_json', `ALTER TABLE eval_runs ADD COLUMN version_hashes_json TEXT`],
  ['context_snapshots.total_tokens_before_budget', `ALTER TABLE context_snapshots ADD COLUMN total_tokens_before_budget INTEGER`],
  ['context_snapshots.total_tokens_after_budget', `ALTER TABLE context_snapshots ADD COLUMN total_tokens_after_budget INTEGER`],
  ['context_snapshots.budget_strategy', `ALTER TABLE context_snapshots ADD COLUMN budget_strategy TEXT`],
  ['context_snapshots.reserved_output_tokens', `ALTER TABLE context_snapshots ADD COLUMN reserved_output_tokens INTEGER`],
  ['context_snapshots.risk_json', `ALTER TABLE context_snapshots ADD COLUMN risk_json TEXT`],
  ['context_segments.tokens_before', `ALTER TABLE context_segments ADD COLUMN tokens_before INTEGER`],
  ['context_segments.tokens_after', `ALTER TABLE context_segments ADD COLUMN tokens_after INTEGER`],
  ['context_segments.action', `ALTER TABLE context_segments ADD COLUMN action TEXT`],
  ['context_segments.metadata_json', `ALTER TABLE context_segments ADD COLUMN metadata_json TEXT`],
  ['failures.fix_links_json', `ALTER TABLE failures ADD COLUMN fix_links_json TEXT`],
  ['artifacts.workspace_id', `ALTER TABLE artifacts ADD COLUMN workspace_id TEXT`],
  ['artifacts.task_id', `ALTER TABLE artifacts ADD COLUMN task_id TEXT`],
  ['artifacts.tool_call_id', `ALTER TABLE artifacts ADD COLUMN tool_call_id TEXT`],
  ['artifacts.name', `ALTER TABLE artifacts ADD COLUMN name TEXT`],
  ['artifacts.mime_type', `ALTER TABLE artifacts ADD COLUMN mime_type TEXT`],
  ['artifacts.checksum', `ALTER TABLE artifacts ADD COLUMN checksum TEXT`],
  ['artifacts.generated_by', `ALTER TABLE artifacts ADD COLUMN generated_by TEXT`],
  ['artifacts.preview_available', `ALTER TABLE artifacts ADD COLUMN preview_available INTEGER DEFAULT 0`],
  ['artifacts.is_final', `ALTER TABLE artifacts ADD COLUMN is_final INTEGER DEFAULT 0`],
  ['tasks.preflight_json', `ALTER TABLE tasks ADD COLUMN preflight_json TEXT`],
  ['tasks.postflight_json', `ALTER TABLE tasks ADD COLUMN postflight_json TEXT`]
];
// 显式初始化函数：把目录创建/schema 加载/迁移/索引/seed 统一收敛到这里，避免顶层异常直接打挂 Fastify。
// 幂等：重复调用安全；任何阶段失败都会记录到 initializationError，并在 main 引导时清晰抛出。
export function initializeDatabase(): void {
  if (initialized) return;
  try {
    // 1. 确保数据库目录与默认 workspace 子目录存在（同步 IO，仅启动一次性代价）。
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(resolve(defaultWorkspaceRoot, 'artifacts'), { recursive: true });
    mkdirSync(resolve(defaultWorkspaceRoot, 'tmp'), { recursive: true });
    mkdirSync(resolve(defaultWorkspaceRoot, 'snapshots'), { recursive: true });

    // 2. 应用 schema.sql 与增量迁移。
    db.exec(readFileSync(resolve(import.meta.dirname, 'schema.sql'), 'utf8'));
    for (const [identity, sql] of migrations) {
      const [table, column] = identity.split('.');
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((item) => item.name === column)) db.exec(sql);
    }

    // 3. 索引（IF NOT EXISTS，幂等）。
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_eval_cases_dataset ON eval_cases(dataset_id, priority);
      CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset ON eval_runs(dataset_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_eval_case_results_run ON eval_case_results(eval_run_id, eval_case_id);
      CREATE INDEX IF NOT EXISTS idx_gate_results_run ON release_gate_results(eval_run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workspaces_updated ON workspaces(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_workspace ON artifacts(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, risk_level, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at DESC);
    `);

    // 4. seed 内置数据。所有 INSERT 都用 OR IGNORE，二次启动不会重复写入。
    seedBuiltinPolicies();
    seedDefaultWorkspace();
    seedBuiltinScenarios();

    initialized = true;
    console.log(`[database] 初始化完成: ${databasePath}`);
  } catch (error) {
    initializationError = error instanceof Error ? error : new Error(String(error));
    console.error(`[database] 初始化失败: ${initializationError.message}`);
    throw initializationError;
  }
}

function seedBuiltinPolicies(): void {
  run(`INSERT OR IGNORE INTO context_strategies (id, name, version, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)`,
    'balanced-v1',
    '平衡策略',
    '0.4.0',
    JSON.stringify({
      maxContextTokens: 32768,
      reservedOutputTokens: 4096,
      segments: {
        system_prompt: { mode: 'keep', maxTokens: 2000, priority: 100 },
        current_user_message: { mode: 'keep', maxTokens: 4000, priority: 100 },
        skill_instruction: { mode: 'progressive', maxTokens: 3000, priority: 90 },
        tool_schema: { mode: 'compact', maxTokens: 4000, priority: 80 },
        conversation_history: { mode: 'summarize', maxTokens: 6000, priority: 60 },
        tool_result: { mode: 'summarize', maxTokens: 3000, priority: 75 },
        file_context: { mode: 'inspect_first', maxTokens: 8000, priority: 70 }
      }
    }),
    new Date().toISOString(),
    new Date().toISOString()
  );

  run(`INSERT OR IGNORE INTO permission_policies (id, name, version, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)`,
    'default-local-policy',
    '默认本地安全策略',
    '0.4.0',
    JSON.stringify({
      rules: [
        { id: 'allow-low-risk-readonly', decision: 'allow', description: 'low 风险只读工具自动允许' },
        { id: 'allow-medium-sandbox-python', decision: 'allow', description: '沙箱 python.run 自动允许' },
        { id: 'approve-high-risk', decision: 'approve', description: 'high 风险工具进入人工审批' },
        { id: 'deny-critical-by-default', decision: 'deny', description: 'critical 风险默认拒绝' }
      ]
    }),
    new Date().toISOString(),
    new Date().toISOString()
  );
}

function seedDefaultWorkspace(): void {
  const seedNow = new Date().toISOString();
  run(`INSERT OR IGNORE INTO workspaces (
      id, name, root_path, default_model_profile_id, default_policy_id, default_context_policy_id,
      settings_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'workspace_demo',
    'Demo Workspace',
    defaultWorkspaceRoot,
    'builtin-deterministic',
    'default-local-policy',
    'balanced-v1',
    JSON.stringify({
      defaultSkills: ['excel-data-analysis', 'weekly-report', 'code-review'],
      artifactDir: 'artifacts',
      tmpDir: 'tmp',
      snapshotDir: 'snapshots'
    }),
    seedNow,
    seedNow
  );
}

function seedBuiltinScenarios(): void {
  seedScenario({
    id: 'scenario_excel_analysis',
    name: 'Excel 数据分析',
    category: 'data-analysis',
    description: '分析 Excel/CSV 数据，输出结构化分析报告和可复核产物。',
    defaultSkillId: 'excel-data-analysis',
    requiredTools: ['filesystem.read', 'xlsx.inspect', 'python.run', 'filesystem.write'],
    defaultOutputs: ['markdown_report', 'xlsx_workbook'],
    preflight: ['input_file_exists', 'input_file_is_xlsx_or_csv', 'file_size_under_limit', 'required_skill_available', 'required_tools_available', 'model_profile_available'],
    postflight: [{ artifact_exists: 'analysis_report.md' }, { must_include_sections: ['数据概况', '关键发现', '异常点', '建议'] }]
  });
  seedScenario({
    id: 'scenario_weekly_report',
    name: '周报材料生成',
    category: 'office',
    description: '根据原始材料整理周报，输出 Markdown 和可选 Word 文档。',
    defaultSkillId: 'weekly-report',
    requiredTools: ['filesystem.read', 'filesystem.write', 'docx.write'],
    defaultOutputs: ['markdown_report', 'docx_document'],
    preflight: ['input_file_exists', 'input_file_is_txt_or_docx', 'required_skill_available', 'model_profile_available'],
    postflight: [{ artifact_exists: 'weekly_report.md' }, { artifact_exists: 'weekly_report.docx' }, 'no_empty_sections', 'length_in_range']
  });
  seedScenario({
    id: 'scenario_code_review',
    name: '代码审查',
    category: 'coding',
    description: '检查 Git 工作区最近改动，生成代码审查报告，未经审批不修改源代码。',
    defaultSkillId: 'code-review',
    requiredTools: ['filesystem.read', 'git.status', 'git.diff', 'filesystem.write'],
    defaultOutputs: ['markdown_report', 'code_patch'],
    preflight: ['workspace_is_git_repo', 'required_skill_available', 'required_tools_available', 'model_profile_available'],
    postflight: [{ artifact_exists: 'code_review.md' }, 'no_source_file_changed_without_approval']
  });
}

// 模块加载时自动 initialize 一次：保持对 traceImportService.test 等"直接 import database 即可写表"的兼容；
// main.ts 仍可再次调用 initializeDatabase()（幂等）以便引导阶段做显式 health-check。
initializeDatabase();

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
  return getStatement(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return getStatement(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return getStatement(sql).run(...params);
}

// 测试场景下偶尔需要在不同 schema 状态间复位缓存（例如重置 JARVIS_STUDIO_DB 后重新建表），
// 暴露此函数避免顶层模块状态污染下次断言。
export function resetStatementCache(): void {
  statementCache.clear();
}

// 暴露最近一次 initializeDatabase 失败的原因，便于上层在引导阶段做精细化诊断。
export function getInitializationError(): Error | undefined {
  return initializationError;
}

function seedScenario(input: {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultSkillId: string;
  requiredTools: string[];
  defaultOutputs: string[];
  preflight: unknown[];
  postflight: unknown[];
}) {
  const now = new Date().toISOString();
  run(`INSERT INTO scenario_templates (
      id, name, category, description, default_skill_id, required_tools_json,
      default_outputs_json, preflight_json, postflight_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, description=excluded.description,
      default_skill_id=excluded.default_skill_id, required_tools_json=excluded.required_tools_json,
      default_outputs_json=excluded.default_outputs_json, preflight_json=excluded.preflight_json,
      postflight_json=excluded.postflight_json, updated_at=excluded.updated_at`,
    input.id, input.name, input.category, input.description, input.defaultSkillId,
    JSON.stringify(input.requiredTools), JSON.stringify(input.defaultOutputs),
    JSON.stringify(input.preflight), JSON.stringify(input.postflight), now, now);
}
