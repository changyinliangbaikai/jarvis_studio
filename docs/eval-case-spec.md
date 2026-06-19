# 测试用例规范 (Eval Case Spec) 说明 v0.4

为了对 Jarvis Agent 的能力进行可量化、可持续的评估，我们需要定义标准的测试用例。Jarvis Studio 能够导入 YAML 或 JSON 格式的测试用例文件，并基于 v0.4 的规则评分引擎与大模型裁判，执行批量的自动化回归。

本篇文档定义了 **Eval Case Spec v0.4** 的最新字段规范。

---

## 1. Zod 数据模型结构 (v0.4 升级)

在后端（[evalCase.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/packages/eval-runner/src/evalCase.ts)）中，每一个用例除了基础的 ID 和输入外，新增了优先级分流、禁用工具断言和定制化通过门槛：

| 字段路径 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | `string` | *(必填)* | 测试用例的全局唯一 ID |
| `datasetId` | `string` | `undefined` | 隶属的评测数据集 ID |
| `name` | `string` | *(必填)* | 用例名称 |
| `category` | `string` | *(必填)* | 业务分类（如 `data-analysis`, `code-review`） |
| `priority` | `'p0' \| 'p1' \| 'p2' \| 'p3'` | `'p1'` | **`v0.4 新增`** 用例优先级，P0 用例失败通常会直接阻断发布 |
| `version` | `string` | `'1.0.0'` | **`v0.4 新增`** 用例的版本号 |
| `tags` | `string[]` | `[]` | 标签分类 |
| `input` | `object` | *(必填)* | 输入：`message`（指令）与 `files`（依赖文件列表） |
| `runtimeOverrides` | `object` | `{}` | **`v0.4 新增`** 运行覆盖参数（如重写大模型、策略等） |
| `expected` | `object` | *(必填)* | **`v0.4 升级`** 期望的行为和产物约束规则 |
| `scoring` | `object` | *(必填)* | **`v0.4 升级`** 评分设置及打分维度，支持 `profile` 指向裁判模型 |
| `passCriteria` | `object` | `{ minTotalScore: 4 }`| **`v0.4 新增`** 定制化的用例判定通过门槛条件 |

---

## 2. 核心对象详解与匹配规则

### 2.1 expected (期望行为约束)
规则评分器基于以下字段在评测时对真实轨迹进行全量扫描：
- **`mustSelectSkill`** (`string[]`)：**`[v0.4 新增]`** 智能体运行时**必须命中的技能 ID**。如果没有成功匹配命中列表中的 Skill（在 `skill.select` 中可见），该项不通过。
- **`mustCallTools`** (`string[]`)：运行中**必须成功调用**的工具列表。
- **`forbiddenToolCalls`** (`string[]`)：**`[v0.4 新增]`** 运行中**绝对禁止调用**的工具列表。一旦 Agent 产生幻觉调用了被封锁的工具，该子项不通过。
- **`mustGenerate`** (`Array<{ type: string, nameContains?: string }>`)：必须生成的产物文件类型及路径模糊匹配。
- **`mustInclude`** (`string[]`)：Agent 最终响应中必须含有的关键词。
- **`mustNotInclude`** (`string[]`)：Agent 最终响应中绝对不能出现的幻觉/错误词。

### 2.2 passCriteria (定制化通过条件) `[v0.4 NEW]`
决定了本条 Case 是否被标记为 **`Pass (通过)`**。
- **`minTotalScore`** (`number`，默认 4)：本用例必须达到的最低总分；
- **`requiredChecks`** (`string[]`)：**关键检查项白名单**。
  - **规则**：允许您列出**必须 100% 通过的子检查项名称**（如 `["调用工具 xlsx.inspect", "包含「数据概况」"]`）。如果这些列出的关键项中有一项失败，即使其他项全对导致总分拿到了 4.5 分（高于 `minTotalScore`），本用例最终仍会遭遇 **Failed (拦截不通过)**。

---

## 3. 标准测试集 YAML 范例 (v0.4)

下面是一份完整的、符合 v0.4 校验规范的测试用例 YAML 模板：

```yaml
id: excel_001
datasetId: regression_suite_v4
name: 客户清单异常分析
category: data-analysis
priority: p0
version: 1.0.2
tags:
  - excel
  - customer
  - anomaly
input:
  message: "分析这个客户清单，找出异常客户，并给出营销建议。"
  files:
    - path: fixtures/runtime-workspace/input/customer_data.xlsx
      required: true
runtimeOverrides:
  model: qwen3
  provider: openai-compatible
expected:
  mustSelectSkill:
    - excel-data-analysis
  mustCallTools:
    - xlsx.inspect
    - python.run
  forbiddenToolCalls:
    - process.shell
  mustGenerate:
    - type: markdown
      nameContains: analysis_report
  mustInclude:
    - 异常客户
    - 营销建议
  mustNotInclude:
    - 无法读取
scoring:
  profile: judge-gpt4-v1
  maxScore: 5
  dimensions:
    - name: 技能命中准确性
      weight: 1.0
    - name: 工具执行规范
      weight: 1.5
    - name: 报告专业程度
      weight: 2.5
passCriteria:
  minTotalScore: 4.2
  requiredChecks:
    - "调用工具 xlsx.inspect"
    - "生成 markdown / analysis_report"
```
