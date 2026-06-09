# 阶段 3：AI 分析接入开发文档

版本：v0.2  
日期：2026-06-09  
状态：基于智能体 (Agentic Workflow) 的核心代码结构已实现（详见 `STAGE3_4_CHAT_SEARCH_MECHANISM.md` 和 `server/agent.ts`）。

## 1. 阶段目标

阶段 3 的目标是把阶段 2 的规则原型升级为“规则兜底 + AI 聊天补充 + AI 综合分析”的就医前信息整理体验。

用户已经通过阶段 2 完成了：

- 注册/登录
- 主诉输入
- 规则追问
- 红旗风险识别
- 结果页和医生摘要
- 历史记录保存

阶段 3 要新增的是：在用户补齐基础信息后，调用 OpenRouter 平台上的 DeepSeek 模型，对结构化症状信息做更自然、更完整、更有指导性的分析。

本阶段不做真实联网搜索。搜索验证作为阶段 4 单独开发。

## 2. 平台与模型

AI 平台：OpenRouter  
首选模型：DeepSeek  
默认模型 ID：`deepseek/deepseek-v4-pro`  
可选轻量模型：`deepseek/deepseek-v4-flash`

模型选择原则：

| 模型 | 用途 | 使用策略 |
| --- | --- | --- |
| `deepseek/deepseek-v4-pro` | 质量优先的症状综合分析、医生摘要、复杂风险解释 | 阶段 3 默认模型 |
| `deepseek/deepseek-v4-flash` | 速度和成本优先的简短分析、fallback、开发调试 | 可作为 fallback 模型 |

`deepseek/deepseek-chat` 是旧 V3 路径，不再作为阶段 3 默认模型。

根据 OpenRouter 最新文档：

- Chat Completions endpoint：`POST https://openrouter.ai/api/v1/chat/completions`
- 鉴权 Header：`Authorization: Bearer <OPENROUTER_API_KEY>`
- 推荐 Header：`HTTP-Referer`、`X-OpenRouter-Title`
- 支持 `response_format`，可使用 `json_schema` 强制结构化输出
- 支持 `models` + `route: "fallback"` 做模型 fallback

参考文档：

- https://openrouter.ai/docs/api-reference/overview
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/deepseek/deepseek-v4-pro
- https://openrouter.ai/deepseek/deepseek-v4-flash

环境变量：

```env
AI_ENABLED="true"
OPENROUTER_API_KEY=""
OPENROUTER_MODEL="deepseek/deepseek-v4-pro"
OPENROUTER_FALLBACK_MODEL="deepseek/deepseek-v4-flash"
OPENROUTER_REFERER="http://localhost:5173"
OPENROUTER_APP_TITLE="CareCue"
AI_TIMEOUT_MS="20000"
```

要求：

- API Key 只允许存在服务端环境变量中。
- 前端不能直接调用 OpenRouter。
- 模型 ID 不能写死在业务代码里，必须可通过环境变量切换。
- 如果某个 OpenRouter provider 对严格 `json_schema` 支持不稳定，应降级为 `json_object` + 本地 Zod 校验 + 失败 fallback。
- 未配置 API Key 或 AI 调用失败时，必须 fallback 到阶段 2 规则结果。

## 3. 用户能体验到什么

阶段 3 完成后，用户体验应从“规则结果页”升级为“AI 综合分析结果页”。

用户流程：

```text
登录
-> 输入症状
-> 回答规则追问
-> 进入 AI 聊天补充界面
-> 根据 AI 提示继续补充病情细节
-> 点击生成分析报告
-> 系统先做红旗风险判断
-> 系统调用 DeepSeek 生成结构化 AI 分析；如启用 web search tool，则请求联网核查
-> 用户看到更完整的可能方向、缺失信息、下一步建议和医生摘要
-> 结果保存到历史记录
```

用户能看到：

- 当前风险等级和行动建议
- AI 对症状的综合分析
- 2-4 个可能方向
- 每个方向的支持点和仍需确认的信息
- 还缺哪些关键信息
- 建议科室和下一步行动
- 更自然的医生沟通摘要
- 安全边界和不确定项

