# 测试用例规范 (Eval Case Spec) 说明 v0.3

为了对 Jarvis Agent 的能力进行可量化、可持续的评估，我们需要定义标准的测试用例。Jarvis Studio 能够导入 YAML 或 JSON 格式的测试用例文件，并基于预设的规则进行自动化的批量评分与发布准入校验。

本篇文档将详细说明 **Eval Case Spec v0.1** 的字段定义及用例文件格式。

---

## 1. Zod 数据模型结构

在后端 `packages/eval-runner/src/evalCase.ts` 中，Dataset 与 Case 均通过 Zod schema 验证。v0.3 同时接受规划文档中的 snake_case YAML 和内部 camelCase 结构。

| 字段路径 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | `string` | *(必填)* | 测试用例的全局唯一 ID |
| `dataset_id` | `string` | Dataset 导入时绑定 | 所属版本化测试集 |
| `name` | `string` | *(必填)* | 测试用例的可读性名称 |
| `category` | `string` | *(必填)* | 测试类型归类（如 `data-analysis`、`coding`、`office` 等） |
| `priority` | `p0-p3` | `p1` | 发布优先级 |
| `version` | `string` | `1.0.0` | Case 版本 |
| `tags` | `string[]` | `[]` | 标签列表，用于归类检索 |
| `input` | `object` | *(必填)* | 输入配置，包含：`message`（指令）与 `files`（依赖文件列表） |
| `runtime_overrides` | `object` | `{}` | Skill、模型、超时、重试等单 Case 覆盖项 |
| `expected` | `object` | *(必填)* | 预期的执行产物与行为约束 |
| `scoring` | `object` | *(必填)* | 评分系统配置，如最高分及各维度权重 |
| `pass_criteria` | `object` | `{ min_total_score: 4 }` | 最低总分和硬性 required checks |

---

## 2. 核心对象详解与评分机制

### 2.1 expected (期望行为约束)
用于定义规则评分器（Rule Scorer）的逻辑规则。包含以下匹配方式：

- **`must_select_skill`** (`string[]`)：必须选择的 Skill。
- **`must_call_tools`** (`string[]`)：大模型或 Agent 在执行过程中**必须调用**的工具名称列表。
- **`forbidden_tool_calls`** (`string[]`)：绝对禁止调用的工具名称。
- **`mustGenerate`** (`Array<{ type: string, nameContains?: string }>`)：必须生成的产物（Artifact）列表。指定产物类型（如 `xlsx`, `markdown`）及路径包含的关键字（如文件名模糊匹配）。
- **`mustInclude`** (`string[]`)：Agent 最终给出的响应文本中**必须包含**的关键词或语句。
- **`mustNotInclude`** (`string[]`)：Agent 最终响应文本中**绝对不能包含**的错误文案或禁止语句（用于防幻觉/负面校验）。
- **`constraints`** (`object`)：硬性约束。目前核心校验为 `noUnauthorizedCalls: true`，代表运行中如果发生未经授权的系统越权操作（例如破坏性 Shell 调用或未经审批的敏感接口），则会触发越权拦截。

> [!IMPORTANT]
> **“一票否决”通过机制**：
> 评分器在给单条测试打分时，首先计算通过的 expected 条目数占比，然后乘以 `scoring.maxScore` 作为最终得分。
> 但是，如果用例包含的 **任意一项预期条件** 没有被满足，或者得分未达到准入门槛 `releaseGate.minScore`（默认 4 分），即使其他项完全正确，本测试用例的 `pass` 指标也会被判定为 **`false`（不通过）**。

### 2.2 scoring (评分设定)
- **`maxScore`** (`number`, 默认 5)：此测试用例的最高分上限。
- **`dimensions`** (`Array<{ name: string, weight: number }>`)：可读的多个评分维度。

---

## 3. 标准测试集 YAML 范例

下面是一份完整的测试用例 YAML 文件内容范例。它展示了如何定义一个针对 **Excel 客户清单异常分析** 的能力评测：

```yaml
id: excel_001
name: 客户清单异常分析
category: data-analysis
tags:
  - excel
  - customer
  - anomaly
input:
  message: "分析这个客户清单，找出异常客户，并给出营销建议。"
  files:
    - path: fixtures/data/customer_list.xlsx
      required: true
config:
  model: qwen3.6-35b-a3b
  promptVersion: excel-analysis@v0.1
  skill: excel-data-analysis@v0.1
expected:
  mustCallTools:
    - xlsx.inspect
    - python.run
  mustGenerate:
    - type: markdown
      nameContains: 分析报告
    - type: xlsx
      nameContains: 异常客户
  mustInclude:
    - 数据概况
    - 异常客户
    - 营销建议
  mustNotInclude:
    - 无法分析
    - 数据不足但未说明原因
  constraints:
    noUnauthorizedCalls: true
scoring:
  maxScore: 5
  dimensions:
    - name: 工具调用正确性
      weight: 1.0
    - name: 分析准确性
      weight: 1.5
    - name: 结论可执行性
      weight: 1.0
releaseGate:
  minScore: 4.0
```

---

## 4. 导入与运行

1. **批量导入**：您可以通过 Jarvis Studio 评测界面上传包含多段用例的 YAML 文件，或者发送 `POST /api/eval-cases/import-yaml` 接口来批量存储测试集。
2. **模拟评估**：当您在页面点击运行时，系统的 Mock Runtime 服务会自动提取 `expected` 规则，组装符合预期的 Trace 事件流注入到 `traceImportService`，以便在本地对评分匹配逻辑进行端到端的冒烟测试。
