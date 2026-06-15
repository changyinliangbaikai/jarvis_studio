# Jarvis Studio v0.3

Jarvis Studio is a local Agent quality workbench with real Runtime traces, versioned Eval Datasets, batch evaluation, scoring, regression comparison, release gates, and reports.

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

- `packages/jarvis-runtime-lite` implements a minimal Agent Loop.
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
