# 评测工作台 (Eval Bench) 操作指南

智能体（Agent）的不确定性使得单次调试的成功并不代表整体稳定。在 Prompt、Skill 或模型更换后，我们需要进行批量的、回归式的性能与效果评估。

**评测工作台 (Eval Bench)** 是 Jarvis Studio 用于管理测试集、批量运行回归测试、执行规则评分、LLM 裁判打分、人工审查以及控制发布质量的核心模块。

---

## 1. 测试集管理 (Dataset Management)

在 v0.5 中，系统引入了分层的测试集管理：
- **Eval Dataset (测试数据集)**：表示一个独立的评测集版本（如 `regression` 完整回归集、`smoke` 快速冒烟集），可以在 `/experiments` 或评测台一键激活。
- **Eval Case (测试用例)**：每个用例隶属于特定的 Dataset。用例拥有独立的优先级（`p0` 到 `p3`）以及精细化的 Zod Schema 规则定义。

---

## 2. 三维立体评分机制

为保证评估的业务契合度，Jarvis Studio v0.5 提供了**规则评分、LLM-as-Judge、人工审查**相结合的三维评分模式：

### 2.1 规则客观评分 (Rule-based Scoring)
基于 `ruleScorer.ts` 引擎，系统自动核查 Agent 执行中的 Span 和沙箱文件：
- 检查 `mustCallTools` 与 `mustGenerate` 产物；
- 检查 `mustInclude` 与 `mustNotInclude` 响应文本；
- 检测 `forbiddenToolCalls`（禁止调用的工具，一旦调用总分归零），校验工具执行超时及越权拦截。

### 2.2 大模型裁判 (LLM-as-Judge)
用于对生成式文案（如周报润色质量、报告专业度）进行自动化打分：
1. **裁判配置**：在用例的 `scoring.profile` 中，指定调用的裁判大模型提供商（可在 `/model-providers` 管理）；
2. **打分模版**：使用系统预设的 Judge Prompt 模板，自动比对 Agent 最终响应与预期标准；
3. **结构化输出**：裁判大模型会返回结构化的 JSON 评分数据，从分析准确性、格式合规性等维度进行打分（通常折算为 1-5 分）；
4. **健壮性机制**：如果 Judge 大模型接口发生网络故障或返回了无法解析的错误 JSON，后端会捕获 `judgeError` 并触发重试或标记降级，不会导致整个评测批次崩溃。

### 2.3 人工审查与故障归因 (Human Review)
在评测完成或跑失败时，评估人员可以对评测结果进行人工二次核验：
- **人工评分**：允许手动录入人工分数（1-5分）并填写详细评语（Review comments）；
- **故障缺陷归因**：可直接为本次运行打上故障归因标签（如 `幻觉`、`越权`、`工具链报错`、`提示词缺陷`）；
- **重新聚合**：人工评分保存后，该批次评测看板的平均得分、成功率会立刻基于人工分数重新计算聚合。

---

## 3. Token 计费与成本统计 (Cost Metrics)

大模型调用的 ROI 评估是工程化的重要指标。
- **计费原理**：在 `/model-providers` 面板中，您可以为每个模型配置其在云端或本地的单价：
  - 输入 Token 价格（每 1k token 消耗）
  - 输出 Token 价格（每 1k token 消耗）
- **成本计算公式**：
  $$\text{Cost} = (\text{prompt\_tokens} \times \text{input\_price}) + (\text{completion\_tokens} \times \text{output\_price})$$
- **看板展现**：在评测列表和运行看板中，系统会直观呈现每一个 Case 消耗的 Token 资金，并在看板上方实时汇总本次批量测试消耗的**累计计费成本 (Cost)**，辅助发布决策人员控制成本预算。

---

## 4. 评测报告一键下载

测试完成后：
1. 点击右上角 **Export Report (导出报告)**，系统会提取本次回归测试的全部数据；
2. 自动在后端（`storage/reports/` 目录下）生成一份结构漂亮的 Markdown 评测报告；
3. 报告中会详细对比基线版本，归档所有失败用例的 Trace 链接与故障日志。您可以一键打包下载，作为上线准入的归档证明。

---
[👈 上一页：05_上下文探针与预算优化](05_context-inspector.md) | [首页](00_README.md) | [下一页：07_测试任务对比与发布准入 ➡️](07_task-compare-and-gate.md)
