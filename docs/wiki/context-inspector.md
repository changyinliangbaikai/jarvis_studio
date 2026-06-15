# 上下文探针 (Context Inspector) 使用指南

在 Agent 系统开发中，大模型真正看到的 **Prompt 全貌** 是最核心的机密。许多 Agent 表现异常（例如突然“忘记”指令、对上传的文档“视而不见”），根源往往是上下文注入逻辑出错。

**上下文探针 (Context Inspector)** 是 Jarvis Studio 专门用于诊断大模型输入 Prompt 拼接质量的深度透视工具。

---

## 1. 什么是 Context Snapshot 与 Segments？

### 1.1 Context Snapshot (上下文快照)
每当 Agent 即将调用大模型（触发 `llm.call`）之前，系统会收集当前所有的静态与动态信息，拼装为最终的 Prompt。这个拼接好的 Prompt 整体被称为一个 **Context Snapshot (上下文快照)**。

### 1.2 Context Segment (上下文片段)
一个快照是由多个独立的 **Segment (片段)** 动态拼装而成的。每个 Segment 扮演不同的角色，具有不同的优先级和注入规则。常见 Segment 类型包括：
- **`system_prompt`**：系统的基础全局人格指令。
- **`skill_instruction`**：当前选中的特定 Skill 执行指令（例如 Excel 分析技能说明）。
- **`conversation_history`**：本会话的历史多轮聊天交互记录。
- **`file_summary` / `file_content`**：用户上传或依赖的文件的结构、摘要或原文片段。
- **`tool_descriptions`**：当前允许大模型调用的工具的 JSON Schema 说明。
- **`tool_result`**：上一轮工具调用的执行输出（如有），供模型分析并决定下一步。
- **`memory_context`**：从长期记忆或项目记忆库中检索出的关联片段。

---

## 2. 上下文分析看板的核心功能

当您在 Trace 详情中点击 `context.build` 步骤，或在 Trace Tree 右侧点击 **View Context Snapshot (查看上下文快照)**，将进入专门的探针分析界面。该界面提供以下核心诊断区：

```text
┌────────────────────────────────────────────────────────┐
│ [上下文片段列表 - Segments]                            │
│ 🔘 system_prompt   (base-agent)       1,200 Tokens (✔) │
│ 🔘 skill_instruct  (excel-analysis)   2,600 Tokens (✔) │
│ 🔘 file_summary    (customer.xlsx)    4,200 Tokens (✔) │
│ 🔘 prev_history    (history_turn_1)   4,800 Tokens (✖) │
└────────────────────────────────────────────────────────┘
┌─────────────────────────────────┐┌─────────────────────┐
│ [最终发送的 Prompt 文本]        ││ [Token 占比饼图]     │
│ System: You are Jarvis...       ││ 🟢 file_summary 51%  │
│ User: Please inspect this xlsx  ││ 🔵 skill_inst   32%  │
│ ...                             ││ 🔴 system_pr    17%  │
└─────────────────────────────────┘└─────────────────────┘
```

### 2.1 最终 Prompt 纯文本审查
展示最终无损拼装完成、即将通过 API 递交给模型的底层 Prompt 原文。方便开发者通过简单的检索确认变量是否成功替换、以及格式是否对齐。

### 2.2 Segment 来源列表与注入决策
列出本次拼装所包含的全部 Segment。每一行都会透出：
- 片段名、类型及版本；
- **优先级 (Priority)**：决定了在预算紧张时，哪些 Segment 会被优先保留；
- **注入标志 (`included`)**：以对勾（✔）或叉号（✖）标示该片段最终是否成功送入大模型。如果某项为 `false`，说明该内容可能因为预算不足被截断，或者被规则策略过滤。

### 2.3 Token 占比分析图 (Token Breakdown Chart)
以炫酷的饼图或环形图，实时展示各个 Segment 消耗的 Token 数与占比。
- **作用**：帮助开发者诊断上下文预算分布。如果发现 `conversation_history` 或是某个 `file_content` 占据了 85% 以上的空间，说明上下文策略亟需优化（例如需要引入历史压缩或文件摘要策略），以防费用暴涨或超出模型上下文窗口。

---

## 3. 截断 (Truncated) 与压缩 (Compressed) 调试信号

大模型都有最大上下文限制。当一次任务中注入的上下文可能超限时，Jarvis Studio 会在页面头部醒目标识出以下两个重要信号：

### 3.1 截断信号 (Truncated)
- **原理**：如果计算出的上下文总 Token 超过了配置的 `maxContextTokens`（如 64k），系统会按照 Segment 优先级的倒序，剔除部分内容，甚至截断历史对话。
- **调试警示**：如果快照中 `truncated` 被标红标记为 `true`，请仔细检查未注入（`included: false`）或带有截断标志的 Segment。这代表模型丢失了这部分信息。**这通常是模型开始产生幻觉、或者无法理解用户最新指令的直接原因**。

### 3.2 压缩信号 (Compressed)
- **原理**：为避免硬截断，Agent 可能会采用局部压缩策略（例如把长文本原文通过一个小模型压缩为纯语义的 Summary 再注入）。
- **调试警示**：如果 `compressed` 为 `true`，请查阅对应 Segment 的 `preview`，验证压缩后的摘要是否丢失了原始文件中的关键业务细节（例如特定的数值或字段名称），导致后续模型计算出错。
