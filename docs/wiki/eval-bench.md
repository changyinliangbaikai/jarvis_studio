# 评测工作台 (Eval Bench) 操作指南

智能体（Agent）的不确定性使得单次调试的成功并不代表整体稳定。在 Prompt、Skill 或模型更换后，我们需要进行批量的、回归式的性能与效果评估。

**评测工作台 (Eval Bench)** 是 Jarvis Studio 用于管理测试用例、批量运行回归评测、执行规则评分以及控制发布质量的核心模块。

---

## 1. 批量回归评测流程 `[v0.2 升级：真实运行]`

在 v0.1 版本中，评测工作台仅支持 Mock 模拟事件注入；**在 v0.2 中，评测工作台已与真实的智能体引擎 Jarvis Runtime Lite 进行了深度集成。系统将真实启动 Agent 并在工作空间沙箱中完成工具调用和文件输出！**

### 1.1 第一步：导入测试集 (Eval Cases)
1. 在顶部导航进入 **Eval Bench (评测工作台)** 页面。
2. 点击右上角的 **Import YAML (导入 YAML)** 按钮。
3. 选择内置的种子测试文件：
   `fixtures/evals/builtin.yaml`
4. 确认后，系统会将内置的 **15 个标准评测用例** 录入本地数据库。

### 1.2 第二步：启动真实批量回归测试
1. 在列表中勾选您想参与本次测试的测试用例（支持勾选全部 15 个用例进行全量回归）；
2. 在右上角参数框中，配置目标 **Prompt 版本**（系统 v0.2 默认为 `base-agent@v0.2`）；
3. 点击 **Run Selected Cases (运行选中的测试)**；
4. **沙箱并发执行**：后端（[evalService.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/apps/server/src/services/evalService.ts)）会针对每个用例触发 `executeRuntimeRun`：
   - 在 `fixtures/runtime-workspace` 沙箱中加载指定的 Skill；
   - 载入依赖输入文件（如 `customer_data.xlsx`、`sample.ts`）；
   - 执行真实的工具链（包括解析表格、写出脚本、跑 Python 命令、写出报告等）；
   - 提取真实的执行响应文本、工具链序列及最终输出文件产物送入评分器。

---

## 2. 深入理解规则评分算法 (Rule Scorer)

评测工作台核心使用 [ruleScorer.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/packages/eval-runner/src/ruleScorer.ts) 中的逻辑来对真实运行产生的轨迹进行客观指标打分。

### 2.1 评分检查维度
系统会基于用例中声明的 `expected` 期望值，对以下 5 个维度建立布尔检查项（Checks）：
1. **调用工具约束 (`mustCallTools`)**：检查 Agent 执行过程中的所有 Span。如果没有包含用例列表里的每一个工具（例如 `xlsx.inspect`），该子检查项即为不通过。
2. **必须包含文本 (`mustInclude`)**：验证 Agent 的最终响应文字（`assistantMessage`）中是否包含特定的业务关键词或断言。
3. **不能包含文本 (`mustNotInclude`)**：验证 Agent 响应中是否绝对不含特定的敏感词或错误断言（幻觉防御）。
4. **必须生成产物 (`mustGenerate`)**：核查 Agent 写入并落盘的 Artifact 文件。必须同时匹配产物类型 `type` (如 `xlsx`) 且文件名包含 `nameContains` (如 `异常客户`) 关键字。
5. **合规性硬约束 (`noUnauthorizedCalls`)**：若用例的限制条件中设置了 `noUnauthorizedCalls: true`，且本次执行发生了任何未授权调用，该项即为不通过。

---

## 3. 评分计算与一票否决机制

### 3.1 评分公式
每次测试运行结束后，系统会汇总上述所有检查项，并按下式计算客观得分：
$$\text{Ratio (通过率)} = \frac{\text{通过的子检查项数量}}{\text{声明 of 子检查项总数量}}$$
$$\text{Score (得分)} = \text{Ratio} \times \text{scoring.maxScore} \quad (\text{结果保留两位小数})$$

### 3.2 判定通过 (Pass)
这是评测中**最关键的门槛概念**。一次评测要被判定为 **`Pass (通过)`**，必须**同时满足**以下两个硬性条件：
1. **得分及格**：最终计算得出的 `Score` 必须大于等于发布门槛 `releaseGate.minScore`（若用例中未设定，默认为 4 分）。
2. **一票否决**：**所有声明的子检查项必须全部通过 (100% pass)**。
   $$\text{Pass} = (\text{Score} \ge \text{minScore}) \land (\forall c \in \text{Checks}, c.\text{pass} = \text{true})$$

> [!CAUTION]
> **警示：一票否决的作用**
> 由于评测用例的执行现在是**真实运行**，Agent 有可能会因为大模型随机性导致漏调某步工具或少答某个词。即使其得分很高（如 4.8分），但只要有一项 `mustGenerate` 文件没有成功在沙箱中写出，其最终状态仍会被标记为 **✖ Failed**。这种严苛的校验模式能最大化暴露 Agent 的不稳定性。

---

## 4. 评测指标看板

评测运行完毕后，页面上方会生成聚合的实时统计：
- **Total Cases (总测试数)**：本次勾选测试的总数。
- **Passed / Pass Rate (通过率)**：达到 `Pass` 判定的用例数占比。
- **Average Score (平均分)**：所有用例的平均得分。

这组数据是发布决策的关键输入，也是 Compare 和 Release Gate 进行准入控制的数据源头。