用户不能看到：

- “确诊为某病”
- “一定是某病”
- 具体药物剂量、处方、停药、换药建议
- 伪造的来源引用

## 3.1 回复表达风格规范

阶段 3 的 AI 回复要做到“清楚、克制、易懂、可信”。

不要太晦涩，也不要过于口语化。产品不是医学论文，也不是聊天陪伴机器人。目标是让普通用户能理解，同时让医生或家属看到时觉得表达客观、专业。

推荐风格：

- 用短句解释，不堆砌长段。
- 医学词汇可以出现，但必须配合通俗解释。
- 少用夸张语气，不制造焦虑。
- 不用“别担心”“问题不大”“肯定没事”等安抚式口语。
- 不用“亲”“宝”“建议你哈”等聊天式表达。
- 不使用过重的医学论文语气。
- 每条建议尽量说明原因，例如“因为持续时间较长，需要补充发作频率和诱因”。
- 面向行动，告诉用户下一步可以记录什么、观察什么、准备什么。

表达示例：

| 不推荐 | 推荐 |
| --- | --- |
| 这个可能是心血管问题，赶紧去医院吧。 | 当前信息提示需要优先排查心血管相关风险，尤其要确认持续时间、是否出汗、是否放射痛。 |
| 你这个大概率就是普通感冒。 | 目前更像常见呼吸道感染或气道刺激，但仍需观察发热、痰色、呼吸困难等变化。 |
| 建议多喝水，吃点药看看。 | 可先观察体温、痰色和呼吸情况；如需用药，应由医生结合病情判断，不建议自行长期用药。 |
| 可能为前庭性眩晕。 | 可能与前庭系统相关，也就是耳内平衡功能异常；但仍需结合发作方式、持续时间和神经系统症状判断。 |

## 4. 本阶段要开发的功能

### 4.1 AI Gateway

新增服务端 AI 网关模块，统一负责调用 OpenRouter。

建议文件：

```text
server/ai.ts
server/ai-schema.ts
server/ai-prompt.ts
```

职责：

- 读取 `OPENROUTER_API_KEY`
- 组装系统提示词和用户结构化输入
- 调用 OpenRouter Chat Completions API
- 使用 `response_format: json_schema` 要求模型输出固定 JSON
- 处理超时、网络失败、非 JSON、JSON schema 不匹配
- 返回 AI 结果或 fallback 规则结果

### 4.2 AI 分析 API

第一版可以不单独暴露新按钮，直接接入现有完成咨询接口。

建议接口策略：

```text
POST /api/consultations/complete
```

现有行为：

- 保存规则结果
- 返回规则结果

阶段 3 行为：

- 先计算规则结果
- 如果 `AI_ENABLED=true`，调用 AI Gateway
- AI 成功时返回 AI 增强结果
- AI 失败时返回规则结果，并携带 `aiStatus: "fallback"`
- 保存结果时记录 AI 状态和输出结构

可选新增调试接口：

```text
POST /api/ai/analyze
```

该接口只用于开发和调试，生产阶段可以不开放给前端。

### 4.3 AI 输出 JSON Schema

AI 必须输出固定结构，不允许自由文本直接渲染。

目标结构：

```ts
type AiAnalysisResult = {
  aiStatus: 'success' | 'fallback'
  aiSummary: string
  possibleDirections: Array<{
    title: string
    support: string[]
    caution: string[]
    suggestedAction: string
  }>
  missingInformation: string[]
  departmentSuggestion: string
  nextSteps: string[]
  dailyAdvice: string[]
  uncertaintyItems: string[]
  doctorSummary: string
  safetyFlags: string[]
}
```

字段要求：

