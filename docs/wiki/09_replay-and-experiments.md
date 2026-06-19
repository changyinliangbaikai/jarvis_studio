# 重放调试与实验矩阵操作指南

大模型与智能体的调试极易受到环境文件变化和参数交叉干扰的影响。为了能够实现科学的“控制变量式”调试与批量参数寻优，Jarvis Studio v0.5 提供了 **Replay Snapshot (环境重放快照)** 与 **Experiment Matrix (实验矩阵)** 平台。

---

## 1. 重放快照与环境备份 (Replay Snapshot)

在调试 Agent 任务时，如果智能体由于某种原因失败（如处理 Excel 报错），随着时间的推移或本地文件的更改，您可能无法复现当时的失败场景。

### 1.1 物理快照自动备份
- **触发机制**：每当一次 Run 在控制台或评测中运行结束（无论是 `success` 还是 `failed`），运行时都会触发 `replay.snapshot.created` 事件；
- **备份动作**：快照管理器会立即扫描当前沙箱工作空间（`fixtures/runtime-workspace/`）中该 Run 依赖的全部输入文件副本，并将它们原封不动地物理复制归档到专用存储目录下：
  `storage/snapshots/<runId>/`
- **指纹追踪**：系统会自动记录下每个备份文件的 SHA-256 指纹、大小 (Bytes)；若发生文件缺失，也会把缺失原因详细记入快照数据库 `replay_snapshots`。

### 1.2 敏感密钥擦除规则
- **安全拦截**：为防止通过导出快照包而泄露机密，**所有物理快照归档中绝对不保存 API Keys 或任何大模型提供商密钥**。
- **解析机制**：在执行重放时，系统会自动解压快照中的输入文件，并通过您本地当前配置的 Model Provider Registry 去解析加密的 API Key。

---

## 2. 任务级别参数重写重放 (Test Task-level Replay with Overrides)

获取了测试任务的环境快照后，您可以在测试任务（Test Task）详情页点击 **Replay with Overrides** 按钮，进行控制变量的“沙箱回放”。

### 2.1 任务级别 Overrides 重写机制
从 v0.5 开始，重放已由原先的单次运行（Run）维度升级为**测试任务（Test Task）**维度。由于每个 Test Task 均绑定一个独立的 **Eval Workspace** 沙箱，重放不仅能保留当时的文件环境快照，还能通过在 Task 级别下发 Overrides 参数组合，在当前沙箱中触发一次全新的 Run 执行。

在弹出的配置面板中，您可以勾选并重写以下任意一项（或多项）运行环境参数：
- **模型提供商与具体模型**：如将原本报错的本地 `qwen3` 覆盖重写为 `gpt-4o` 再次回放；
- **提示词版本 (Prompt)**：使用优化后的 Prompt v0.3 覆盖原有的 v0.1；
- **激活技能 (Skill)** 与 **上下文预算策略 (Context Strategy)**；
- **工具权限策略 (Tool Policy)**：如为防高危拦截，将权限策略放宽或收紧。
- **回放执行**：点击 Replay，系统会基于快照中的原始文件和重写后的参数，在当前工作区沙箱下启动一次全新的 Run 执行，方便您直接核对“仅微调 Prompt”或“仅更换模型”对本次任务处理的具体影响。

---

## 3. 控制变量实验矩阵 (Experiment Matrix)

当我们需要在多个模型、多套 Prompt 以及不同的上下文控制策略之间选择最佳组合时，手动比对极为低效。v0.5 推出了 **Experiment Matrix (实验矩阵)** 平台。

```text
       [多维矩阵配置]
       - 评测数据集 (Dataset)  ──► smoke_test
       - 候选模型提供商       ──► [deterministic, openai-compatible]
       - 候选提示词版本       ──► [base-agent@v0.1, base-agent@v0.2]
       - 候选上下文预算策略   ──► [balanced-v1, budget-strict]
                             │
                             ▼
                 [实验调度器 (Matrix Builder)]
                             │
            ┌────────────────┴────────────────┐  (交叉乘积组合，上限 20 个)
            ▼                                 ▼
      [变体 1 - Variant]                 [变体 2 - Variant]
      qwen3 x Prompt@v1                  gpt-4o x Prompt@v2
      x balanced-v1                      x budget-strict
            │                                 │
            ▼                                 ▼
      执行批量回归评测                   执行批量回归评测
            └────────────────┬────────────────┘
                             ▼
                     [实验矩阵结果面板]
           - 对比成功率、通过率、延迟、资金成本
           - 🏆 自动计算并高亮推荐: Best Variant (最佳变体)
```

### 3.1 实验构建流程
1. 在页面导航进入 **Experiments** 页面，点击 **New Experiment (新建实验)**；
2. 在矩阵构建面板（Matrix Builder），勾选参与本次对比的参数集合：
   `测试集 (Dataset) x 模型提供商 x 具体模型 x 提示词版本 x 技能 x 上下文策略 x 权限策略`；
3. **并发调度与安全限制**：
   - 点击运行后，后台实验引擎会自动计算出所有参数的交叉乘积变体（Variants）；
   - **门槛限制**：为防止 accidental runaway（因勾选过多产生爆炸式并发进而耗尽 API 额度），**单次实验的变体总数硬性上限为 20 个**；
   - 调度器会为每个变体分拆启动独立的批量评测（Eval Runs），并发执行测试。

### 3.2 最佳变体 (Best Variant) 智能寻优
实验完成后，页面将输出多维矩阵比对大表。系统会基于以下规则：
- 首先筛选出 **通过率最高** 且 **未触发严重越权/故障拦截** 的变体组合；
- 如果通过率相同，优先推荐 **平均延迟最低** 且 **计费 Token 成本 (Cost) 最低** 的组合；
- 在面板顶部以金牌勋章高亮推荐 **🏆 Best Variant (最优参数变体组合)**，为您提供大模型工程选型的终极科学决策依据。

---
[👈 上一页：08_Prompt 实验室](08_prompt-lab.md) | [首页](00_README.md) | [下一页：10_故障诊断与归因分析 ➡️](10_failure-diagnosis.md)
