# 版本对比与发布准入 (Release Gate) 操作指南

Agent 系统的迭代（改动一段 Prompt 指令、替换基座大模型、或调整 Skill 参数）都极易引起性能或效果的意外退化。Jarvis Studio 提供了 **Compare (版本对比)** 与 **Release Gate (发布准入门槛)** 功能，为 Agent 的版本发布把好最后一关。

---

## 1. Compare (版本对比) 页面

Compare 页面允许您在三个不同的控制变量维度下，对多次运行聚合的多项指标进行横向对比，并精确计算两者的差异（Delta）。

### 1.1 支持的对比维度
- **Prompts**：对比不同版本的提示词（如 `excel-analysis@v0.1` vs `excel-analysis@v0.2`）。
- **Models**：对比相同业务在不同模型下的运行表现（如 `qwen3.6-35b-a3b` vs `gpt-4o`）。
- **Skills**：对比激活不同业务技能包时的表现差异。

### 1.2 聚合指标与 Delta 计算

在对比界面中，您需要分别输入要对比的 **Left (左版本/基线)** 和 **Right (右版本/候选)** 版本标识。系统将聚合统计并输出以下指标的对比及 Delta 变化量（**Delta = 右实际值 - 左实际值**）：

| 评估指标 | 含义说明 | 期望的 Delta 方向 |
|---|---|---|
| **Run Count** | 对应的历史运行总次数。 | - |
| **Success Rate (成功率)**| 状态为 `success` 的运行比例。 | 📈 **Delta > 0** (代表成功率提升) |
| **Average Score (平均分)** | 所有运行对应的规则评测平均分。 | 📈 **Delta > 0** (代表效果变好) |
| **Average Latency (平均延迟)**| 单次运行的平均执行时间。 | 📉 **Delta < 0** (代表运行速度加快) |
| **Average Tokens (平均Token)** | 每次运行平均消耗的 Token 总数。 | 📉 **Delta < 0** (代表运行成本降低) |
| **Tool Errors (工具错误)** | 工具执行失败或抛错的总次数。 | 📉 **Delta < 0** (代表代码及调用越发稳定) |

---

## 2. Release Gate (发布准入门槛) 校验

**Release Gate** 是基于批量评测数据，对某个特定的 Prompt/Skill 版本进行上线准入的强判定机制。

### 2.1 门槛指标配置
在后端（[ruleScorer.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/packages/eval-runner/src/ruleScorer.ts)）中，准入门槛支持以下 7 个指标的上下限校验：

- **`passRate` (最低用例通过率)**：*下限校验*。回归测试用例的通过比例（如 `>= 0.85`）。
- **`avgScore` (最低平均分)**：*下限校验*。批量评测得分的平均分（如 `>= 4.0`）。
- **`toolCallAccuracy` (工具正确率)**：*下限校验*。调用工具的成功比例。
- **`artifactSuccessRate` (产物成功率)**：*下限校验*。预期文件生成成功的比例。
- **`maxUnauthorizedCalls` (最大越权次数)**：*上限校验*。发生越权调用的次数（通常严格限制为 `<= 0`）。
- **`maxFabricatedColumns` (最大编造字段次数)**：*上限校验*。幻觉编造字段的次数（限制为 `<= 0`）。
- **`avgLatencyMs` (最大耗时限制)**：*上限校验*。平均响应时长上限，防止大模型陷入死循环或解码过慢。

### 2.2 准入判定：PASS 还是 BLOCK？

在 Compare 页面的底部会渲染 **Release Gate** 指标状态板：
1. 系统会捞取目标版本在数据库 `eval_results` 中的所有历史评测记录，实时算出这 7 个指标的实际表现；
2. 将实际值与设定的门槛条件进行逐一对比；
3. **判定结果**：
   - **PASS (通过准入)**：实际指标**全部满足**门槛条件。这代表该版本达到了上线质量，可以在生产环境发布。
   - **BLOCK (拦截发布)**：**只要有任意一项实际指标未达标**（例如发生了 1 次未授权越权调用，或平均耗时超标了 500ms），系统会立刻给出红牌拦截（BLOCK），并高亮标出导致拦截的具体未达标项。

> [!IMPORTANT]
> **发布铁律：**
> 在自动化 CI/CD 流程中，您可以调用后端 `POST /api/release-gate` 接口。如果返回结果为 `pass: false` (即 BLOCK)，则必须中止发布包的流水线。这构成了 Agent 上线前最坚固的工程防线。
