# Project Instructions for Jarvis Studio

## Goal
Build Jarvis Studio, a local developer workbench for observing, debugging, evaluating, and comparing Jarvis Agent runs.

## Core Requirements
- Use TypeScript across frontend and backend.
- Use React + Vite for web UI.
- Use Node.js + Fastify for backend.
- Use SQLite for local storage.
- Keep Trace Schema, Eval Case Spec, and database schema versioned.
- Do not hard-code demo data in business logic.
- Preserve every imported trace event in raw form.
- Support Runs, Trace, Conversation, Context, Tool Calls, Prompt versions, Eval cases, Compare, and Release Gate.
- Use `agent-runtime` for real Agent executions and Eval runs.
- Persist every Runtime Trace Event as it is emitted.
- Save a segmented Context Snapshot immediately before every LLM call.

## Safety Rules
- Never execute arbitrary shell commands from imported traces.
- `python.run` may execute only `.py` files inside the fixed Runtime workspace.
- All filesystem tools must reject paths outside the fixed Runtime workspace.
- Tool replay remains disabled until permission handling is implemented.
- Do not expose files outside this project.
- Keep artifacts under `storage/artifacts`.
