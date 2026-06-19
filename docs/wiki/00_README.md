# Jarvis Studio 用户操作手册 Wiki 首页 (v0.5)

欢迎来到 **Jarvis Studio v0.5** 用户操作手册 Wiki！

---

## 1. 项目定位

**Jarvis Studio** 是 Jarvis Agent 的 **0 号工程**。它不是面向终端用户的 Agent 运行载体，而是专为开发者、质量评估人员与发布负责人打造的 **Agent 运行时场景验证、批量评估、全链路可观测、重放调试与准入发布平台**。

在 v0.5 版本中，项目迎来了全面重构，建立了基于 **RuntimeAdapter (运行时适配器)** 的分层治理架构，旨在彻底解决：
- **场景合约闭环**：如何在任务开始前执行 **Preflight (预检)**，并在结束后执行 **Postflight (后检断言)** 合约？
- **沙箱环境隔离**：不同的 Agent 任务如何在独立的 **Eval Workspace (测试工作区)** 中读写文件、生成报告而不相互污染？
- **运行时流式审批**：高危命令（如 `shell.safe_run`）触发时，系统如何进行**内存挂起并等待人工审批恢复 (Resume)**？
- **产物全链路追溯**：在 **Run Artifacts (产物中心)** 产生的文件，究竟能追溯到是哪一轮 LLM 生成的哪次 Tool 调用？
- **轻量级命令行交互**：如何脱离 UI 界面，直接使用命令行客户端 **`jarvis-cli`** 独立运行技能并流式发送 Trace？

---

## 2. 总体架构与技术分层 (v0.5)

Jarvis Studio v0.5 采用了高度模块化的单体仓库 (Monorepo) 进行管理。系统通过引入 **RuntimeAdapter** 抽象，支持多架构 Agent 执行器的拉起和监控：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Jarvis Studio UI (前端)                          │
│ 🔘 实时任务大盘       🔘 评测集与自动化裁判   🔘 智能体控制台 (Console)  │
│ 🔘 运行产物中心 (NEW) 🔘 审批中心 (Resume)     🔘 故障诊断归因            │
└────────────────────────────────────────────────────────────────────────┘
                                    ↑
┌────────────────────────────────────────────────────────────────────────┐
│               Jarvis Studio Server (后端 Fastify)                      │
│ 🔘 任务编排引擎 (EvalTaskRunner)               🔘 场景合约管理器        │
│ 🔘 实时的 SSE 事件推送通道                     🔘 审计日志与加密机      │
└────────────────────────────────────────────────────────────────────────┘
                                    ↑
┌────────────────────────────────────────────────────────────────────────┐
│                 RuntimeAdapter 运行时适配器 (v0.5 NEW)                  │
│               (抽象层，对接不同的智能体执行器)                           │
│       ┌───────────────────────────┴───────────────────────────┐        │
│       ▼                                                       ▼        │
│ LocalRuntimeAdapter (本地适配)                        CLI 适配器       │
│ 绑定本地 agent-runtime 引擎                    通过命令拉起执行并捕获   │
└────────────────────────────────────────────────────────────────────────┘
                                    ↑
┌────────────────────────────────────────────────────────────────────────┐
│                 agent-runtime 智能体运行时 (执行层)                    │
│ 🔘 状态机流程循环      🔘 权限与沙箱引擎       🔘 上下文预算控制引擎        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心对象模型 (Core Data Model)

在 Jarvis Studio v0.5 中，测试实体的建模升级为以下层级关系：

```text
Eval Workspace (工作空间)
  └─ Test Task (测试任务) & Scenario Template (场景合约模板)
       └─ Run (执行运行记录) & Replay Snapshot (备份文件快照)
            └─ Span (事件步骤节点)
                 ├─ skill.select (技能筛选命中)
                 ├─ context.build (上下文预算控制)
                 ├─ tool.policy.check (权限规则拦截)
                 └─ 其他执行 Span (LLMCall, ToolCall, Artifact)
```

