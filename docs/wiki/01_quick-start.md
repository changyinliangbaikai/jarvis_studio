# 快速开始 (Quick Start)

本篇指南将协助您在本地环境快速安装、配置并启动 **Jarvis Studio v0.5**。

---

## 1. 运行环境准备

在开始之前，请确保您的计算机上已安装以下环境：
- **Node.js**：版本 24 或更高（建议使用 LTS 版本）
- **npm**：版本 11 或更高
- **Python 3**：用于本地数据分析等执行性技能的脚本计算。

> [!NOTE]
> Jarvis Studio 本地数据采用 SQLite 进行轻量化存储，系统会自动在 `storage` 目录下创建 `jarvis-studio.db`，无需手动配置外部数据库。

---

## 2. 安装与双端服务启动

请在终端中进入 `jarvis-studio` 目录，执行以下安装和运行指令：

### 2.1 安装全仓库依赖
由于项目基于 Monorepo 单体仓库架构，系统会自动一键安装所有子包（包括 `agent-runtime`，`trace-sdk`，`runtime-adapter`，`jarvis-cli` 等）的依赖：
```bash
npm install
```

### 2.2 数据库初始化与播种 (Seed)
运行此命令将在本地自动生成 SQLite 数据库文件，并预先注入默认的测试用例、评测数据集、初始权限规则以及上下文策略：
```bash
npm run seed
```

### 2.3 启动开发环境服务
```bash
npm run dev
```
启动成功后：
- **Web 可视化控制台** 运行在：`http://127.0.0.1:4311`
- **后端 Fastify 服务** 运行在：`http://127.0.0.1:4310`

### 2.4 启动生产环境服务
如果您需要打包编译前端 React 静态资源并托管给后端统一端口启动，请运行：
```bash
# 执行生产模式启动
npm run start
```
服务将被统一发布于单个入口：`http://127.0.0.1:4310`。

---

## 3. 大模型提供商 (Model Providers) 与密钥安全

系统支持在 `/model-providers` 管理模型配置：
- **`deterministic`**：本地离线确定性提供商，无需 API Key 或联网即可产生确定性工具流和响应，用于冒烟测试。
- **`openai-compatible`**：支持配置 OpenAI、Ollama 等兼容接口。
- **密钥存储安全**：所有密钥密文均通过 AES-256-GCM 算法并采用本地随机生成的 `storage/provider-secret.key` 密钥文件进行高强度保护。

---

## 4. 命令行客户端 `jarvis-cli` 入门

在 v0.5 版本中，系统全新集成了控制台工具 **`jarvis-cli`**（可在 `apps/jarvis-cli` 中运行）：
- **功能定位**：支持开发者在 Shell 终端中独立拉起技能并执行任务，无须开启 UI 浏览器，支持将流式 Trace 实时上传推送至后端 Studio 平台。
- 更多详细用法，请参考：**[12_命令行客户端使用指南](12_jarvis-cli.md)**。

---

## 5. 快速验证命令

在发布版本前，请执行以下命令通过平台的 Release Gate 回归测试：

```bash
# 1. 验证全仓库 TypeScript 类型
npm run typecheck

# 2. 执行回归单元测试
npm test

# 3. 运行 v0.5 版全量契约与验证门槛校验命令
npm run verify:v0.5
```

---
[👈 返回首页](00_README.md) | [下一页：02_评测工作区与智能体控制台 ➡️](02_workspaces-and-console.md)
