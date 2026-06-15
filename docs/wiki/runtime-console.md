# 智能体控制台 (Runtime Console) 使用指南

在 v0.2 版本中，Jarvis Studio 引入了 **Runtime Console**（智能体控制台），提供了与真实智能体交互并流式观察其思考、行动轨迹的可视化页面。

---

## 1. 启动并与智能体交互

1. **进入控制台**：在顶部导航点击 **Runtime Console** 链接。
2. **选择 Skill (技能配置)**：
   在控制台顶部的下拉菜单中，选择本次要激活的智能体核心技能：
   - **`excel-data-analysis`**（Excel数据分析）
   - **`weekly-report`**（工作周报整理）
   - **`code-review`**（代码质量审查）
3. **选择 Model Profile (模型参数)**：
   选择调用的模型配置文件。您可以选用 `deterministic-local`（本地离线确定性提供商）做本地测试与效果验证；若配置了 OpenAI 环境变量，则可以选用 `openai-compatible` 兼容提供商调用在线大模型。
4. **输入指令发送**：
   在底部的输入框中输入具体指令（例如：“分析客户数据 workbook，帮我找出异常客户”），然后点击 **Send (发送)**。

---

## 2. 三大内置 Skill 工作流详解

每个 Skill 在执行时都会自动将所需的文件、提示词和工具权限自动加载给智能体运行时：

### 2.1 Excel数据分析技能 (`excel-data-analysis`)
* **核心输入**：位于工作区下的 Excel 数据表：`fixtures/runtime-workspace/input/customer_data.xlsx`。
* **执行轨迹**：
  1. 运行时加载该 Excel 文件，调用 `xlsx.inspect` 检查工作表的结构、列名、数据概要及数值统计；
  2. 智能体根据检查结果，编写专门的数据处理 Python 脚本，调用 `filesystem.write` 写入本地临时文件 `.jarvis-runtime/prepare-analysis.py`；
  3. 智能体调用 `python.run` 启动本地 Python 执行数据筛查脚本，分析异常数据；
  4. 最终汇总异常营销建议，并将报告写入工作区产物目录：`output/analysis_report.md`。

### 2.2 工作周报整理技能 (`weekly-report`)
* **执行轨迹**：
  1. 智能体提取用户输入的文本或工作流信息；
  2. 按照系统 Prompt 和周报模版自动分类整理进展、风险与计划；
  3. 将最终生成的周报 Markdown 写入：`output/weekly_report.md`。

### 2.3 代码质量审查技能 (`code-review`)
* **核心输入**：位于工作区下的源码文件：`fixtures/runtime-workspace/input/sample.ts`。
* **执行轨迹**：
  1. 智能体调用 `filesystem.read` 读取 `sample.ts` 源码文本；
  2. 分析代码逻辑中存在的边界错误、死循环或类型安全隐患；
  3. 将审查建议生成报告，并写入：`output/code_review.md`。

---

## 3. 沙箱安全与路径隔离规则 (Bounded Sandbox)

为保证本地运行安全，Jarvis Studio 运行时（[tools.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/packages/jarvis-runtime-lite/src/tools.ts)）实施了严格的**沙箱安全防护机制**：

### 3.1 工作区硬隔离 (Path Isolation)
- 运行时的根工作空间锁定在本地的 `fixtures/runtime-workspace` 目录下。
- 所有工具（如 `filesystem.read`、`filesystem.write`、`xlsx.inspect`、`python.run`）传入的文件路径参数，均会经过严格的 `safePath` 安全判定：
  $$\text{root} = \text{resolve}(\text{workspacePath})$$
  $$\text{candidate} = \text{resolve}(\text{root}, \text{requestedPath})$$
  $$\text{pathFromRoot} = \text{relative}(\text{root}, \text{candidate})$$

### 3.2 路径越界安全拦截 (Anti Path Traversal)
- 如果请求的路径参数通过计算后，发现其开头包含 `..` 相对路径跳转（如 `../../src/main.ts`），或通过绝对路径越出了工作区边界，`safePath` 会**立即终止执行并抛出错误**：`路径超出 workspace: ...`。
- **作用**：这彻底断绝了 Agent 因为被注入恶意 Prompt 或产生幻觉而非法读取、篡改系统关键文件（如 `/etc/passwd`）的可能性。

### 3.3 进程执行约束 (Python Process Constraint)
- 智能体通过 `python.run` 运行脚本时，系统做了如下约束限制：
  1. **脚本位置**：只允许执行文件路径以 `.py` 结尾、且确实位于工作空间内部的文件；
  2. **执行程序**：强制绑定使用宿主机的 `/usr/bin/python3` 可执行文件；
  3. **超时限制**：脚本执行时间上限为 30秒 (`30,000ms`)，防止大模型编造的死循环脚本耗尽主机 CPU 资源。