| 字段 | 展示位置 | 要求 |
| --- | --- | --- |
| `aiSummary` | AI 综合分析 | 解释当前症状可能方向，不得确诊 |
| `possibleDirections` | 可能方向卡片 | 2-4 个方向，每项必须有支持点和注意点 |
| `missingInformation` | 还缺哪些信息 | 没有缺失时返回空数组 |
| `departmentSuggestion` | 建议科室 | 可结合规则结果，但不能覆盖 A 级急诊 |
| `nextSteps` | 下一步 | 给出观察、记录、就诊准备等建议 |
| `dailyAdvice` | 日常注意 | 不得包含药物剂量或处方建议 |
| `uncertaintyItems` | 不确定项 | 明确线上信息不足 |
| `doctorSummary` | 医生沟通摘要 | 可复制，语言客观 |
| `safetyFlags` | 安全检查 | 标记是否出现红旗风险或模型限制 |

### 4.4 红旗规则优先级

阶段 3 仍然保持规则优先。

规则：

- 如果规则结果为 A 级，AI 不允许降级。
- 如果规则结果为高风险，结果页顶部必须保留高风险提示。
- AI 可以补充解释，但不能弱化红旗风险。
- AI 不能把“需要线下评估”改成“可以放心观察”。

用户提出的产品方向是正确的：普通场景不应该反复吓用户“立即就医”。因此 UI 表达按风险等级区分：

| 等级 | 页面表达 |
| --- | --- |
| A | 明确提示存在急症风险，建议优先线下急诊评估 |
| B | 建议尽快就医或 24-48 小时内评估 |
| C | 建议门诊评估，重点说明可能方向和补充信息 |
| D | 可先观察变化，给出观察指标和日常建议 |

## 5. UI 展示设计

### 5.1 顶部风险横幅

保留阶段 2 的紧急程度，但文案更克制。

展示：

- 紧急程度 A/B/C/D
- 风险标题
- 当前行动建议

原则：

- A/B 级突出就医时机。
- C/D 级突出分析和观察，不反复强调急诊。

### 5.2 AI 综合分析

新增主区块。

展示：

- AI 对当前症状的综合解释
- 为什么得出这些可能方向
- 当前信息支持什么、不支持什么

文案要求：

- 使用“可能”“需要排查”“建议评估”
- 不使用“确诊”“一定”“肯定”
- 语言要清楚、克制、易懂，不写成论文式说明，也不写成闲聊式口吻
- 医学术语出现时要给出通俗解释或上下文说明
- 每段不宜过长，优先使用 2-4 句短段落

### 5.3 可能方向

卡片列表展示 2-4 个方向。

每张卡片：

- 方向名称
- 支持点
- 仍需注意
- 建议动作

示例：

```text
心血管相关风险
支持点：主诉包含胸闷，持续时间较长
仍需注意：缺少心电图、血压、既往病史信息
建议动作：若伴随出汗、呼吸困难或放射痛，应优先急诊评估
```

### 5.4 还缺哪些关键信息

新增区块。

展示 AI 判断还缺少的信息：

- 年龄
- 持续时间
- 严重程度
- 伴随症状
- 既往病史
- 当前用药
- 过敏史

如果没有明显缺失：

```text
本次信息已基本覆盖当前分析所需的关键字段。
```

### 5.5 建议科室与下一步

展示：

- 建议科室
- 就医时机
- 就医前准备
- 观察指标

普通场景重点给指导性建议，不制造焦虑。

### 5.6 医生沟通摘要

继续保留复制功能。

阶段 3 的变化：

- 摘要由 AI 优化表达
- 仍必须客观、克制
- 不写确诊结论
- 保留规则风险提示

### 5.7 安全边界与不确定项

固定展示，不允许 AI 删除。

示例：

```text
以上内容是就医前信息整理，不是确诊结论。
线上信息不能替代医生面诊、查体和必要检查。
如症状加重或出现新的高危信号，应及时线下评估。
```

## 6. 搜索引擎何时使用

搜索引擎不在阶段 3 开发，阶段 4 单独接入。

搜索的定位不是“确定病症”，而是“验证依据”。

阶段 4 搜索使用时机：

1. AI 分析前：根据结构化症状和风险等级检索权威背景依据。
2. AI 分析后：对 AI 给出的就医时机、科室建议、饮食生活建议做二次核验。

必须搜索验证的内容：

- 危险信号
- 就医时机
- 科室建议
- 用药相关提醒
- 饮食和生活方式建议

搜索结果用途：

