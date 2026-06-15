PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT, description TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL,
  model_profile TEXT, started_at TEXT NOT NULL, ended_at TEXT, metadata_json TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_index INTEGER NOT NULL,
  user_message TEXT NOT NULL, assistant_message TEXT, status TEXT NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT, FOREIGN KEY(session_id) REFERENCES sessions(id)
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, name TEXT NOT NULL, status TEXT NOT NULL,
  model TEXT, model_provider TEXT, prompt_version TEXT, skill_versions_json TEXT,
  tool_schema_version TEXT, runtime_version TEXT, context_strategy_version TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, latency_ms INTEGER, prompt_tokens INTEGER,
  completion_tokens INTEGER, total_tokens INTEGER, score REAL, error TEXT, metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, parent_id TEXT, type TEXT NOT NULL,
  name TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT, output_json TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, latency_ms INTEGER, error TEXT, metadata_json TEXT,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS context_snapshots (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, turn_id TEXT, llm_call_id TEXT,
  total_tokens INTEGER, max_context_tokens INTEGER, truncated INTEGER, compressed INTEGER,
  final_prompt_ref TEXT, final_prompt TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS context_segments (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
  version TEXT, content_ref TEXT, preview TEXT, tokens INTEGER, included INTEGER,
  truncated INTEGER, compressed INTEGER, priority INTEGER, reason TEXT,
  FOREIGN KEY(snapshot_id) REFERENCES context_snapshots(id)
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, turn_id TEXT, span_id TEXT, model TEXT NOT NULL,
  provider TEXT, temperature REAL, max_output_tokens INTEGER, prompt_tokens INTEGER,
  completion_tokens INTEGER, total_tokens INTEGER, latency_ms INTEGER,
  first_token_latency_ms INTEGER, prefill_ms INTEGER, decode_ms INTEGER,
  tokens_per_second REAL, context_snapshot_id TEXT, input_ref TEXT, output_json TEXT,
  cost REAL, created_at TEXT NOT NULL, FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, turn_id TEXT, span_id TEXT, tool_name TEXT NOT NULL,
  reason TEXT, arguments_json TEXT, permission_json TEXT, latency_ms INTEGER, success INTEGER,
  exit_code INTEGER, stdout_ref TEXT, stderr_ref TEXT, result_json TEXT,
  context_injection_json TEXT, created_at TEXT NOT NULL, FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, turn_id TEXT, type TEXT NOT NULL, path TEXT NOT NULL,
  sha256 TEXT, size_bytes INTEGER, created_at TEXT NOT NULL, FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, content TEXT NOT NULL,
  variables_json TEXT, linked_skill TEXT, changelog TEXT, created_at TEXT NOT NULL,
  UNIQUE(name, version)
);
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY, dataset_id TEXT, name TEXT NOT NULL, category TEXT NOT NULL, priority TEXT,
  version TEXT, tags_json TEXT, input_json TEXT NOT NULL, config_json TEXT, expected_json TEXT,
  scoring_json TEXT, pass_criteria_json TEXT, file_path TEXT, release_gate_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY, eval_case_id TEXT NOT NULL, run_id TEXT NOT NULL, prompt_version TEXT,
  skill_version TEXT, model TEXT, score REAL, pass INTEGER, reason TEXT, metrics_json TEXT,
  created_at TEXT NOT NULL, FOREIGN KEY(eval_case_id) REFERENCES eval_cases(id),
  FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS raw_trace_events (
  event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, run_id TEXT, timestamp TEXT NOT NULL,
  raw_json TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider_type TEXT NOT NULL, base_url TEXT,
  api_key_encrypted TEXT, api_key_hint TEXT, default_model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0,
  last_test_status TEXT, last_test_latency_ms INTEGER, last_test_message TEXT,
  last_tested_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  input_price_per_1m_tokens REAL DEFAULT 0, output_price_per_1m_tokens REAL DEFAULT 0,
  currency TEXT DEFAULT 'USD'
);
CREATE TABLE IF NOT EXISTS eval_datasets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, category TEXT,
  description TEXT, owner TEXT, file_path TEXT, case_count INTEGER DEFAULT 0,
  default_runtime_json TEXT, scoring_profile TEXT, release_gate_id TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, dataset_version TEXT, name TEXT,
  status TEXT NOT NULL, model_provider_id TEXT, model_name TEXT, model_config_json TEXT,
  prompt_version TEXT, skill_version TEXT, runtime_version TEXT, tool_schema_version TEXT,
  context_strategy_version TEXT, code_commit_hash TEXT, total_cases INTEGER DEFAULT 0,
  passed_cases INTEGER DEFAULT 0, failed_cases INTEGER DEFAULT 0, pass_rate REAL,
  avg_score REAL, avg_latency_ms INTEGER, avg_total_tokens INTEGER, total_cost REAL,
  avg_cost_per_case REAL, currency TEXT, enable_llm_judge INTEGER DEFAULT 0,
  judge_model_provider_id TEXT, judge_prompt_version TEXT, release_gate_result_id TEXT,
  report_path TEXT, config_json TEXT, version_hashes_json TEXT, started_at TEXT, ended_at TEXT, error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_case_results (
  id TEXT PRIMARY KEY, eval_run_id TEXT NOT NULL, eval_case_id TEXT NOT NULL, run_id TEXT,
  status TEXT NOT NULL, passed INTEGER DEFAULT 0, total_score REAL, rule_score REAL,
  llm_judge_score REAL, human_score REAL, latency_ms INTEGER, prompt_tokens INTEGER,
  completion_tokens INTEGER, total_tokens INTEGER, cost REAL, tool_call_count INTEGER,
  artifact_count INTEGER, issue_tags_json TEXT, rule_results_json TEXT, judge_result_json TEXT,
  human_review_json TEXT, final_output TEXT, error TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS release_gates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, scope_json TEXT,
  criteria_json TEXT NOT NULL, required_p0_json TEXT, on_failure_json TEXT,
  file_path TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS release_gate_results (
  id TEXT PRIMARY KEY, gate_id TEXT NOT NULL, eval_run_id TEXT NOT NULL, passed INTEGER DEFAULT 0,
  summary_json TEXT, failed_criteria_json TEXT, report_path TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS eval_reports (
  id TEXT PRIMARY KEY, eval_run_id TEXT NOT NULL, path TEXT NOT NULL, generated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_run_id ON spans(run_id);
CREATE INDEX IF NOT EXISTS idx_tools_run_id ON tool_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_case ON eval_results(eval_case_id);
CREATE INDEX IF NOT EXISTS idx_model_providers_default ON model_providers(is_default DESC, updated_at DESC);
