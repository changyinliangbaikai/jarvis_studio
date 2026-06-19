# 测试任务对比与发布准入 (Release Gate) 指南

Agent 系统的迭代极易引起性能或行为的意外退化。Jarvis Studio v0.5 提供了 **Test Task Compare (测试任务对比)** 与 **Release Gate (发布准入校验)** 功能，为 Agent 的迭代发布层层把关。

---

## 1. 测试任务对比 (Test Task Compare) `[v0.5 重大升级]`

在旧版本中，对比面板仅支持两次简单 Run 的运行指标对比。**在 v0.5 中，系统升级为在测试任务 (Test Task) 级别进行多维并排对比**。

### 1.1 对比核心维度说明
当您在 `/tasks/compare` 页面中输入要比对的左任务（Left / 基线）与右任务（Right / 候选）的 Task ID，系统会提取并排渲染以下差异明细：
1. **任务配置比对 (Dimension Diff)**：比对两个任务所绑定的 Workspace 空间、激活的场景、关联的模型提供商配置和 Overrides 参数。
2. **运行物理指标 (Run Metrics Diff)**：对比总延迟 (Latency)、Token 消耗（分为输入与输出）、总资金成本 (Cost) 及客观评测均分。
3. **工具链调用比对 (Tool Usage Diff)**：分析两个版本在工具调用频次（如调用 `xlsx.inspect` 多少次）、调用顺序上的不同。
4. **产出物对比 (Run Artifacts Diff)**：高亮展示两个任务生成的文件产物大小、类型与路径，并可以直接进行并排预览。
5. **审批决策对比 (Approvals Diff)**：展现人工审批干预的情况。
6. **后检断言比对 (Postflight Check Diff)**：**这是诊断行为退化的利器**。系统会拉出两个任务执行的 Postflight 规则列表，并高亮对比出哪些断言原本通过而现在失败（或反之），精确追踪业务逻辑改动后的断言异同。

---

## 2. Release Gate (发布准入门槛) 校验

**Release Gate** 是基于批量评测数据，对某个特定的 Prompt/Skill 版本进行上线准入的强判定机制。

### 2.1 门槛指标配置
在后端（[ruleScorer.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/packages/permission-engine/src/governance.ts) 或者是评测包中），准入门槛支持以下 7 个指标的上下限校验：

- **`passRate` (最低用例通过率)**：*下限校验*。回归测试用例的通过比例（如 `>= 0.85`）。
- **`avgScore` (最低平均分)**：*下限校验*。批量评测得分的平均分（如 `>= 4.0`）。
- **`toolCallAccuracy` (工具正确率)**：*下限校验*。调用工具的成功比例。
- **`artifactSuccessRate` (产物成功率)**：*下限校验*。预期文件生成成功的比例。
- **`maxUnauthorizedCalls` (最大越权次数)**：*上限校验*。发生越权调用的次数（通常严格限制为 `<= 0`）。
- **`maxFabricatedColumns` (最大编造字段次数)**：*上限校验*。幻觉编造字段的次数（限制为 `<= 0`）。
- **`avgLatencyMs` (最大耗时限制)**：*上限校验*。平均响应时长上限，防止大模型陷入死循环或解码过慢。

### 2.2 准入判定：PASS 还是 BLOCK？

在 Compare 页面的底部会渲染 **Release Gate** 指标状态板：
1. 系统会自动捞取目标版本在数据库 `eval_results` 中的所有历史评测记录，实时算出这 7 个指标的实际表现；
2. 将实际值与设定的门槛条件进行逐一对比；
3. **判定结果**：
   - **PASS (通过准入)**：实际指标**全部满足**门槛条件。这代表该版本达到了上线质量，可以在生产环境发布。
   - **BLOCK (拦截发布)**：**只要有任意一项实际指标未达标**（例如发生了 1 次未授权越权调用，或平均耗时超标了 500ms），系统会立刻给出红牌拦截（BLOCK），并高亮标出导致拦截的具体未达标项。

> [!IMPORTANT]
> **发布铁律：**
> 在自动化 CI/CD 流程中，您可以调用后端 `POST /api/release-gate` 接口。如果返回结果为 `pass: false` (即 BLOCK)，则必须中止发布包的流水线。这构成了 Agent 上线前最坚固的工程防线。

---
[👈 上一页：06_评测集与自动化裁判](06_eval-bench.md) | [首页](00_README.md) | [下一页：08_Prompt 实验室 ➡️](08_prompt-lab.md)