- 给 AI 作为依据材料
- 给用户展示来源标题、机构、链接、摘要
- 标记哪些建议已被依据支持，哪些仍不确定

搜索不得做：

- 不得直接用搜索结果给出确诊
- 不得展示营销号作为核心依据
- 不得伪造来源
- 不得把搜索摘要替代原文

## 7. 数据存储

阶段 3 需要让历史记录可回看 AI 分析结果。

建议扩展 `consultation_results`：

| 字段 | 说明 |
| --- | --- |
| `ai_status` | success/fallback/disabled/error |
| `ai_model` | 实际调用模型 |
| `ai_summary` | AI 综合分析 |
| `missing_information` | JSON 数组 |
| `next_steps` | JSON 数组 |
| `safety_flags` | JSON 数组 |

也可以先用现有 JSON 字段兼容保存，但建议迁移字段清晰化，方便阶段 4 加来源引用。

## 8. 错误和 fallback

AI 调用失败时，用户不能卡住。

失败场景：

- 未配置 `OPENROUTER_API_KEY`
- OpenRouter 超时
- 模型返回非 JSON
- JSON schema 校验失败
- 模型输出包含禁止措辞

fallback 行为：

- 展示阶段 2 规则结果
- 页面提示“本次 AI 分析暂不可用，已展示规则分析结果”
- 咨询记录仍保存
- 历史记录中标记 `aiStatus: "fallback"`

## 9. 验收标准

功能验收：

- 完成追问后能调用 OpenRouter DeepSeek 生成 AI 分析。
- 前端结果页展示 AI 综合分析、可能方向、缺失信息、下一步建议、医生摘要。
- AI 输出通过 JSON Schema 校验后才进入页面。
- AI 失败时 fallback 到规则结果。
- A 级红旗风险不会被 AI 降级。
- 结果不出现确诊措辞。
- 结果不出现药物剂量、处方、停药、换药建议。
- 历史记录能查看 AI 分析结果。

技术验收：

- `OPENROUTER_API_KEY` 不出现在前端 bundle。
- OpenRouter 调用只发生在服务端。
- `npm run test:api` 通过。
- `npm run test:rules` 通过。
- `npm run typecheck:api` 通过。
- `npm run lint` 通过。
- `npm run build` 通过。

体验验收：

- 普通低风险场景以指导建议为主，不反复强调急诊。
- 高风险场景清晰提示线下评估必要性。
- AI 加载时有明确状态，不让用户误以为页面无响应。
- AI 失败时用户仍能看到结果，不丢失已填写内容。

## 10. 不做事项

阶段 3 不做：

- 搜索引擎接入
- 来源引用展示
- 多模型并行验证
- 药物推荐、剂量建议、处方建议
- 医生在线问诊
- 诊断准确率承诺
- 家庭成员档案

## 11. 开发任务拆分

建议按以下顺序开发：

1. 新增环境变量和 `.env.example` 配置。
2. 新增 AI 输出类型和 Zod schema。
3. 新增 OpenRouter 客户端封装。
4. 新增 Prompt 模板。
5. 在 `/api/consultations/complete` 中接入 AI 分析。
6. 扩展结果数据结构和数据库保存。
7. 扩展前端结果页 UI。
8. 增加 AI fallback 测试。
9. 增加禁止措辞和红旗降级测试。
10. 更新 README 和 PRD 阶段状态。

## 12. 推荐测试用例

API 测试：

- AI 关闭时返回规则结果。
- API Key 缺失时 fallback。
- AI 返回合法 JSON 时保存 AI 结果。
- AI 返回非法 JSON 时 fallback。
- A 级胸痛结果不能被 AI 降级。
- 登录用户只能查看自己的 AI 分析历史。

规则/安全测试：

- 输出包含“确诊”“一定是”时判为不合格。
- 输出包含药物剂量时判为不合格。
- `missingInformation` 为空时前端展示“信息已基本覆盖”。

前端手工测试：

- AI 加载状态。
- AI 成功结果页。
- AI fallback 结果页。
- 历史详情展示 AI 分析。
- 移动端结果页可读、无遮挡。
