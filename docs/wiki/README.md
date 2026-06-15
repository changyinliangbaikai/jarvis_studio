# Jarvis Studio 用户操作手册 Wiki 首页 (v0.2)

欢迎来到 **Jarvis Studio v0.2** 用户操作手册 Wiki！

---

## 1. 项目定位

**Jarvis Studio** 是 Jarvis Agent 的 **0 号工程**。它不是面向最终用户的 Agent 产品，而是专为开发者、质量评估人员与发布决策者打造的 **Agent 工程调试工作台**。

在复杂的智能体系统中，单纯依靠优化大模型的 Model Prompt 往往无法解决绝大多数稳定性与可解释性问题。我们需要回答以下核心工程问题：
- Jarvis Agent 某次任务为什么成功或失败？
- 哪些上下文、对话历史、Skill 指令、工具结果真正被拼接送入了 Prompt？
- 模型生成的工具调用参数是否正确？结果如何被注入下一轮对话？
- 改动 Prompt 或 Skill 版本后，Agent 的全局表现究竟是变好了还是变差了？
- 某次能力的改动是否达到了上线发布的安全与质量门槛？

Jarvis Studio 的核心理念就是：
> **先让智能体可观察，再让智能体变智能；先让效果可度量，再谈能力可扩展。**

---

## 2. 总体架构与技术分层

在 v0.2 版本中，Jarvis Studio 引入了真实的轻量级智能体运行时 **Jarvis Runtime Lite**。系统不仅能导入外部静态 Trace 日志，还能在本地启动智能体、执行真实的业务工具链并以 Server-Sent Events (SSE) 事件流实时观察运行轨迹。其核心分层结构如下：

```text
┌─────────────────────────────────────────────┐
│                 Jarvis Studio UI (前端)      │
│ Runs / Trace / Context / Prompts / Evals      │
│ 🔘 新增：智能体控制台 (Runtime Console)      │
│ 🔘 新增：运行对比 (Run Compare) 视图         │
└─────────────────────────────────────────────┘
                      ↑
┌─────────────────────────────────────────────┐
│              Jarvis Studio Server (后端)     │
│ Node.js + Fastify + SQLite3 本地数据库       │
│ 🔘 新增：SSE 实时事件流与运行时集成服务        │
└─────────────────────────────────────────────┘
                      ↑
┌─────────────────────────────────────────────┐
│    Jarvis Runtime Lite (运行时 - v0.2 新增)  │
│ 🔘 真实 Agent 状态循环与 OpenAI 模型调用       │
│ 🔘 真实沙箱工具链 (文件读写、Python 运行等)   │
└─────────────────────────────────────────────┘
```

---

## 3. 核心对象模型 (Core Data Model)

在 Jarvis Studio 中，数据按以下层级逻辑进行组织和建模：

```text
Project (项目空间)
  └─ Session (会话线程)
       └─ Turn (多轮对话交互)
            └─ Run (执行运行记录)
                 └─ Span (事件步骤节点)
                      ├─ LLMCall (模型调用细节)
                      ├─ ToolCall (工具执行与授权)
                      ├─ ContextSnapshot (上下文快照)
                      └─ Artifact (产物输出文件)
```

- **Project (项目)**：一个独立的 Agent 能力项目空间。例如“银行周报生成”、“Excel 自动报表分析”等。
- **Session (会话)**：一次完整的任务处理或一个多轮对话线程。
- **Turn (交互轮次)**：会话中的一轮问答。即用户发起的一条指令与 Agent 给出的响应。
- **Run (执行记录)**：在一个 Turn 下每次实际的执行轨迹。在 v0.2 中，您可以通过**智能体控制台**一键触发一次真实运行，或在评测批量执行时发起运行，每次执行都会产生唯一的 Run 记录。
- **Span (步骤节点)**：一个 Run 内部执行的最小逻辑片段。例如：`context.build`（上下文拼接）、`llm.call`（模型请求）、`tool.call`（工具执行）、`artifact.write`（文件输出）或自定义异常。

---

## 4. Wiki 操作手册总目录

请通过以下文档链接深入探索 Jarvis Studio 的各项功能模块：

1. **[快速开始 (quick-start.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/quick-start.md)**
   > 介绍环境准备、系统安装、启动运行、环境配置、以及如何导入首个 `trace.jsonl` 日志文件。
2. **[智能体控制台 (runtime-console.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/runtime-console.md)** **`[v0.2 NEW]`**
   > 介绍如何在控制台与真实智能体交互、激活内置技能、以及文件沙箱的安全保护规则。
3. **[实时监控与 Trace 对比 (dashboard-and-trace.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/dashboard-and-trace.md)**
   > 讲解 Runs 列表、SSE 实时事件流在运行中的流式渲染、以及如何对比任意两份 Run 的数据明细。
4. **[上下文探针 (context-inspector.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/context-inspector.md)**
   > 介绍如何深入审查大模型接收的 Prompt、各 Segment 的 Token 占比与截断压缩诊断。
5. **[评测工作台 (eval-bench.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/eval-bench.md)**
   > 介绍在 v0.2 下如何运行基于真实 Agent 引擎的批量回归评测、客观评分及一票否决规则。
6. **[对比分析与发布准入 (compare-and-gate.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/compare-and-gate.md)**
   > 讲解如何在 Prompt、Model、Skill 维度对多次 Run 的指标进行 Delta 聚合对比，以及 Release Gate 判定逻辑。
7. **[Prompt 实验室 (prompt-lab.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/prompt-lab.md)**
   > 介绍如何在线创建 Prompt 版本、自动提取入参变量并在 Mock 环境中调试 Prompt 效果。

---

## 5. 底层核心格式与运行时规范

在进行二次开发或将您的 Jarvis Runtime 与 Jarvis Studio 进行联调时，请务必参考以下底层的格式标准文档：
- **[Trace Event 事件流规范](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/trace-schema.md)**
- **[测试用例 YAML 字段规范](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/eval-case-spec.md)**
- **[Jarvis Runtime Lite 运行机制与规范](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/runtime-lite.md)** **`[v0.2 NEW]`**
