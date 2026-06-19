# agent-runtime v0.4

`agent-runtime` is the real execution layer behind Jarvis Studio v0.4.

## Agent Loop

1. Load the Skill Registry and score Skill candidates.
2. Select or load a versioned Skill.
3. Construct a segmented Context Snapshot and apply the Context Budget strategy.
4. Call the selected model provider.
5. Validate the requested tool against Tool Registry, Skill permissions, and the Permission Policy Engine.
6. Execute the bounded tool only when the decision is `allow`.
7. Inject the tool result into the next Context Snapshot according to the context injection strategy.
8. Repeat until the model produces a final answer or the maximum iteration limit is reached.
9. Emit a Replay Snapshot and persist Trace Events throughout the lifecycle.

## Providers

- `deterministic`: repeatable offline provider used for local validation and Eval baselines.
- `openai-compatible`: calls `/chat/completions` with function tools and accepts standard tool-call responses.

## Tool Safety

- All paths are resolved against `fixtures/runtime-workspace`.
- Filesystem tools reject path traversal.
- `python.run` uses a fixed Python executable and executes only workspace-local `.py` files.
- Imported Trace data is never executed.

## Context Segments

Every LLM call is preceded by a persisted Context Snapshot containing:

- `system_prompt`
- `skill_instruction`
- `user_message`
- `tool_descriptions`
- `conversation_history`
- `tool_result`

Each segment includes `tokensBefore`, `tokensAfter`, `priority`, `action`, `included`, and `reason`.

## Governance Events

Runtime v0.4 emits:

- `skill.registry.loaded`
- `skill.select` with candidates, score, matched reasons, and selected skill id
- `context.budget.apply`
- `context.segment`
- `tool.policy.check`
- `failure.detected`
- `replay.snapshot.created`

These events are imported into dedicated Studio tables for Skill selection, permission decisions, context budget analysis, failures, and replay snapshots.

## Permission Policy

The default local policy is `default-local-policy@0.4.0`.

- low risk tools are allowed automatically.
- medium sandboxed tools are allowed when scoped to the Runtime workspace policy.
- high risk tools return `approve`.
- critical risk tools return `deny`.

The Runtime does not execute tools when the decision is `approve` or `deny`; it records a Failure event instead.
