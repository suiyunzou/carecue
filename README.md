# 问康 CareCue

<p align="center">
  <img src="./promo/assets/hero.png" alt="CareCue Hero" width="600" />
</p>

> **问康 CareCue** 是一款专为长辈、子女及不熟悉复杂搜索的用户打造的**就医前健康咨询产品**。

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF.svg)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-5.x-lightgrey.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748.svg)](https://www.prisma.io/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 📖 简介 (Introduction)

问康 CareCue 基于的**Agent** 对话式咨询架构构建。用户仅需用自然语言描述症状，服务端即可通过多轮追问、风险研判、以及可选的联网核查，输出专业、清晰的疾病诊断分析、日常建议、就医建议。我们致力于为不便使用传统搜索引擎的人群提供可靠的就医前决策支持。

## ✨ 核心特性 (Key Features)

- **🤖 智能 Agent  对话**：状态机合并、多轮智能追问、年龄校验、幂等去重。
- **🔍 智能风险拦截**：红旗症状（Red Flag）识别与急诊提示，内部风险等级（R0-R3）对用户完全无感。
- **🌐 联网核查 (Firecrawl)**：支持用户显式请求联网搜索（如“帮我查一下”），并以正文角标及短链接脚注形式提供可信引用来源。
- **🔄 沉浸式对话体验**：SSE 流式输出，实时展示可审计的分析过程与结构化工具步骤时间线。
- **🔒 安全与会话隔离**：基于 JWT HttpOnly Cookie 的用户身份验证、BCrypt 密码哈希，确保不同用户间的咨询记录严格隔离。
- **💾 会话持久化**：基于 PostgreSQL 存储，支持页面刷新、服务重启后还原和继续历史对话。
- **📊 全链路日志追溯**：基于 Case ID 的对话轨迹追踪（Trace），支持一键导出结构化 JSON 报告，便于系统审计与策略迭代。

## 🛠️ 技术栈 (Tech Stack)

- **前端 (Frontend)**: React 19, TypeScript, Vite, Lucide React
- **后端 (Backend)**: Node.js, Express 5.x, TSX, Zod (Schema 校验)
- **数据库 (Database)**: PostgreSQL 17, Prisma ORM 7
- **AI / 检索引擎**: DeepSeek 官方 API（默认 LLM 主路径）, OpenRouter（LLM 回退）, Firecrawl (联网核查)
- **部署 (Deployment)**: Docker, Docker Compose

## 📂 项目结构 (Project Structure)

```text
carecue/
├── docs/                # 产品需求、技术设计及测试文档
├── prisma/              # 数据库模型定义 (schema.prisma) 与迁移文件
├── public/              # 静态资源文件
├── server/              # Node.js Express 后端及 Agent 核心逻辑
│   ├── agent/           # Agent 3.0 引擎 (分析、证据、假设、问答、风险等)
│   ├── logs/            # 日志收集与导出脚本
│   └── ...
├── src/                 # React 前端源码
├── compose.yaml         # Docker Compose 编排文件
├── Dockerfile.api       # 后端容器构建文件
├── Dockerfile.web       # 前端容器构建文件
└── package.json         # 项目依赖与脚本配置
```

## 🚀 快速开始 (Getting Started)

### 1. 环境准备 (Prerequisites)

- [Node.js](https://nodejs.org/) (推荐 v20+)
- [Docker](https://www.docker.com/) & Docker Compose (用于启动数据库和全量部署)
- 环境变量配置：

```bash
# 复制环境变量模板
cp .env.example .env
# 推荐配置 DEEPSEEK_API_KEY；可保留 OPENROUTER_API_KEY 作为回退；联网核查配置 FIRECRAWL_API_KEY
```

LLM 默认走 DeepSeek 官方 API，OpenRouter 仅作为回退。`AI_TIMEOUT_MS` 控制单个供应商请求超时；`AGENT_INTERACTIVE_LLM_BUDGET_MS` 和 `AGENT_HYPOTHESIS_LLM_BUDGET_MS` 控制一次工具内结构化 LLM 调用的总预算，预算耗尽会进入工具降级，避免用户交互步骤被外层工具超时包装成 `TOOL_RUNTIME_ERROR`。

### 2. 启动数据库

```bash
docker compose up -d postgres
```

### 3. 初始化数据库模型

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

### 4. 启动本地开发服务

```bash
# 启动 API 服务 (http://127.0.0.1:4300/api)
npm run dev:api

# 另起终端启动前端 (http://localhost:5173)
npm run dev
```

> **注意**：前端配置了 Vite 同源 `/api` 代理，以避免本地 `localhost` 与 `127.0.0.1` 之间产生 Cookie 会话不一致问题。

## 🐳 容器化部署 (Docker Deployment)

项目支持一键容器化部署（包含 API 服务与 Web 静态资源服务）：

```bash
docker compose up -d
```

> **资源限制说明**：配置参考 `compose.yaml`，API 服务内存限制为 800M，Web 服务为 300M，同时设置了 `--max-old-space-size=512` 防止在低配机器上 OOM。

## 🧪 测试与校验 (Testing & Validation)

本项目包含完整的单元测试与集成测试，建议在提交代码前运行以下验证：

```bash
# 运行 API 集成测试 (需先启动 API 服务)
# 覆盖注册、登录、受保护接口、用户记录隔离、Cookie 连续性等
npm run test:api

# 运行 Agent 核心逻辑单元测试 (不依赖 DB/API)
# 覆盖状态合并、风险识别、搜索失败恢复、内部码不泄漏等
npm run test:agent

# 运行代码规范检查与类型检查
npm run lint
npm run typecheck:api

# 构建生产版本
npm run build
```

## 📈 日志与诊断 (Logs & Diagnostics)

系统由 Express 请求日志 (Morgan) 和自定义 Agent 全链路 Trace 日志组成。一次咨询（Case）的所有多轮对话必须合并记录在同一个日志文件中，锚定为 `{caseId}.jsonl`。

**导出对话 Trace 报告**：

```bash
npm run trace:export -- <caseId>
```

> 导出的 JSON 报告将自动按日期归档于 `logs/traces/YYYY-MM-DD/` 目录下，文件命名格式为 `YYYY-MM-DD HH-mm-ss-{caseId}-{userId}.json`。控制台打印的 Trace ID 会自动截断为前 8 位。

## 📚 文档导读 (Documentation)

深入了解架构设计、产品需求及测试规范：

- 📝 [产品需求文档 (PRD)](docs/PRD.md)
- 🏗️ [技术设计文档](docs/TECHNICAL.md)
- 🔬 [测试规范与指南](docs/TESTING.md)
- 🚀 [部署文档](部署文档.md)

## 🗺️ 演进路线图 (Roadmap)

- [ ] **交互优化**：追问选项以大按钮形式呈现，降低长辈输入成本。
- [ ] **性能优化**：通过 LLM 步骤日志定位瓶颈，实现单轮对话响应 < 1 分钟。
- [ ] **移动端适配**：深度优化对话区、实时时间线及最终报告的移动端展示体验。
- [ ] **错误提示增强**：精确区分网络异常、登录失效、重复注册及错误密码等异常态。
- [ ] **多元化接入**：后续阶段将接入短信验证码登录、微信授权登录以及 PDF 报告导出功能。

---
*LLM 默认先直连 DeepSeek 官方 API，失败时回退 OpenRouter；直连可减少一层中间路由，但不等于零数据保留风险。未配置 `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` 或 `AI_ENABLED` 不是 `true` 时，Agent 会自动使用本地确定性降级机制继续给出建议。配置 `FIRECRAWL_API_KEY` 后，服务端方可开启联网核查能力。*
