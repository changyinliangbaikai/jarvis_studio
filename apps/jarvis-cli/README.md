# Jarvis CLI v0.1

基于 `agent-runtime` 构建的独立命令行 Agent，无需启动 Studio Server 即可在本地运行 Skill 任务。

## 架构决策

- **复用 `packages/agent-runtime`**：CLI 不重建 Runtime，只做 I/O 编排（配置加载、TraceEmitter、ArtifactManager）。
- **不依赖 Studio DB/UI**：所有执行协议（TraceEvent / RuntimeRequest / artifacts）直接复用 trace-sdk 和 runtime-lite。
- **API Key 安全**：密钥只通过 `api_key_env` 引用环境变量名，绝不写入配置文件或 trace。
- **向前兼容**：Trace 保留 `eventType` 字段（Studio 协议），并补充 `type` 别名；CLI 额外 emit `artifact.register`（不删除 runtime 的 `artifact.write`）。
- **配置单次加载**：CLI 入口加载一次 `LoadedConfig` 并透传给 `runCommand`，下游不再重复读盘。
- **产物两段式收集**：Runtime 把工具产物写到 `workspace/output/`（受 governance 沙箱限制），CLI 的 `ArtifactManager` 在 run 结束后把这些文件复制到 `workspace/artifacts/` 并生成 `<runId>.artifacts.json` manifest，最终对外的稳定产物路径就是 `workspace/artifacts/`，符合 v0.1 计划 §17.5。

## 快速使用

所有命令从 `jarvis_studio/` 目录运行。三种等价的入口形态：

```bash
# 1) npm script（开发首选）
npm run jarvis -- --help

# 2) 透明 bin 入口（apps/jarvis-cli/bin/jarvis.mjs）
npm run jarvis:bin -- --help

# 3) 直接调用 bin（无需 npm 包装）
node apps/jarvis-cli/bin/jarvis.mjs --help
```

> 根 `package.json` 已把 `jarvis` 注册到 `bin` 字段：在 `npm link` 或全局发布场景下，可直接通过 `jarvis ...` 调用。

```bash
# 列出 Skill / 工具 / 配置
npm run jarvis -- skill list
npm run jarvis -- tool list
npm run jarvis -- config list

# 查看历史 trace.jsonl
npm run jarvis -- trace view workspaces/default/traces/run_001.trace.jsonl

# 运行 Excel 分析（离线，deterministic provider）
npm run jarvis -- run \
  --task "分析这个 Excel 客户清单，识别异常并给出营销建议" \
  --skill excel-data-analysis \
  --file workspaces/default/input/customer_list.xlsx \
  --model-profile deterministic-default \
  --workspace workspaces/default \
  --trace-out workspaces/default/traces/run_001.trace.jsonl \
  --artifact-dir workspaces/default/artifacts \
  --yes

# 使用真实模型（需要设置环境变量 QWEN_LOCAL_API_KEY，并启动兼容 OpenAI 的本地服务）
QWEN_LOCAL_API_KEY=xxx npm run jarvis -- run \
  --task "分析这个 Excel 客户清单" \
  --skill excel-data-analysis \
  --file workspaces/default/input/customer_list.xlsx \
  --model-profile qwen-local \
  --workspace workspaces/default \
  --yes
```

## 配置文件（configs/）

| 文件 | 作用 |
|---|---|
| `jarvis.yaml` | 工作空间根目录、默认 model profile、默认策略 |
| `model-providers.yaml` | 模型服务商 profile（兼容 Studio `ModelProviderProfile`） |
| `permissions.yaml` | 权限策略声明（高风险工具需审批） |
| `context-policy.yaml` | 上下文预算策略 |

> **API Key 安全**: 在 `model-providers.yaml` 中只写 `api_key_env: ENV_VAR_NAME`，密钥通过对应环境变量传入，不写入文件和 trace。

## 工作空间（workspaces/default/）

```
workspaces/default/
  input/          # 输入文件（如 customer_list.xlsx）
  output/         # Runtime 工具直接写入位置（受 governance 沙箱白名单限制）
  artifacts/      # 对外稳定产物：CLI 的 ArtifactManager 把 output/ 中的文件复制到此处，
                  # 并生成 <runId>.artifacts.json manifest
  traces/         # trace.jsonl 输出（含 run.start/run.end/llm.call/tool.call/artifact.register 等事件）
  tmp/            # 临时文件
  .jarvis-runtime/  # Runtime 内部生成的脚本与 patch 缓存
```

> **产物收集流程**：Runtime 在执行阶段只能写 `output/` 与 `.jarvis-runtime/`（governance 引擎硬约束）；run 结束后 `ArtifactManager` 把 Runtime 注册的 artifact 复制到 `artifacts/`，并补发 `artifact.register` trace 事件，使得 v0.1 计划 §17.5 中“Artifact 路径限制在 workspace/artifacts”这一验收点成立。

## run 命令完整参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--task, -t` | (必填) | 任务描述 |
| `--skill, -s` | 自动推断 | Skill ID |
| `--file, -f` | (可多次) | 输入文件路径 |
| `--workspace, -w` | jarvis.yaml 中的 root | 工作空间目录 |
| `--model-profile, -m` | jarvis.yaml 中的 defaults.model_profile | 模型 profile ID |
| `--trace-out` | traces/<runId>.trace.jsonl | trace 输出路径 |
| `--artifact-dir` | jarvis.yaml 中的 artifact_dir | 产物输出目录 |
| `--json` | false | 以 JSON 格式输出摘要 |
| `--event-stream` | false | 实时输出事件 JSONL 到 stdout |
| `--yes` | false | 非交互时自动批准所有审批 |
| `--max-approvals` | 10 | 自动审批上限次数 |

## 验证

```bash
# 基础验收：typecheck + skill/tool/config list
npm run verify:v0.1

# 端到端验收：执行 Excel 数据分析场景，校验 trace + artifacts manifest
npm run verify:v0.1:e2e
```

端到端验收会在 `workspaces/default/traces/` 与 `workspaces/default/artifacts/` 下产出新文件，包含：

- `<runId>.trace.jsonl`：完整 Trace（含 `run.start` / `context.build` / `llm.call` / `tool.call` / `artifact.register` / `run.end` 等事件）。
- `<runId>.artifacts.json`：Artifact manifest，字段满足计划 §4.4 协议要求。
- `analysis_report.md`：Excel 分析报告产物。
