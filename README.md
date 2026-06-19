# Jarvis Studio v0.5

Jarvis Studio is a local Agent engineering workbench with task-oriented workspaces, real Runtime traces, versioned Eval Datasets, batch evaluation, governance registries, permission policy, context budget analysis, failure diagnosis, replay snapshots, experiment matrices, release gates, and reports.

## Requirements

- Node.js 24+
- npm 11+

## Run

```bash
npm install
npm run seed
npm run dev
```

- Web UI: `http://127.0.0.1:4311`
- API: `http://127.0.0.1:4310`

Production build and server:

```bash
./script/build_and_run.sh
```

The production server hosts both the API and built Web UI at `http://127.0.0.1:4310`.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run verify:v0.5
```

## v0.1 Capabilities

- JSONL Trace import with zod validation and raw-event preservation
- Runs registry, Trace Tree, LLM/Tool/Artifact detail
- Multi-turn Conversation replay
- Context Snapshot, segment token breakdown, final Prompt, truncation/compression signals
- Prompt version creation, variable rendering, and Mock Runtime test runs
- YAML Eval Case import, batch Mock Runtime execution, and rule scoring
- Prompt version comparison and Release Gate decision
- SQLite local storage and versioned Trace/Eval documentation

Tool replay is deliberately disabled in v0.1 until permission handling is implemented.

## v0.2 Real Runtime

- `packages/agent-runtime` implements a minimal Agent Loop.
- Model providers: deterministic local and configurable OpenAI-compatible chat completions.
- Skills: `excel-data-analysis`, `weekly-report`, and `code-review`.
- Tools: `filesystem.read`, `filesystem.write`, `python.run`, and `xlsx.inspect`.
- Live Runtime page creates real Runs and streams Trace Events through SSE.
- Every LLM call receives a persisted segmented Context Snapshot.
- Eval Bench runs real Runtime executions; the built-in suite contains 15 cases.
- Compare supports deep Run-to-Run comparison.
- Model Providers provides a persistent registry for OpenAI-compatible services, encrypted API keys, connection tests, and default Runtime routing.

## Model Provider Registry

Open **Model Providers** in the Studio sidebar to register a model service. Each profile contains a Base URL, default model, enabled/default routing state, and an optional API Key.

- API Keys are encrypted locally with AES-256-GCM and never returned by list APIs.
- Runtime requests send only `providerId`; the server resolves the secret profile.
- Connection tests call the OpenAI-compatible `/models` endpoint without generating billable completions.
- New and edited Provider drafts can be tested before saving; existing encrypted keys are reused server-side when the API Key field is left blank.

Provider and Runtime model-call failures are printed to the server terminal with the prefix:

```text
[jarvis:model-provider:error]
```

The structured log includes endpoint, model, HTTP status, request ID, latency, content type, and a truncated upstream response body. Authorization headers and API keys are automatically redacted.
- Set `JARVIS_STUDIO_PROVIDER_KEY` to supply a stable encryption secret. Without it, Studio creates `storage/provider-secret.key` locally.

OpenAI-compatible configuration:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:11434/v1
export OPENAI_API_KEY=ollama
export OPENAI_MODEL=qwen3
npm run start
```

The deterministic provider remains available for offline repeatable validation.

## v0.3 Evaluation & Release Gate

- Versioned Eval Dataset and Case YAML import with schema validation.
- Eval Runner 2.0 with real Runtime execution, concurrency, timeout, retry, cancellation, and matrix API support.
- Rule Scoring, optional LLM-as-Judge JSON scoring, and Human Review.
- Eval Run level metrics, standardized issue tags, Trace links, and version hashes.
- Configurable YAML Release Gates with persisted PASS/BLOCK evidence.
- Baseline vs Candidate Eval Run comparison with case-level regression classification.
- Markdown Eval Report generation and download.
- Provider token pricing, per-LLM-call cost, per-case cost, and Eval Run cost aggregation.

Seeded fixed datasets:

```text
jarvis_smoke_v1: 5 P0 cases
jarvis_regression_v1: 15 regression cases
```

See [v0.3 test plan](docs/v0.3-test-plan.md) and [v0.3 acceptance](docs/v0.3-acceptance.md).

## v0.4 Capability Governance & Context Optimization

- Skill Registry with manifest import, version records, enable/disable state, selection events, hit count, success rate, average score, tool error rate, and related failures.
- Skill test action that launches a deterministic Runtime smoke run and links the resulting Run.
- Tool Registry with schema, category, version, enable/disable state, risk level, default policy, runtime sandbox metadata, context injection strategy, call statistics, and error analysis.
- Permission Policy Engine in the Runtime tool path; `tool.policy.check` emits and persists allow / approve / deny decisions.
- Approvals page for high-risk permission decisions, persisted permission policies, and a permission decision ledger.
- Context Budget Manager with before/after token counts, segment priority, action, compression/truncation/drop state, risk hints, and editable context strategies.
- Failure Diagnosis records from Runtime, Tool, Permission, and Eval failures, including evidence, suggested fix, status flow, linked Run/Eval/Skill/Tool, and fix links.
- Replay Snapshot creation on Run completion and replay APIs for same-config or override replay; available input files are copied under `storage/snapshots`.
- Audit log records for governance mutations such as approvals, Skill tests, Tool policy changes, policy saves, and replay snapshot creation.
- Experiment Matrix basic version for Eval Set x Model Provider x Model x Prompt x Skill x Context Strategy x Tool Policy comparisons with best-variant highlighting.
- Run detail governance summary for Skill, Permission, Context, Failure, and Replay before the Trace Tree.

See [v0.4 test plan](docs/v0.4-test-plan.md) and [v0.4 acceptance](docs/v0.4-acceptance.md).

## v0.5 Eval Workspace and RuntimeAdapter

- Jarvis Studio is an Agent Runtime scenario validation, evaluation, observability, replay, and admission platform, not the Jarvis Agent itself.
- Eval Workspace model with root path, default model provider, permission policy, context policy, settings, file tree, related test tasks, and run artifacts.
- Test Task model with scenario template, selected model/skill/prompt, preflight/postflight results, current runtime run, task events, final artifact IDs, and conversion to Eval Case.
- RuntimeAdapter abstraction with `LocalRuntimeAdapter` as the first implementation for the local `agent-runtime`.
- EvalTaskRunner flow: preflight -> RuntimeAdapter run -> trace/run artifact/runtime approval collection -> postflight -> test task status and score writeback.
- Scenario Template model seeded with Excel data analysis, weekly report, and code review workflows.
- Run Artifact Center with preview, download, final marking, eval workspace/test task/run linkage, MIME metadata, checksum, and preview availability.
- Runtime Approval Center backed by the v0.5 `approvals` table with approve/reject/approve-with-changes actions.
- Runtime tool registry adds `git.status`, `git.diff`, `docx.read`, `docx.write`, `patch.apply`, and `shell.safe_run`.
- New sidebar pages: Eval Workspace, Test Tasks, Run Artifacts, Eval Scenarios, Eval Dashboard, and Test Task Compare.

See [v0.5 acceptance](docs/v0.5-acceptance.md).
