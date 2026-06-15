# jarvis-runtime-lite v0.2

`jarvis-runtime-lite` is the real execution layer behind Jarvis Studio v0.2.

## Agent Loop

1. Select or load a versioned Skill.
2. Construct a segmented Context Snapshot.
3. Call the selected model provider.
4. Validate the requested tool against the Skill contract.
5. Execute the bounded tool and inject its result into the next Context Snapshot.
6. Repeat until the model produces a final answer or the maximum iteration limit is reached.
7. Emit and persist Trace Events throughout the lifecycle.

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
