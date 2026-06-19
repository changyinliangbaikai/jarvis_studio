# Trace Schema 规范说明 v0.1

在 Jarvis Agent 执行任务时，它会输出一系列结构化的事件。Jarvis Studio 通过导入这些事件，能够在界面上完美重现 Agent 的运行轨迹、上下文快照、工具调用过程以及评测数据。

本篇文档定义了 Jarvis Studio 接受的 **Trace Schema v0.1** 规范。

> v0.4 继续兼容 v0.1 基础字段，并新增 Capability Governance & Context Optimization 事件。导入服务会将这些事件额外映射到 Skill、Permission、Context、Failure 和 Replay 专用表。

---

## 1. 传输与校验机制

- **格式要求**：Trace 事件通常保存在 `.jsonl`（JSON Lines）文件中。文件中的每一行必须是一个完整的、合法的 JSON 对象。
- **校验框架**：Jarvis Studio 导入端（[traceImportService](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/apps/jarvis-studio-server/src/services/traceImportService.ts)）使用 [Zod](https://zod.dev/) 对导入的每一行进行验证。不符合规范的行会导致导入失败并回滚。
- **持久化备份**：校验通过后，原始的 JSON 行会原封不动地保存在 `raw_trace_events` 表中，以备后续溯源调试。

---

## 2. 通用事件字段 (Base Fields)

每一个事件对象都必须包含以下通用字段：

| 字段名 | 类型 | 必须 | 说明 |
|---|---|---|---|
| `eventId` | `string` | 是 | 全局唯一的事件 ID，例如 `evt_101` |
| `eventType` | `string` | 是 | 事件类型，决定了如何解析 payload |
| `timestamp` | `string` | 是 | 符合 ISO 8601 格式的时间戳，例如 `2026-06-15T10:00:00.000Z` |
| `projectId` | `string` | 否 | 项目 ID，如果不存在，导入服务将默认创建一个同名项目 |
| `sessionId` | `string` | 否 | 会话（多轮对话）ID |
| `turnId` | `string` | 否 | 单轮对话交互的 ID |
| `runId` | `string` | 否 | 单次执行运行 ID，一个 Turn 重跑或回放时可产生不同的 runId |
| `spanId` | `string` | 否 | 当前步骤的 Span ID |
| `parentSpanId` | `string` | 否 | 父级 Span ID，用于构建 Trace 树（Trace Tree） |
| `payload` | `object` | 否 | 事件的具体数据，默认为空对象 `{}` |

---

## 3. 支持的核心事件类型与 Payload 细节

以下是 Jarvis Studio v0.1 支持的所有事件类型及其 `payload` 结构：

### 3.1 `run.start` (运行开始)
标志着一次 Agent 运行的生命周期开始。
```json
{
  "eventId": "evt_run_001",
  "eventType": "run.start",
  "timestamp": "2026-06-15T10:00:00.000Z",
  "projectId": "proj_customer_analysis",
  "sessionId": "sess_multi_turn_01",
  "runId": "run_01_a3b",
  "payload": {
    "name": "客户清单异常分析",
    "model": "qwen3.6-35b-a3b",
    "modelProvider": "local",
    "promptVersion": "excel-analysis@v0.1",
    "skillVersions": ["excel-data-analysis@v0.1"],
    "toolSchemaVersion": "tool-v0.1",
    "runtimeVersion": "jarvis-runtime@0.1.0",
    "contextStrategyVersion": "strategy-v1"
  }
}
```

### 3.2 `run.end` (运行结束)
标志着一次 Agent 运行的结束，并统计整体性能和 Token。
```json
{
  "eventId": "evt_run_002",
  "eventType": "run.end",
  "timestamp": "2026-06-15T10:00:45.000Z",
  "projectId": "proj_customer_analysis",
  "sessionId": "sess_multi_turn_01",
  "runId": "run_01_a3b",
  "payload": {
    "status": "success",
    "latencyMs": 45000,
    "promptTokens": 41200,
    "completionTokens": 3200,
    "totalTokens": 44400,
    "toolCallCount": 4,
    "artifactCount": 1,
    "score": 4.8,
    "error": null
  }
}
```

### 3.3 `turn.start` (对话轮次开始)
用户发起了新一轮输入。
```json
{
  "eventId": "evt_turn_001",
  "eventType": "turn.start",
  "timestamp": "2026-06-15T10:00:01.000Z",
  "sessionId": "sess_multi_turn_01",
  "turnId": "turn_01_t1",
  "runId": "run_01_a3b",
  "payload": {
    "index": 1,
    "userMessage": "分析这个客户清单，找出异常客户，并给出营销建议。",
    "files": [
      {
        "path": "fixtures/customer_list.xlsx",
        "sha256": "8a3cf8d..."
      }
    ]
  }
}
```

### 3.4 `turn.end` (对话轮次结束)
Agent 吐出了最终的响应文案，本轮对话完成。
```json
{
  "eventId": "evt_turn_002",
  "eventType": "turn.end",
  "timestamp": "2026-06-15T10:00:44.000Z",
  "sessionId": "sess_multi_turn_01",
  "turnId": "turn_01_t1",
  "runId": "run_01_a3b",
  "payload": {
    "status": "success",
    "assistantMessage": "我已经为您分析了该客户清单，共发现 12 名异常客户，详情已写入报表..."
  }
}
```

### 3.5 `context.build` (上下文构造)
记录在大模型调用前，如何将多种信息拼接为最终 of Prompt 上下文，以及各个片段 (Segment) 的 Token 消耗。
```json
{
  "eventId": "evt_ctx_001",
  "eventType": "context.build",
  "timestamp": "2026-06-15T10:00:02.000Z",
  "runId": "run_01_a3b",
  "turnId": "turn_01_t1",
  "spanId": "span_ctx_01",
  "payload": {
    "contextSnapshotId": "ctx_snap_001",
    "totalTokens": 18600,
    "maxContextTokens": 65536,
    "truncated": false,
    "compressed": false,
    "finalPrompt": "你是一个专业的数据分析 Agent...",
    "segments": [
      {
        "id": "seg_sys",
        "type": "system_prompt",
        "name": "base-agent-system",
        "version": "v0.1",
        "tokens": 1200,
        "included": true,
        "truncated": false,
        "compressed": false,
        "priority": 10
      },
      {
        "id": "seg_skill",
        "type": "skill_instruction",
        "name": "excel-data-analysis",
        "version": "v0.1",
        "tokens": 2600,
        "included": true,
        "priority": 8
      },
      {
        "id": "seg_history",
        "type": "conversation_history",
        "name": "previous_turns",
        "tokens": 4800,
        "included": true,
        "priority": 5
      }
    ]
  }
}
```

### 3.6 `llm.call` (大模型调用)
记录模型调用的物理参数、耗时分布及输出。
```json
{
  "eventId": "evt_llm_001",
  "eventType": "llm.call",
  "timestamp": "2026-06-15T10:00:04.000Z",
  "runId": "run_01_a3b",
  "turnId": "turn_01_t1",
  "spanId": "span_llm_01",
  "payload": {
    "llmCallId": "llm_call_001",
    "model": "qwen3.6-35b-a3b",
    "provider": "local",
    "temperature": 0.2,
    "maxOutputTokens": 4096,
    "promptTokens": 18600,
    "completionTokens": 860,
    "totalTokens": 19460,
    "latencyMs": 8200,
    "firstTokenLatencyMs": 3200,
    "prefillMs": 4800,
    "decodeMs": 3300,
    "tokensPerSecond": 26.1,
    "contextSnapshotId": "ctx_snap_001",
    "inputRef": "storage/prompts/run_01_llm_01_input.json",
    "output": {
      "type": "tool_call",
      "content": "我需要先检查 Excel 文件的结构和字段。",
      "toolCalls": [
        {
          "id": "call_inspect_01",
          "name": "xlsx.inspect",
          "arguments": {
            "path": "fixtures/customer_list.xlsx",
            "sampleRows": 20
          }
        }
      ]
    }
  }
}
```

### 3.7 `tool.call` (工具调用)
记录 Agent 运行的具体工具详情、入参、出参和权限审计情况。
```json
{
  "eventId": "evt_tool_001",
  "eventType": "tool.call",
  "timestamp": "2026-06-15T10:00:13.000Z",
  "runId": "run_01_a3b",
  "turnId": "turn_01_t1",
  "spanId": "span_tool_01",
  "parentSpanId": "span_llm_01",
  "payload": {
    "toolCallId": "call_inspect_01",
    "tool": "xlsx.inspect",
    "reason": "检查 Excel 工作表的行数、列名字段和样例数据",
    "arguments": {
      "path": "fixtures/customer_list.xlsx",
      "sampleRows": 20
    },
    "permission": {
      "required": ["filesystem.read"],
      "approved": true,
      "approvalMode": "auto"
    },
    "execution": {
      "latencyMs": 960,
      "success": true,
      "exitCode": 0
    },
    "result": {
      "sheets": ["Sheet1"],
      "rows": 68012,
      "columns": 38
    },
    "contextInjection": {
      "includedInNextLLMCall": true,
      "tokens": 1600,
      "summaryUsed": true
    },
    "stdoutRef": "storage/tool-results/run_01_stdout.log",
    "stderrRef": null
  }
}
```

### 3.8 `artifact.write` (写入产物)
Agent 生成并写出了持久化文件资产。
```json
{
  "eventId": "evt_art_001",
  "eventType": "artifact.write",
  "timestamp": "2026-06-15T10:00:30.000Z",
  "runId": "run_01_a3b",
  "turnId": "turn_01_t1",
  "spanId": "span_art_01",
  "payload": {
    "artifacts": [
      {
        "id": "art_rep_01",
        "type": "markdown",
        "path": "output/customer_analysis_report.md",
        "sha256": "bf43ce8d...",
        "sizeBytes": 12800
      }
    ]
  }
}
```

---

## 4. 调试与排障提示

- **事件顺序要求**：对于一条 Run 的生命周期而言，`run.start` 事件应当最先导入，`run.end` 事件在最后导入。如果在数据尚未加载完毕时便发生异常退出，建议发送一条 `run.end` 事件并设置 `payload.status` 为 `failed` 并将错误信息写在 `payload.error` 中。
- **自定义事件**：若您的 runtime 含有其他自定义阶段（例如 `memory.retrieve`、`permission.check`），可以直接在事件流中输出。导入服务会将具有 `eventType` 在内置集合（如 `context.build`, `tool.call`, `llm.call`）之外的步骤保存为普通的 Span 结构，在 Trace Tree 页面中依然能正常渲染展示。

## 5. v0.4 Governance Events

### `skill.registry.loaded`

```json
{
  "eventType": "skill.registry.loaded",
  "payload": {
    "skills": 3,
    "skillIds": ["excel-data-analysis", "weekly-report", "code-review"],
    "registryVersion": "skill-registry@0.4.0"
  }
}
```

### `skill.select`

v0.4 的 `skill.select` 应包含候选 Skill、匹配分数和命中依据。

```json
{
  "eventType": "skill.select",
  "payload": {
    "selected_skill_id": "excel-data-analysis",
    "candidates": [
      { "skillId": "excel-data-analysis", "score": 0.93, "matchedBy": ["file_type:.xlsx"], "status": "selected" }
    ],
    "requiredTools": ["xlsx.inspect", "filesystem.write", "python.run"],
    "permissions": ["filesystem.read", "filesystem.write", "process.python"]
  }
}
```

### `tool.policy.check`

```json
{
  "eventType": "tool.policy.check",
  "payload": {
    "decision_id": "perm_001",
    "tool_call_id": "call_001",
    "tool_id": "python.run",
    "riskLevel": "medium",
    "requestedPermissions": ["process.python", "filesystem.write:workspace/output"],
    "decision": "allow",
    "reason": "python.run runs in the fixed workspace sandbox.",
    "policyId": "default-local-policy@0.4.0:allow-medium-sandbox-python"
  }
}
```

### `context.budget.apply` and `context.segment`

```json
{
  "eventType": "context.budget.apply",
  "payload": {
    "contextSnapshotId": "ctx_001",
    "strategy": "balanced-v1",
    "before_tokens": 42100,
    "after_tokens": 28600,
    "maxContextTokens": 32768,
    "risks": [{ "severity": "medium", "message": "conversation_history 占比过高。" }]
  }
}
```

Each `context.segment` records one segment's budget action:

```json
{
  "eventType": "context.segment",
  "payload": {
    "contextSnapshotId": "ctx_001",
    "segment_id": "seg_history",
    "type": "conversation_history",
    "priority": 60,
    "tokens_before": 16000,
    "tokens_after": 7000,
    "action": "summarize",
    "included": true
  }
}
```

### `failure.detected`

```json
{
  "eventType": "failure.detected",
  "payload": {
    "failure_type": "permission_denied",
    "severity": "high",
    "summary": "工具 shell.run 需要人工审批",
    "evidence": [{ "toolCallId": "call_001" }],
    "suggested_fix": "在 Approvals 页面处理该工具调用。",
    "status": "open"
  }
}
```

### `replay.snapshot.created`

```json
{
  "eventType": "replay.snapshot.created",
  "payload": {
    "snapshot_id": "snap_001",
    "snapshot": {
      "input": { "user_message": "分析这个客户清单", "files": [] },
      "versions": {
        "prompt_version": "excel-data-analysis@v0.4",
        "skill_version": "excel-data-analysis@v0.2",
        "context_strategy": "balanced-v1",
        "policy_version": "default-local-policy@0.4.0"
      },
      "model_config": { "provider": "deterministic", "model": "deterministic-local" }
    }
  }
}
```
