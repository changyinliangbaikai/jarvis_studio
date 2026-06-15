# Prompt 实验室与技能调试指南

在智能体的工程迭代中，提示词（Prompt）和执行技能（Skill）的质量直接决定了其心智上限。Jarvis Studio 提供了 **Prompt Lab (提示词实验室)** 和 **Skill Debugger (技能调试器)**，让您能直接在工作台上验证新思路并追踪其运行逻辑。

---

## 1. Prompt Lab (提示词实验室)

Prompt Lab 是一个集提示词生命周期管理、动态变量渲染与轻量级单条测试于一体的调试空间。

### 1.1 版本演进与管理
- **保存与增量**：您可以创建多套完全独立的 Prompt 模板。当在现有 Prompt 上修改内容并保存时，系统会基于 `vX.Y`（例如 `v0.1`）格式自动分析最新的版本号，并自增版本（如自增为 `v0.2`），为您沉淀每一次改动的变更日志（Changelog）。
- **技能绑定**：您可以把某个 Prompt 版本与特定的 Skill 绑定，确保大模型在被该技能激活时，能够自动调用正确的提示词版本。

### 1.2 动态变量解析与渲染 (Variable Rendering)
在 Prompt 模板中，您可以使用如下的双大括号语法定义占位变量：
```markdown
你是一个擅长 {{ role }} 的专业智能体。
当前正在处理的数据是 {{ dataset_name }}。
```
1. **自动提取**：当您在页面中编辑 Prompt 并保存时，系统在后台（[promptRenderer.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/packages/prompt-manager/src/promptRenderer.ts)）会通过正则表达式 `/\{\{\s*([\w.-]+)\s*\}\}/g` 自动提取出所有的变量名（如 `role`、`dataset_name`），并将去重后的变量列表存储在数据库中。
2. **动态表单**：在测试区域中，系统会自动为这些变量渲染出对应的表单输入框。您只需在界面上填写对应的测试值，无需手动翻改模板。

---

## 2. 模拟测试运行与轨迹追踪

配置完变量并输入测试指令（User Message）后，点击 **Test Prompt** 即可发起单条效果测试。

### 2.1 模拟运行原理 (Mock Runtime)
为了让提示词调试和整体的 Trace 调试保持一致，系统在接收到测试请求后：
1. **变量渲染**：使用您填入的变量值替换双花括号占位符，渲染出最终被拼接的 Full Prompt。
2. **事件模拟注入**：后台（[promptService.ts](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/apps/server/src/services/promptService.ts)）会自动发起一系列模拟事件（包含 `run.start`、`turn.start`、`context.build`、`llm.call`、`run.end`），将渲染好的 Full Prompt 作为上下文快照载入，并在 `context.build` 的 Payload 中真实注入。
3. **前台回显**：测试完毕后，大模型的模拟回复以及最终渲染后的 Prompt 字符数等信息将以高可读性格式展现在实验室右侧的“测试结果”中。

### 2.2 打通运行轨迹
> [!TIP]
> 由于测试运行发起了标准格式的 Trace 事件流并被导入了系统，这次测试运行在数据库中会生成**真实的运行记录 (Run ID)**。
> 您可以随时跳离 Prompt Lab，在 **Runs 列表** 和 **Trace Viewer** 中找到这条名为 `Prompt Test · [Prompt名称]` 的记录，去深入审查其上下文片段（Segments）的渲染状态。这打通了“调试 -> 记录 -> 监控”的闭环。

---

## 3. Skill Debugger (技能调试器)

当用户输入复杂的指令时，Agent 通常会预先通过语义搜索或规则匹配，选择最匹配的一项或多项 Skill 来激活大模型。

**Skill Debugger** 专门用于调试这层“Skill 选择与注入”的匹配准确性。该页面展示以下内容：
- **候选 Skill 列表**：展示当前系统注册的所有可用技能。
- **匹配得分与命中理由**：显示 Agent 针对当前用户输入指令对各个 Skill 算出的推荐分数，以及系统选择（或放弃选择）该技能的具体原因。
- **最终激活技能详情**：展示最终选定的 Skill 细节，包括注入该 Skill 的 System Prompt 指令细节。
- **关联工具与权限**：清晰展示本 Skill 运行前声明必须要使用的工具（Required Tools，如文件读取工具等），以及本 Skill 被安全沙箱约束的访问权限列表（Permissions）。这方便了开发者排障“为什么调用此工具时触发了权限拦截”。
