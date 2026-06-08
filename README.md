# 问康 CareCue

问康 CareCue 是面向长辈、子女和不熟悉搜索用户的就医前健康咨询产品。

当前已进入 PRD 阶段 3：在阶段 2 规则、真实登录和 PostgreSQL 闭环基础上，接入服务端 OpenRouter / DeepSeek AI 综合分析，并保留规则 fallback。

## 已初始化能力

- React + TypeScript + Vite 前端
- Express API 服务
- Prisma 7 + PostgreSQL 数据模型
- 手机号/邮箱 + 密码注册登录
- bcrypt 密码哈希
- JWT httpOnly Cookie 会话
- 用户隔离的咨询记录 API
- 头晕、胸痛、咳嗽三类规则追问
- 红旗风险识别与急诊提示
- 问卷后 AI 聊天补充界面
- AI 综合分析结果页和医生沟通摘要复制
- OpenRouter AI Gateway、可选 web search server tool、结构化 JSON 校验和规则 fallback
- 历史咨询列表、详情、删除
- 注册、登录、Cookie 会话和受保护接口 API 集成测试
- 头晕、胸痛、咳嗽规则与 AI 安全边界单元测试
- Vite 同源 `/api` 代理，避免本地 `localhost` / `127.0.0.1` Cookie 会话不一致

## 文档

- [产品需求文档](docs/PRD.md)
- [阶段 3 AI 分析接入开发文档](docs/STAGE3_AI_DEVELOPMENT.md)

## 本地启动

复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

启动 PostgreSQL：

```powershell
docker compose up -d postgres
```

生成 Prisma Client 并创建迁移：

```powershell
npm run prisma:generate
npm run prisma:migrate
```

分别启动 API 和前端：

```powershell
npm run dev:api
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- API：http://127.0.0.1:4300/api

## 验证

```powershell
npm run test:api
npm run test:rules
npm run lint
npm run typecheck:api
npm run build
```

`npm run test:api` 需要 API 服务已启动。当前 24 个 API 测试覆盖注册、登录、会话校验、受保护接口、AI 聊天 fallback、用户记录隔离、登出 Cookie 清理、同源代理 Cookie 连续性，以及已知登录空昵称字段回归场景。

`npm run test:rules` 不依赖数据库或 API 服务。当前规则测试覆盖头晕、胸痛、咳嗽场景识别、红旗升级、普通观察路径、医生摘要安全边界、AI fallback 和 AI 禁用措辞校验。

## 下一步计划

1. 固化阶段 2 回归：每次改动后运行 `npm run test:api`、`npm run lint`、`npm run typecheck:api`、`npm run build`。
2. 做移动端和宽屏 UI 验收：重点检查标题、顶部导航、表单和结果页是否溢出或遮挡。
3. 优化错误提示：区分网络异常、登录失效、重复注册、错误密码。
4. 阶段 4 前准备：联网检索来源白名单、引用展示和 AI 建议核验。

## 阶段边界

当前阶段暂不包含短信验证码、微信登录和 PDF 导出。未配置 `OPENROUTER_API_KEY` 或 `AI_ENABLED` 不是 `true` 时，系统会展示规则分析结果。将 `AI_WEB_SEARCH_ENABLED` 设置为 `true` 后，服务端会通过 OpenRouter web search tool 请求联网核查。
