# 命令行客户端使用指南 (jarvis-cli)

为了满足自动化回归测试、CI/CD 集成流水线以及极客开发者在终端独立调试的需求，Jarvis Studio v0.5 引入了轻量级、无界面的命令行客户端 **`jarvis-cli`**。

通过 `jarvis-cli`，您可以完全脱离可视化前端，直接在本地终端拉起智能体技能，并自动在后台将运行轨迹以流式（SSE）推送至 Jarvis Studio Server。

---

## 1. 定位与核心架构

`jarvis-cli` 在 v0.5 中充当了 **RuntimeAdapter (命令行适配器)** 的底层实现实体。其整体同步运行逻辑如下：

```text
               [开发者终端 / CI 流水线]
                          │ (执行 jarvis run)
                          ▼
            [jarvis-cli] 本地解析配置与变量
                          │
       ┌──────────────────┴──────────────────┐
       ▼ (1. 预检)                           ▼ (2. 启动引擎)
  Preflight 校验                       拉起 agent-runtime
(检查输入文件/配置)                     (执行智能体循环)
       │                                     │
       │                                     ▼ (3. 拦截与推送)
       │                              - 捕获 ToolCall & LLMCall
       │                              - 遇到高危工具执行本地挂起审批
       │                              - 流式推送 Trace 事件至 Server
       │                                     │
       ▼ (5. 结束判定)                        │
  Postflight 断言 ◄──────────────────────────┘
(校验输出文件与关键字)
       │
       ▼ (6. 退出)
  根据断言结果输出
Exit Code (0/1)
```

---

## 2. 安装与配置加载逻辑

### 2.1 运行入口
根据项目的 monorepo 结构，您可以通过以下两种方式运行 CLI：
- **开发环境下**：在根目录下使用 `npm run jarvis -- [commands]`
- **全局注册后**：直接在终端使用可执行命令 `jarvis [commands]`

### 2.2 配置文件加载优先级
CLI 启动时，会自动按照以下顺序从高到低检索并加载配置文件（`jarvis.yaml`）：
1. **显式指定**：通过命令行参数 `--config <path>` 传入的指定路径；
2. **当前工作目录 (Cwd)**：执行命令时所在的目录下查找 `jarvis.yaml`；
3. **全局配置**：用户家目录下（`~/.jarvis/config.yaml`）的全局配置；
4. **系统默认缺省值**：若以上均不存在，则默认尝试连接本地 Server 地址 `http://localhost:3000` 并使用标准本地沙箱路径。

---

## 3. 命令行指令详解 (CLI Commands)

### 3.1 `jarvis run <skill-name>` (技能执行)
运行指定的智能体技能，并自动执行场景合约。

* **基本用法**：
  ```bash
  jarvis run excel-analysis -w ./workspace -i '{"role": "data-analyst"}'
  ```
* **核心参数**：
  - `-w, --workspace <directory-path>`：指定本次任务的 **Eval Workspace**（沙箱隔离工作目录）。
  - `-i, --input <json-string>`：传入智能体所需的初始化输入参数变量（JSON 字符串）。
  - `-s, --scenario <template-name>`：绑定场景合约模板（如 `data-analysis`、`weekly-report`、`code-review`），启动前后的预检/后检。
  - `--no-gate`：即使 Preflight 或 Postflight 校验失败，也强制继续运行或不返回错误退出码。
  - `--server <url>`：重写上报的 Jarvis Studio Server 地址。

### 3.2 `jarvis info` (环境信息打印)
打印当前客户端的运行配置、本地注册的技能列表以及可用工具清单。

* **基本用法**：
  ```bash
  jarvis info
  ```
* **核心参数**：
  - `--json`：以 JSON 格式输出，便于第三方脚本读取并解析工具列表。

### 3.3 `jarvis trace <run-id>` (运行轨迹导出与流式推送)
用于查看、导出或流式监听某次执行的 Trace 细节。

* **基本用法**：
  ```bash
  jarvis trace run_abc123 --follow
  ```
* **核心参数**：
  - `-f, --follow`：实时流式输出事件流（类似 `tail -f`），当智能体在运行时，能够在控制台实时打印每个 ToolCall 和 LLM 交互步骤。
  - `-o, --output <file-path>`：将本次执行的 Trace 全量数据导出为符合 [Trace SDK 规范](file:///Users/jhx/Documents/learn/mark-ai/mark-series/mark-zero-jarvis/jarvis_studio/docs/trace-sdk.md) 的 `.json` 文件，方便离线导入分析。

---

## 4. 典型集成示例：在 CI 流水线中进行自动化准入校验

`jarvis-cli` 设计了明确的 Exit Code，可非常方便地塞入 GitHub Actions 或 Gitlab CI 管道中：

```yaml
# GitHub Action 示例片断
- name: Run Agent Regression Test
  run: |
    jarvis run weekly-report \
      --workspace ./fixtures/test-workspace \
      --scenario weekly-report \
      --input '{"week": "W25"}'
  # 退出码判定说明：
  # Exit Code 0: 运行成功，且 Preflight & Postflight 校验全部通过。
  # Exit Code 1: 发生运行时异常、或者 Postflight 合约断言失败（如报告中缺失关键内容）。
```

---
[👈 上一页：11_运行产物中心](11_run-artifacts.md) | [首页](00_README.md)