- **Eval Workspace (工作空间)**：表示本地文件沙箱。每个工作空间拥有独立的入参和产出产物，不同测试任务在独立工作空间内运行，互不污染。
- **Test Task (测试任务)**：v0.5 的核心实体。一个任务绑定一个场景、输入与具体执行环境，拥有独立的 **Preflight / Postflight** 状态。
- **Scenario Template (场景模板)**：内置的测试套件合约（如数据分析、周报、代码审查），规定了任务运行前后的环境及文件校验规则。
- **Run (执行记录)**：任务启动后产生的实际轨迹记录。在挂起审批时，同一个 Task 在 Resume 时会恢复并继续同一个 Run。

---

## 4. Wiki 操作手册目录 (数字序号自然排序)

请点击以下链接，依序查阅 Jarvis Studio 的各项功能指南：

1. **[01_快速开始 (01_quick-start.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/01_quick-start.md)**
   > 介绍环境依赖、系统安装、启动运行、密钥与命令行工具入门。
2. **[02_评测工作区与智能体控制台 (02_workspaces-and-console.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/02_workspaces-and-console.md)** **`[v0.5 升级重写]`**
   > 介绍 Workspace 沙箱文件管理、在控制台流式跑测试任务、以及 Preflight/Postflight 合约机制。
3. **[03_能力治理与安全审批 (03_capability-governance.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/03_capability-governance.md)**
   > 讲解技能/工具注册表、权限判定、高危工具在内存中挂起与批准恢复（Resume）审批流。
4. **[04_测试任务与 Trace 追踪 (04_tasks-and-trace.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/04_tasks-and-trace.md)** **`[v0.5 升级重写]`**
   > 讲解 Test Tasks 大盘指标、流式事件树（Live Trace Tree）、以及任务运行事件日志。
5. **[05_上下文探针与预算优化 (05_context-inspector.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/05_context-inspector.md)**
   > 介绍上下文片段分配、YAML预算策略配置、Token前后对比与 Risk Hints 超限风险诊断。
6. **[06_评测集与自动化裁判 (06_eval-bench.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/06_eval-bench.md)**
   > 介绍 Dataset 与用例分层、并发回归、LLM-as-Judge 裁判 JSON 评分与 Token 计费成本统计。
7. **[07_测试任务对比与发布准入 (07_task-compare-and-gate.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/07_task-compare-and-gate.md)** **`[v0.5 升级重写]`**
   > 讲解并排比对两个测试任务的配置、指标 Delta、工具调用链、产物及后检断言差异的分析方法。
8. **[08_Prompt 实验室 (08_prompt-lab.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/08_prompt-lab.md)**
   > 介绍在线版本管理、双花括号变量提取及 Mock 调试数据打通。
9. **[09_重放调试与实验矩阵 (09_replay-and-experiments.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/09_replay-and-experiments.md)**
   > 讲解物理快照归档备份、Overrides 重写参数回放、以及 20 个变体上限的并发实验矩阵寻优。
10. **[10_故障诊断与归因分析 (10_failure-diagnosis.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/10_failure-diagnosis.md)**
    > 讲解故障自动捕获（含预检/后检失败）、Suggested Fix 诊断建议、以及 Link-Fix 修复归因。
11. **[11_运行产物中心 (11_run-artifacts.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/11_run-artifacts.md)** **`[v0.5 NEW]`**
    > 介绍产物中心大盘、预览定稿（Mark Final）功能以及文件向工具调用、任务溯源的追溯链。
12. **[12_命令行客户端使用指南 (12_jarvis-cli.md)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/wiki/12_jarvis-cli.md)** **`[v0.5 NEW]`**
    > 介绍独立命令行客户端 `jarvis` 的指令说明、配置加载与流式推送 Trace 的机制。

---

## 5. 底层设计规范与验收标准链接

- **[Trace SDK 规范与数据格式](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/trace-sdk.md)**
- **[agent-runtime 运行时规范与机制](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/agent-runtime.md)**
- **[测试用例 Zod/YAML 规范 (v0.5)](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/eval-case-spec.md)**
- **[v0.5 验收测试报告](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/v0.5-acceptance.md)**
