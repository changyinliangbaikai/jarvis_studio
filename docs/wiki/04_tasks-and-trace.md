# 测试任务、实时事件与 Trace 追踪指南

在 Jarvis Studio v0.5 中，**Test Tasks (测试任务)** 是进行智能体评估与追踪的最小编排实体。本指南将协助您在工作台上监控测试任务的执行过程并利用 Trace 进行深度排障。

---

## 1. Test Tasks 大盘 (测试任务列表)

所有的智能体本地执行和评测运行，在 v0.5 中都会被注册为一个 **Test Task**。进入 `/tasks` 测试任务列表，您可以对每一个任务进行全方位的生命周期监控：

### 1.1 核心大盘指标说明
- **Task / Workspace**：任务的名称，以及本次运行所隔离绑定的本地文件工作空间（Workspace）；
- **Preflight & Postflight 状态灯**：
  - **`Preflight` 状态灯**：Passed (代表前置预检全部通过，环境正常) 或 Failed (预检报错，拦截启动)；
  - **`Postflight` 状态灯**：Passed (后置合约检查 100% 达标) 或 Failed (产物未生成，或未满足关键词断言)；
- **状态 (Status)**：包含 `success`（成功）、`failed`（失败）、`waiting_approval`（挂起等待审批）与 `cancelled`（已被人工强行终止）；
- **Score (总得分) & Cost (资金成本)**：自动计算出的客观评测均分，以及本次运行消耗的实际大模型 Token 资金费用。

---

## 2. Task Events Log (任务事件日志) `[v0.5 NEW]`

点击任意一个任务，进入详情页面。在底层的 Trace 树上方，系统专门提供了一个 **Task Events Log (任务日志)** 时间线：
- **可读性时间线**：它用简单直白的语言，按时间先后顺序记录了任务编排引擎（`EvalTaskRunner`）生命周期的所有里程碑大事件：
  ```text
  [10:00:00]  🚀 任务预检 (Preflight) 开始...
  [10:00:01]  ✔  预检通过 (Passed)！ input/customer_data.xlsx 文件已就绪。
  [10:00:01]  ⚙️  LocalRuntimeAdapter 启动智能体进程，Run ID: run_abc123...
  [10:00:15]  ⚠️  高危命令 shell.safe_run 被拦截！任务进入挂起状态，等待人工审批...
  [10:00:30]  ✔  审批批准！进程在原内存中恢复运行。
  [10:00:45]  🏁  智能体运行完毕。
  [10:00:46]  🔍  任务后检 (Postflight) 合约校验开始...
  [10:00:47]  ✔  后检通过 (Passed)！成功生成 analysis_report.md。
  [10:00:47]  🎉  测试任务执行成功，最终评分: 5.0，计费成本: $0.015。
  ```
- **作用**：即使是非开发背景的人员，通过这行时间线日志，也能一眼看清任务是在哪一步卡住（如等待审批）、或者是在哪一步失败（如预检/后检失败）。

---

## 3. SSE 实时事件流与 Trace Tree 调试

当任务在后台执行时，后端会开启流式数据通道：`GET /api/runtime/runs/:runId/events`，前端的 Trace Tree 将会流式动态渲染：
- **实时生长**：左侧的 **Trace Tree** 树状图无需手动刷新，会随着进程的前进而动态长出新的子 Span，并在界面上实时呈现当前的耗时；
- **治理概要看板 (Governance Summary)**：详情页顶部实时渲染本次测试的治理卡片，包含技能选择、权限决策、预算优化百分比、故障异常及文件物理快照状态。

---

## 4. Span Detail (节点详情) 解析

不同类型的节点，点击后会在右侧详情面板中透出具体的物理参数：
1. **`llm.call`**：展示模型输入 Prompt 原文、首 Token 延迟 (TTFT)、预填充耗时 (Prefill) 与流式解码 TPS 性能统计；
2. **`tool.call`**：展示工具名称（如新增的 `git.status` 等）、参数、执行时长、退出状态码、以及 stdout / stderr 详细日志；
3. **`context.build`**：展示上下文最终拼接结果、各片段优先级、Token 占比饼图以及裁剪动作分析。

---
[👈 上一页：03_能力治理与安全审批](03_capability-governance.md) | [首页](00_README.md) | [下一页：05_上下文探针与预算优化 ➡️](05_context-inspector.md)

