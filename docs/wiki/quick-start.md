# 快速开始 (Quick Start)

本篇指南将协助您在本地环境快速安装、配置并启动 **Jarvis Studio v0.2**。在本版本中，您不仅能导入 Trace 日志，还能直接在工作台上运行真实的轻量级智能体！

---

## 1. 运行环境准备

在开始之前，请确保您的计算机上已安装以下环境：
- **Node.js**：版本 24 或更高（建议使用 LTS 版本）
- **npm**：版本 11 或更高（随 Node.js 一起安装或单独升级）
- **Python 3**：部分内置技能（如数据分析技能的脚本执行）在真实运行中需要依赖本地的 Python 3 环境。

> [!NOTE]
> Jarvis Studio 本地数据采用 SQLite 进行轻量化存储，系统会自动在 `storage` 目录下创建 `jarvis-studio.db`，无需单独安装和配置关系型数据库。

---

## 2. 安装与启动 (开发环境)

请在终端中进入 `jarvis-studio` 目录，依次运行以下命令：

### 第一步：安装依赖包
```bash
npm install
```

### 第二步：数据库初始化与播种 (Seed)
运行此命令将在 `storage` 目录下自动生成本地数据库，并注入内置的项目、测试用例、默认 Prompt 和 15 个评测用例的种子数据。
```bash
npm run seed
```

### 第三步：启动本地双端服务
```bash
npm run dev
```
启动成功后，控制台会输出服务信息。此时：
- **Web 可视化 UI** 运行在：`http://127.0.0.1:4311`
- **后端 API 接口** 运行在：`http://127.0.0.1:4310`

---

## 3. 配置智能体大模型提供商 (Providers)

Jarvis Runtime Lite 支持两种模型调用提供商。如果您想在 **Runtime Console (控制台)** 或 **Eval Bench (评测)** 中调用大模型，可以进行如下配置：

### 3.1 离线确定性提供商 (`deterministic`)
- **特点**：无需联网，无需 API Key，完全在本地基于状态机生成确定性的工具调用和响应产物。
- **配置**：**默认选项**。当您未配置任何环境变量或想做快速冒烟、跑评测基线时，建议选用此提供商。

### 3.2 兼容 OpenAI 的在线大模型 (`openai-compatible`)
- **特点**：调用标准的 `/chat/completions` API，支持大模型的原生函数工具调用（Function Call）。
- **环境变量**：在启动服务前，您可以通过终端配置以下环境变量：
  ```bash
  # 配置 API 基础路径 (例如使用本地 Ollama)
  export OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
  # 配置 API Key
  export OPENAI_API_KEY="your-api-key-here"
  ```
- *注：若启动服务时未配置上述环境变量，系统会默认尝试连接 `http://127.0.0.1:11434/v1` 并使用 API Key `ollama`。*

---

## 4. 生产环境编译运行

如果您需要编译打包前端静态文件，并将前后端服务合并为一个单端口服务进行体验，请执行以下命令：

```bash
# 运行编译与托管脚本
./script/build_and_run.sh
```

此脚本会将前端 React UI 打包编译为静态产物，并交由 Fastify 后端统一代理托管。此时：
- **合并后的统一入口** 运行在：`http://127.0.0.1:4310`（同时提供 API 路由和 Web 界面访问）

---

## 5. 快速验证命令

您可以通过运行以下命令确保工程各层代码、类型及测试的完整性：

```bash
# 1. 验证 TypeScript 类型一致性
npm run typecheck

# 2. 执行自动化测试 (覆盖 Parser、规则评分、运行时引擎、Skills 匹配等)
npm test

# 3. 编译打包构建
npm run build
```
