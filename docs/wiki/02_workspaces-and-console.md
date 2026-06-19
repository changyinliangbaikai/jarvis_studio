# 评测工作区与智能体控制台操作指南

在 Jarvis Studio v0.5 中，智能体的运行已不再是零散的对话交互，而是被组织为在独立 **测试工作区 (Workspaces)** 中运行的 **测试任务 (Test Tasks)**，并引入了严格的 **Preflight (预检)** 与 **Postflight (后检)** 合约校验。

---

## 1. 评测工作区 (Eval Workspace)

为了隔离不同任务的文件交互，防止数据交叉污染，Jarvis Studio 引入了 **Workspaces (工作区)** 的物理隔离机制。

### 1.1 文件沙箱与浏览器
- **路径隔离**：每个 Workspace 在本地磁盘（如 `fixtures/runtime-workspace/`）拥有独立的物理文件夹；
- **文件树浏览器**：进入 `/workspaces` 页面，您可以在左侧直接浏览该工作区的文件目录树（包括输入目录 `input/`、脚本目录 `.jarvis-runtime/` 和产出产物目录 `output/`），支持在线下载或上传依赖文件；
- **配置继承**：您可以为 Workspace 配置默认的模型提供商、默认技能、默认上下文预算策略以及默认权限拦截政策。在该工作空间内新建的所有 Test Task 都会自动继承此配置。

---

## 2. 新建并运行测试任务 (Test Task)

测试任务代表了一次智能体执行的完整声明，您可以在 **Runtime Console**（智能体控制台）中进行创建和流式交互：

1. **选择工作区与场景**：选择要挂载的 Workspace，以及本次任务适用的 **Scenario (场景模板)**；
2. **输入指令**：输入具体任务指令（User Message），点击 **Send (发送)**；
3. **后台调度与适配 (RuntimeAdapter)**：
   - 后端会创建一条 Test Task 记录，并流转状态至 `running`；
   - 系统通过 **`LocalRuntimeAdapter`** 在后台拉起智能体运行时进程（[agent-runtime](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/packages/agent-runtime/src/runtime.ts)）；
   - 在任务后台运行期间，UI 界面支持随时点击 **Cancel (取消)** 发送终止信号强行杀死后台进程，防止产生冗余账单。

---

## 3. 预检与后检合约机制 (Pre/Postflight Checks)

为了确立智能体行为的可量化和可回归，每个任务的执行都会经过严格的**前置与后置双向合约校验**：

```text
                  用户在控制台发起测试任务 (Test Task)
                                  │
                                  ▼
                    [Preflight Checks (前置预检)]
                 - 校验输入文件、参数、秘钥状态等
                 - ❌ 未通过：直接终止，拒绝运行
                                  │
                                  ▼ (通过)
                     [RuntimeAdapter 启动智能体]
                 - 内存后台并发执行工具与模型交互
                                  │
                                  ▼ (运行结束)
                    [Postflight Checks (后置后检)]
                 - 校验产物路径、大小限制、内容断言等
                 - ❌ 未通过：任务总状态判定为 Failed
                                  │
                                  ▼ (通过)
                 整个 Test Task 判定为 Passed (成功)
```

### 3.1 Preflight (前置预检合约)
在 RuntimeAdapter 真正拉起 Agent 之前运行。
- **校验逻辑**：根据关联的场景模板规则，核查本地沙箱的初始状态。例如，是否已经上传了输入 Excel 文件、环境变量中的模型 API 是否通畅。
- **作用**：如果预检判定不通过，任务将**拒绝启动**，并在页面醒目提示失败原因（例如“预检失败：未在 input 目录下找到 customer_data.xlsx 文件”）。

### 3.2 Postflight (后置后检合约)
在 Agent 结束运行（得出最终 Assistant Message）后，由系统调度器自动运行。
- **校验逻辑**：通过物理扫描 Workspace 目录进行多项业务断言判定。例如检查是否输出了指定文件、文件体积是否符合预期、最终报告中是否包含了必要的关键词。
- **判定发布**：**后检是衡量测试任务最终是否成功的终极指标**。如果后检规则未被 100% 满足，即使 Agent 吐出了很长的文字响应，该 Test Task 的 `postflight.status` 依然会被判定为 **`failed` (未通过)**，并在详情页列出未满足的断言。

---

## 4. 三大预设场景合约 (Scenario Templates)

系统内置了以下三个经典的测试场景，每个场景都配置了特定的 Pre/Postflight 合约规则：

### 4.1 Excel数据分析场景 (`scenario_excel_analysis`)
- **预检合约**：必须在工作区 input 目录中检测到 `input/customer_data.xlsx` 文件；
- **后检合约**：Agent 执行结束后，工作区 `output/` 目录下必须成功写入了 **`analysis_report.md`** 数据报告，且文件字数须多于 300 字符。

### 4.2 工作周报整理场景 (`scenario_weekly_report`)
- **预检合约**：必须在工作区中找到原始无序周报文件 `input/weekly_raw.txt`；
- **后检合约**：Agent 必须**同时产出两份产物**：Markdown 格式的周报文件 **`weekly_report.md`**，以及通过 `docx.write` 工具生成的富文本 Office Word 文档 **`weekly_report.docx`**，缺一不可。

### 4.3 代码质量审查场景 (`scenario_code_review`)
- **预检合约**：必须在工作区中检测到待审查的 TS 源码文件 `input/sample.ts`；
- **后检合约**：必须成功向 `output/code_review.md` 写入含有 Findings (问题发现) 与建议的结构化审查报告。

---
[👈 上一页：01_快速开始](01_quick-start.md) | [首页](00_README.md) | [下一页：03_能力治理与安全审批 ➡️](03_capability-governance.md)
