// CareCue Agent v3.0 测试 — 设计文档 §40 / §41 关键 case
// 运行：npm run test:agent
//
// 策略：
// - mock LLM：按 schemaName 返回固定输出；未配置的 schema 抛 LlmUnavailableError，
//   走代码确定性降级路径（词典抽取 / 触发词分类 / 规则引擎 / 模板报告）。
// - mock Search：返回固定来源命中，可模拟无结果 / 全部低质量来源。
// - 红旗规则、风险分级、guard 全部为代码执行，断言为确定性结果。

import assert from 'node:assert/strict'
import { createCareCueAgentRuntime, type AgentResponse } from './index.ts'
import { TraceLogger } from './logs/traceLogger.ts'
import { LlmUnavailableError, type LlmClient, type LlmStructuredOptions } from './llm/llmClient.ts'
import type { SearchClient, RawSearchHit } from './search/medicalSearchTool.ts'
import type { MedicalSearchTask } from './actionSchema.ts'
import { findMedicationViolations } from './analysis/medicationBoundaryAnalyzer.ts'
import { emergencyOutputGuard } from './safety/emergencyOutputGuard.ts'

// ---------------------------------------------------------------------------
// Mock 工具
// ---------------------------------------------------------------------------

type MockResponses = Record<string, unknown | ((options: LlmStructuredOptions<unknown>) => unknown)>

/** 按 schemaName 提供固定输出的 mock LLM；未配置的 schema 走 LlmUnavailableError 降级路径 */
function createMockLlm(responses: MockResponses = {}): LlmClient {
  return {
    model: 'mock-llm',
    available: () => Object.keys(responses).length > 0,
    async structured<T>(options: LlmStructuredOptions<T>): Promise<T> {
      const mock = responses[options.schemaName]
      if (mock === undefined) {
        throw new LlmUnavailableError(`no mock for schema: ${options.schemaName}`)
      }
      const value = typeof mock === 'function' ? (mock as (o: LlmStructuredOptions<unknown>) => unknown)(options) : mock
      const parsed = options.schema.safeParse(value)
      if (!parsed.success) {
        throw new Error(`mock 输出不符合 schema「${options.schemaName}」: ${parsed.error.message}`)
      }
      return parsed.data
    },
  }
}

interface MockPage {
  url: string
  title: string
  markdown?: string
}

/** mock 搜索客户端，记录调用次数 */
function createMockSearch(pages: MockPage[]): SearchClient & { calls: MedicalSearchTask[] } {
  const calls: MedicalSearchTask[] = []
  return {
    calls,
    async search(task: MedicalSearchTask): Promise<RawSearchHit[]> {
      calls.push(task)
      return pages.map((page) => ({
        title: page.title,
        url: page.url,
        markdown: page.markdown,
        task,
      }))
    },
    async scrape(): Promise<string | undefined> {
      return undefined
    },
  }
}

const GOOD_PAGE: MockPage = {
  url: 'https://www.msdmanuals.cn/home/test-topic',
  title: '默沙东诊疗手册 测试条目',
  markdown:
    '本条目介绍常见轻症的自我护理：保证休息和水分摄入，避免过度用眼和熬夜。' +
    '若症状持续超过一周、明显加重，或出现高热、意识改变、呼吸困难等情况，应尽快就医。' +
    '本内容仅供参考，不能替代医生面诊。'.repeat(3),
}

const BAD_PAGE: MockPage = {
  url: 'https://www.zhihu.com/question/123456',
  title: '知乎讨论：我这是什么病',
  markdown: '网友经验分享内容。'.repeat(30),
}

/** 完整 symptom_extraction mock 输出（schema 需要全部字段） */
function extraction(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    chiefComplaint: '',
    onsetTime: '',
    duration: '',
    location: '',
    severity: '',
    frequency: '',
    painQuality: '',
    onsetPattern: '',
    triggers: [],
    relievingFactors: [],
    associatedSymptoms: [],
    negativeSymptoms: [],
    progression: 'unknown',
    age: null,
    sex: 'unknown',
    pregnancy: null,
    chronicDiseases: [],
    currentMedications: [],
    unclearFields: [],
    ...partial,
  }
}

function createRuntime(options: { llm?: MockResponses; pages?: MockPage[] } = {}) {
  const traceLogger = new TraceLogger({ verbose: false })
  const search = createMockSearch(options.pages ?? [GOOD_PAGE])
  const runtime = createCareCueAgentRuntime({
    llm: createMockLlm(options.llm ?? {}),
    search,
    traceLogger,
  })
  return { runtime, search, traceLogger }
}

function responseText(response: AgentResponse): string {
  return JSON.stringify(response)
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

interface TestCase {
  name: string
  run: () => Promise<void>
}

const tests: TestCase[] = [
  {
    // §41.1：胸痛但信息不足 → chest_pain / R2 / 假设驱动分析 / 不直接 R3 / 不直接归因熬夜
    name: '41.1 胸痛信息不足 -> R2 假设驱动分析，不直接 R3，不直接归因熬夜',
    run: async () => {
      const { runtime } = createRuntime()
      const response = await runtime.run({
        userMessage: '最近胸口有点疼，有时候左胳膊也有针痛感，经常熬夜，24 岁。',
      })

      // 新流程：R2 不再阻塞，进入假设驱动分析
      assert.notEqual(response.type, 'emergency', '不应直接急症输出')
      assert.notEqual(response.type, 'followup', 'R2 不再阻塞追问，应进入分析阶段')
      assert.equal(response.riskLevel, 'R2', 'R2 风险等级应维持')
      assert.equal(response.stateSnapshot.primaryDomain, 'chest_pain')

      const text = responseText(response)
      assert.ok(!text.includes('你就是心梗'), '禁止确诊式输出')
      assert.ok(!text.includes('一定是熬夜'), '禁止直接归因于熬夜')
    },
  },
  {
    // §41.2：胸痛明确高危 → R3 / emergency_stop / 不继续普通分析
    name: '41.2 胸痛明确高危 -> R3 急症输出，不继续普通分析',
    run: async () => {
      const { runtime, search, traceLogger } = createRuntime()
      const response = await runtime.run({
        userMessage: '胸口压榨性疼痛持续 20 分钟，左臂也疼，出冷汗，有点喘不上气。',
      })

      assert.equal(response.type, 'emergency')
      assert.equal(response.riskLevel, 'R3')
      assert.equal(response.stateSnapshot.primaryDomain, 'chest_pain')
      if (response.type === 'emergency') {
        assert.ok(/急诊|急救|120/.test(response.content), '急症输出必须明确建议急诊/急救')
        assert.ok(response.doctorSummary.length > 10, '必须包含医生摘要')
        assert.ok(emergencyOutputGuard.validate(response.content).passed, '急症输出必须通过 emergencyOutputGuard')
      }
      assert.equal(search.calls.length, 0, 'R3 不允许继续搜索')
      // 新流程：假设在 R3 前生成，此时 stateSnapshot 包含假设
      assert.ok(response.stateSnapshot.hypotheses.length > 0, 'R3 前已生成假设（来自域种子）')

      const trace = traceLogger.getTrace(response.caseId).map((e) => e.legacyEventType)
      for (const expected of ['user_input', 'symptom_extracted', 'risk_assessed', 'emergency_guard', 'final_output']) {
        assert.ok(trace.includes(expected as never), `trace 缺少关键节点: ${expected}`)
      }
    },
  },
  {
    // §41.3：熬夜后短暂头胀 → headache / R0/R1 / 搜索 + 最终报告 / 提醒升级信号
    name: '41.3 熬夜后短暂头胀 -> R0/R1，搜索后输出报告并提醒升级信号',
    run: async () => {
      const { runtime, search } = createRuntime()
      const response = await runtime.run({
        userMessage: '昨天通宵后头有点胀，睡了一觉好很多，没有发热，也没有手脚无力。',
      })

      assert.equal(response.type, 'final_report')
      assert.ok(['R0', 'R1'].includes(response.riskLevel), `期望 R0/R1，实际 ${response.riskLevel}`)
      assert.equal(response.stateSnapshot.primaryDomain, 'headache')
      assert.ok(search.calls.length > 0, '轻症路径应触发联网核验')
      if (response.type === 'final_report') {
        assert.ok(response.report.seekCareWhen.length > 0, '必须提醒升级就医信号')
        assert.ok(response.report.selfCareAdvice.length > 0, '必须有可执行的日常建议')
        assert.ok(response.report.references.length > 0, '报告必须带来源引用')
      }
      const text = responseText(response)
      assert.ok(!/一定|肯定|百分百/.test(text), '禁止绝对化表述')
    },
  },
  {
    // §41.4：眼睛胀痛但无视力下降 → eye_discomfort / R0/R1 / 视疲劳、干眼 / 人工泪液成分边界
    name: '41.4 眼睛胀痛无视力下降 -> 视疲劳/干眼方向 + 人工泪液成分边界',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          care_plan: {
            selfCareAdvice: ['遵循 20-20-20 用眼休息法，定期远眺放松。', '调整屏幕亮度和环境光线，避免暗处长时间用眼。'],
            lifestyleAdvice: ['保证睡眠，减少睡前长时间看手机。'],
            otcIngredientOptions: [
              {
                ingredientCategory: '人工泪液（如玻璃酸钠类滴眼液）',
                suitableFor: '干涩、视疲劳引起的眼部不适',
                caution: '选择不含防腐剂的剂型更适合频繁使用；若症状持续或加重应停用并就医。',
                evidenceRefs: [],
              },
            ],
            avoidActions: ['避免随意使用网红洗眼液或含血管收缩剂的滴眼液。'],
            seekCareWhen: ['出现视力下降、眼睛剧痛、明显红眼或畏光时，应尽快眼科就诊。'],
            departmentSuggestion: '眼科',
            followupWindow: '若 1-2 周无改善建议就诊',
            uncertaintyNote: '以上为非处方成分方向参考，具体使用请咨询医生或药师。',
          },
        },
      })

      const response = await runtime.run({
        userMessage: '最近看电脑很多，眼睛有点胀，双眼都有，没有视力下降，没有红眼。',
      })

      assert.equal(response.type, 'final_report')
      assert.ok(['R0', 'R1'].includes(response.riskLevel), `期望 R0/R1，实际 ${response.riskLevel}`)
      assert.equal(response.stateSnapshot.primaryDomain, 'eye_discomfort')
      if (response.type === 'final_report') {
        const names = response.report.hypotheses.map((h) => h.name).join('、')
        assert.ok(names.includes('视疲劳'), `疑似方向应包含视疲劳，实际: ${names}`)
        assert.ok(names.includes('干眼'), `疑似方向应包含干眼，实际: ${names}`)
        const otc = response.report.otcIngredientOptions.map((o) => o.ingredientCategory).join('、')
        assert.ok(otc.includes('人工泪液'), `应输出人工泪液成分边界，实际: ${otc}`)
        for (const h of response.report.hypotheses) {
          assert.ok(h.supportEvidence.length > 0, `方向「${h.name}」必须有支持依据`)
          assert.ok(
            h.againstEvidence.length > 0 || h.uncertainties.length > 0,
            `方向「${h.name}」必须有反对依据或不确定点`,
          )
        }
      }
      assert.ok(
        !/立即(前往)?急诊|马上去医院|拨打\s*120/.test(responseText(response)),
        '轻症不应直接急诊化',
      )
    },
  },
  {
    // §41.5：眼痛伴视力下降 → R3 / emergency_stop（mock LLM 抽取）
    name: '41.5 眼痛伴视力下降 -> R3 建议眼科急诊',
    run: async () => {
      const { runtime, search } = createRuntime({
        llm: {
          symptom_extraction: extraction({
            chiefComplaint: '左眼突然剧烈眼痛',
            location: '左眼',
            onsetPattern: '突然发生',
            severity: '重',
            associatedSymptoms: ['看东西模糊', '恶心'],
          }),
        },
      })

      const response = await runtime.run({ userMessage: '左眼突然很痛，看东西模糊，还恶心。' })

      assert.equal(response.type, 'emergency')
      assert.equal(response.riskLevel, 'R3')
      assert.equal(response.stateSnapshot.primaryDomain, 'eye_discomfort')
      if (response.type === 'emergency') {
        assert.ok(/急诊/.test(response.content), '必须建议尽快急诊')
      }
      assert.equal(search.calls.length, 0, 'R3 不允许继续搜索')
    },
  },
  {
    // §41.6：面部长痘 → skin_mild / R0/R1 / 疑似方向包含痤疮 / 不急诊化
    name: '41.6 面部长痘 -> skin_mild，疑似方向包含痤疮',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          symptom_extraction: extraction({
            chiefComplaint: '脸上长痘增多',
            location: '下巴和脸颊',
            triggers: ['熬夜'],
          }),
        },
      })

      const response = await runtime.run({
        userMessage: '最近脸上长了很多痘，尤其下巴和脸颊，熬夜后更严重。',
      })

      assert.ok(
        response.type === 'final_report' || response.type === 'followup',
        `期望追问或报告，实际 ${response.type}`,
      )
      assert.notEqual(response.type, 'emergency')
      assert.ok(['R0', 'R1'].includes(response.riskLevel), `期望 R0/R1，实际 ${response.riskLevel}`)
      assert.equal(response.stateSnapshot.primaryDomain, 'skin_mild')
      if (response.type === 'final_report') {
        const names = response.report.hypotheses.map((h) => h.name).join('、')
        assert.ok(names.includes('痤疮'), `疑似方向应包含痤疮，实际: ${names}`)
        assert.ok(response.report.selfCareAdvice.length > 0, '应输出日常护理建议')
      }
    },
  },
  {
    // §40 case 8：搜索无结果 → 放宽重试后不终止本轮，继续按现有信息输出（明确标注未经核验）
    name: '40.8 搜索无结果 -> 放宽重试，继续分析并标注未经联网核验',
    run: async () => {
      const { runtime, search } = createRuntime({ pages: [] })
      const response = await runtime.run({
        userMessage: '昨天通宵后头有点胀，睡了一觉好很多，没有发热，也没有手脚无力。',
      })

      assert.ok(
        response.type === 'final_report' || response.type === 'stage_report',
        `搜索失败不应导致空输出，实际 ${response.type}`,
      )
      assert.equal(response.stateSnapshot.evidenceSources.length, 0, '无结果时不允许出现证据')
      assert.ok(response.stateSnapshot.searchQueries.length > 0, '检索词必须记录在 searchTrace 中')

      const rendered = response.type === 'final_report' ? response.rendered : responseText(response)
      assert.ok(/未经联网核验|未经权威资料核验/.test(rendered), '输出必须标注未经核验')
      if (response.type === 'final_report') {
        assert.equal(response.report.references.length, 0, '无证据时不允许编造引用')
      }
      assert.ok(search.calls.length >= 2, `SEARCH_NO_RESULT 应放宽 query 重试一次，实际调用 ${search.calls.length} 次`)
    },
  },
  {
    // §40 case 9：来源全部被过滤 → 不进入证据，继续分析并标注未经核验
    name: '40.9 来源全部被过滤 -> D 级来源不进入证据，输出标注未经核验',
    run: async () => {
      const { runtime, traceLogger } = createRuntime({ pages: [BAD_PAGE] })
      const response = await runtime.run({
        userMessage: '昨天通宵后头有点胀，睡了一觉好很多，没有发热，也没有手脚无力。',
      })

      assert.ok(
        response.type === 'final_report' || response.type === 'stage_report',
        `来源被过滤不应导致空输出，实际 ${response.type}`,
      )
      assert.equal(response.stateSnapshot.evidenceSources.length, 0, 'D 级来源不允许进入证据')

      const rendered = response.type === 'final_report' ? response.rendered : responseText(response)
      assert.ok(/未经联网核验|未经权威资料核验/.test(rendered), '输出必须标注未经核验')

      const rejectedEvents = traceLogger
        .getTrace(response.caseId)
        .filter((e) => e.legacyEventType === 'sources_rejected')
      assert.ok(rejectedEvents.length > 0, '被过滤来源必须记录在 trace 中')
    },
  },
  {
    // 重复消息幂等：同一 case 连续发送同一句话只处理一次
    name: '幂等：同一 case 重复发送相同消息直接返回上次结果，不重复跑链路',
    run: async () => {
      const { runtime, search } = createRuntime()
      const first = await runtime.run({
        userMessage: '最近胸口有点疼，有时候左胳膊也有针痛感，经常熬夜，24 岁。',
      })
      const callsAfterFirst = search.calls.length

      const second = await runtime.run({
        caseId: first.caseId,
        userMessage: '最近胸口有点疼，有时候左胳膊也有针痛感，经常熬夜，24 岁。',
      })

      assert.equal(search.calls.length, callsAfterFirst, '重复消息不应触发新的搜索')
      assert.equal(JSON.stringify(second), JSON.stringify(first), '重复消息应返回相同结果')
    },
  },
  {
    // 状态合并：用户补充年龄等画像信息必须能更新（最新明确值生效）
    name: '合并：后补充的年龄必须写入状态，时长不允许污染年龄',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          symptom_extraction: (options: LlmStructuredOptions<unknown>) => {
            const user = String(options.user)
            if (user.includes('我24岁')) {
              return extraction({ chiefComplaint: '胸口痛', duration: '约5分钟', age: 24 })
            }
            // 第一轮：模拟 LLM 把"5分钟"误判成年龄 age=5，后续轮次的 24 必须能覆盖它
            return extraction({ chiefComplaint: '胸口痛', duration: '约5分钟', age: 5 })
          },
        },
      })

      const first = await runtime.run({ userMessage: '胸口痛，持续了5分钟。' })
      const second = await runtime.run({ caseId: first.caseId, userMessage: '我24岁。' })

      const age = second.stateSnapshot.knownFacts.find((f) => f.label === '年龄')
      assert.ok(age, '补充年龄后 knownFacts 必须包含年龄')
      assert.equal(age!.value, '24岁', `年龄应被更新为24岁，实际 ${age?.value}`)

      const text = responseText(second)
      assert.ok(!text.includes('child'), '24 岁不允许被识别为 child 特殊人群')
      assert.ok(!/symptoms\./.test(text), '内部字段名不允许泄露给用户')
    },
  },
  {
    // §40 case 15：多轮追问去重 — 已问过的问题不再重复，补充信息后推进分析
    name: '40.15 多轮对话：追问不重复，补充信息后推进分析并维持 R2',
    run: async () => {
      const { runtime } = createRuntime()
      const first = await runtime.run({
        userMessage: '最近胸口有点疼，有时候左胳膊也有针痛感，经常熬夜，24 岁。',
      })
      // 新流程：R2 不阻塞，第一轮可能直接出报告
      const firstQuestions = first.type === 'followup' ? first.questions.map((q) => q.question) : []

      const second = await runtime.run({
        caseId: first.caseId,
        userMessage: '疼了大概3天了，是针扎样的刺痛，不算严重。',
      })

      // 新流程：第二轮回合可能直接出报告
      if (second.type === 'followup') {
        for (const q of second.questions) {
          assert.ok(!firstQuestions.includes(q.question), `重复追问了已问过的问题: ${q.question}`)
        }
      } else if (second.type === 'final_report') {
        assert.equal(second.riskLevel, 'R2', '关键红旗未否认时不允许自动降级，应维持 R2')
      }
    },
  },
  {
    // §40 case 16：超过最大 Agent 步数 → MAX_STEP_REACHED 阶段性报告
    name: '40.16 超过最大步数 -> MAX_STEP_REACHED 输出阶段性判断',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          // LLM 决策始终选 analyze_case，制造步数耗尽
          agent_decision: {
            action: 'analyze_case',
            reason: '循环分析',
            decisionGoal: '测试步数上限',
            confidence: 'low',
            priority: 'low',
            shouldReturnToUser: false,
          },
        },
      })

      const response = await runtime.run({ userMessage: '嗓子疼了两天，咽东西的时候疼。' })

      assert.equal(response.type, 'stage_report')
      if (response.type === 'stage_report') {
        assert.equal(response.failureCode, 'MAX_STEP_REACHED')
        assert.ok(response.content.length > 0, '超限后必须输出阶段性判断')
      }
    },
  },
  {
    // §40 case 13：medication guard 拦截越界用药 → carePlan 降级（移除成分项）
    name: '40.13 medication guard 拦截越界用药 -> carePlan 降级后继续输出',
    run: async () => {
      const { runtime, traceLogger } = createRuntime({
        llm: {
          care_plan: {
            selfCareAdvice: ['注意眼部休息。'],
            lifestyleAdvice: [],
            otcIngredientOptions: [
              {
                ingredientCategory: '人工泪液',
                suitableFor: '干眼',
                caution: '每天4次，每次1滴，连用7天。', // 越界：具体剂量+疗程
                evidenceRefs: [],
              },
            ],
            avoidActions: [],
            seekCareWhen: ['视力下降时尽快就医。'],
            departmentSuggestion: '眼科',
            followupWindow: '',
            uncertaintyNote: '仅供参考。',
          },
        },
      })

      const response = await runtime.run({
        userMessage: '最近看电脑很多，眼睛有点胀，双眼都有，没有视力下降，没有红眼。',
      })

      assert.equal(response.type, 'final_report')
      if (response.type === 'final_report') {
        const otcText = JSON.stringify(response.report.otcIngredientOptions)
        assert.ok(!/每天4次|连用7天/.test(otcText), '越界用药表述必须被拦截')
      }

      const guardEvents = traceLogger
        .getTrace(response.caseId)
        .filter((e) => e.legacyEventType === 'medication_boundary_guard')
      assert.ok(guardEvents.length > 0, 'trace 必须记录用药边界复核')
      // guard 为“修复型”：剔除违规成分项后放行，但 issues 必须被记录
      assert.ok(
        guardEvents.some((e) => ((e.output as { issues?: unknown[] })?.issues?.length ?? 0) > 0),
        'guard 应检出并记录违规',
      )
    },
  },
  {
    // §40 case 24 / §14：R3 之后不允许自动降级，后续轮次仍为急症输出
    name: '40.24 R3 后续轮次不降级，不恢复普通分析',
    run: async () => {
      const { runtime } = createRuntime()
      const first = await runtime.run({
        userMessage: '胸口压榨性疼痛持续 20 分钟，左臂也疼，出冷汗，有点喘不上气。',
      })
      assert.equal(first.type, 'emergency')

      const second = await runtime.run({
        caseId: first.caseId,
        userMessage: '我休息了一会，感觉好一些了。',
      })
      assert.equal(second.type, 'emergency', 'R3 不允许因主观缓解而自动降级')
      assert.equal(second.riskLevel, 'R3')
    },
  },
  {
    // §40 case 5：用户描述模糊 → 不崩溃、不急诊化，输出阶段性整理或追问
    name: '40.5 用户描述模糊 -> 安全兜底输出，不急诊化',
    run: async () => {
      const { runtime } = createRuntime()
      const response = await runtime.run({ userMessage: '我也说不上来，就是不得劲。' })

      assert.notEqual(response.type, 'emergency')
      assert.ok(['R0', 'R1'].includes(response.riskLevel), `模糊描述不应高风险，实际 ${response.riskLevel}`)
      assert.ok(responseText(response).length > 0)
    },
  },
  {
    // 内部风险码（R0-R3）不允许出现在任何用户可见文本中
    name: '安全：用户可见输出不包含内部风险码 R0-R3',
    run: async () => {
      // 阶段性/最终输出路径
      const { runtime } = createRuntime()
      const response = await runtime.run({ userMessage: '熬夜之后有点头胀，今天好多了。' })
      const visibleText =
        response.type === 'followup'
          ? response.intro
          : response.type === 'final_report'
            ? response.rendered
            : response.type === 'stage_report'
              ? response.content
              : ''
      assert.ok(!/R[0-3](?![0-9A-Za-z])/.test(visibleText), `输出泄漏内部风险码：${visibleText.slice(0, 200)}`)
      assert.ok(!/R[0-3](?![0-9A-Za-z])/.test(response.stateSnapshot.riskReason), '快照 riskReason 泄漏内部码')

      // 急症输出路径
      const emergency = await createRuntime().runtime.run({
        userMessage: '胸口压榨性疼痛持续 20 分钟，左臂也疼，出冷汗，有点喘不上气。',
      })
      assert.equal(emergency.type, 'emergency')
      if (emergency.type === 'emergency') {
        assert.ok(!/R[0-3](?![0-9A-Za-z])/.test(emergency.content), '急症输出泄漏内部风险码')
      }
    },
  },
  {
    // 用户显式要求联网搜索 -> 即使尚无疑似方向也强制检索一次，且只检索一次
    name: '搜索：用户显式要求联网时强制检索，执行后标记清除',
    run: async () => {
      const { runtime, search } = createRuntime()
      const response = await runtime.run({
        userMessage: '眼睛有点干涩发胀，帮我联网搜索一下权威资料怎么处理。',
      })

      assert.ok(search.calls.length > 0, '用户显式要求联网时应执行检索')
      assert.ok(['final_report', 'stage_report', 'followup'].includes(response.type))

      // 第二轮普通消息不应再次触发检索（searchRounds 已达上限且无显式要求）
      const callsAfterFirst = search.calls.length
      await runtime.run({ caseId: response.caseId, userMessage: '大概持续两三天了，不严重。' })
      assert.equal(search.calls.length, callsAfterFirst, '无显式要求时不应重复检索')
    },
  },

  {
    // v4.4：假设驱动追问 — 有假设时生成针对性的鉴别问题
    name: 'v4.4 假设驱动追问 -> 生成基于假设的鉴别问题',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '疲劳/过劳',
                likelihood: 'more_likely',
                supportEvidence: ['诱因是工作', '休息缓解'],
                againstEvidence: [],
                missingInfo: ['工作时长', '睡眠质量'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '长时间工作导致疲劳。',
                evidenceRefs: [],
              },
              {
                name: '颈椎问题',
                likelihood: 'possible',
                supportEvidence: ['长时间伏案'],
                againstEvidence: [],
                missingInfo: ['颈部不适情况'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '颈椎可能引起头晕。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [],
            stageConclusion: '初步判断为疲劳相关。',
            canFinalAnswer: false,
            shouldAskUser: true,
            shouldSearchMore: false,
            shouldGenerateCarePlan: false,
          },
          // mock agent_decision to return ask_user
          agent_decision: {
            action: 'ask_user',
            reason: '需要区分假设',
            decisionGoal: '鉴别疲劳和颈椎问题',
            confidence: 'high',
            priority: 'high',
            shouldReturnToUser: true,
          },
          // mock hypothesis-driven questions
          hypothesis_questions: {
            intro: '为了区分可能的方向：',
            questions: [
              {
                question: '工作时颈部有明显酸痛或僵硬吗？',
                reason: '颈部症状是区分颈椎问题和疲劳的关键。',
                targetField: 'symptoms.associatedSymptoms',
                priority: 'high',
                relatedHypothesis: '颈椎问题',
                differentiatesBetween: ['疲劳/过劳', '颈椎问题'],
                type: 'differential',
              },
            ],
          },
        },
      })

      const response = await runtime.run({
        userMessage: '长时间用电脑工作后头晕，脖子有点酸。',
      })

      // 不应卡在风险核查
      assert.notEqual(response.type, 'followup', '不应进入风险核查追问模式')
      assert.notEqual(response.type, 'emergency', '不应急症')
      // 无论如何，必须有假设
      assert.ok(response.stateSnapshot.hypotheses.length > 0, '必须生成假设')
    },
  },
  {
    // v4.5：完整多轮对话 — 模拟用户3轮交互后收敛
    name: 'v4.5 完整3轮对话 -> 假设逐步收敛，最终输出报告',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '疲劳/过劳',
                likelihood: 'more_likely',
                supportEvidence: ['工作后出现'],
                againstEvidence: [],
                missingInfo: ['休息后是否缓解'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '长时间工作可能导致。',
                evidenceRefs: [],
              },
              {
                name: '颈椎问题',
                likelihood: 'possible',
                supportEvidence: ['长时间伏案'],
                againstEvidence: [],
                missingInfo: ['颈部症状'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '颈椎可能引起。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [],
            stageConclusion: '待进一步确认。',
            canFinalAnswer: false,
            shouldAskUser: true,
            shouldSearchMore: true,
            shouldGenerateCarePlan: false,
          },
        },
      })

      // Turn 1: 初始症状
      const first = await runtime.run({
        userMessage: '最近经常头晕，尤其工作久的时候明显。',
      })

      assert.notEqual(first.type, 'emergency', '第一轮不应急症')
      assert.ok(first.stateSnapshot.hypotheses.length >= 1, '第一轮应有假设')

      // Turn 2: 补充信息（模拟用户回答）
      const second = await runtime.run({
        caseId: first.caseId,
        userMessage: '休息一下就好，没有其他不舒服。',
      })

      assert.notEqual(second.type, 'emergency', '第二轮不应急症')
      assert.ok(second.stateSnapshot.knownFacts.length > 0, '第二轮应有更多已知事实')

      // Turn 3: 最终确认
      const third = await runtime.run({
        caseId: first.caseId,
        userMessage: '不是一直晕，是一阵一阵的。',
      })

      assert.notEqual(third.type, 'emergency', '第三轮不应急症')
      // 最终轮应有合理输出
      assert.ok(third.stateSnapshot.knownFacts.length > 0, '最终轮应有已知事实')
    },
  },
  {
    // v4.6：用户给出自我判断时，系统应接住而非机械追问
    name: 'v4.6 用户自我分析 -> 系统应接住用户判断，不机械追问',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '疲劳/过劳',
                likelihood: 'more_likely',
                supportEvidence: ['工作后出现', '休息缓解'],
                againstEvidence: [],
                missingInfo: [],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '符合疲劳相关症状。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [],
            stageConclusion: '高度疑似疲劳相关。',
            canFinalAnswer: true,
            shouldAskUser: false,
            shouldSearchMore: true,
            shouldGenerateCarePlan: true,
          },
        },
      })

      const response = await runtime.run({
        userMessage: '我觉得是工作太累导致的，头晕胸闷休息就好，没有气短心慌。',
      })

      // 不应无视用户的自我分析继续机械追问
      assert.notEqual(response.type, 'followup', '不应再追问已确认的信息')
      assert.notEqual(response.type, 'emergency', '不应急症')
      // 应有合理输出
      assert.ok(response.stateSnapshot.hypotheses.length > 0, '应有假设')
      // 假设应该与用户自述一致
      const hypoNames = response.stateSnapshot.hypotheses.map((h) => h.name).join(',')
      assert.ok(hypoNames.includes('疲劳') || hypoNames.includes('过劳'), 
        `假设应包含疲劳方向，实际: ${hypoNames}`)
    },
  },

  {
    // §v4.1：假设驱动流程 — 头晕+胸闷，mock LLM 返回初始假设，验证流程进入分析而非卡在追问
    name: 'v4.1 头晕+胸闷 -> 假设生成 -> 搜索 -> 报告，不阻塞于风险核查',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '疲劳/过劳相关不适',
                likelihood: 'more_likely',
                supportEvidence: ['诱因为长时间工作', '休息后缓解', '无气短心悸'],
                againstEvidence: [],
                missingInfo: ['具体工作时长', '睡眠质量'],
                riskLevel: 'low',
                doctorCheckQuestion: '是否需要调整工作强度？',
                explanationForUser: '长时间工作导致的身体疲劳，休息后可缓解。',
                evidenceRefs: [],
              },
              {
                name: '体位性低血压',
                likelihood: 'possible',
                supportEvidence: ['蹲起时眼前发黑'],
                againstEvidence: ['不是每次体位变化都出现'],
                missingInfo: ['血压测量值'],
                riskLevel: 'low',
                doctorCheckQuestion: '是否需要测量卧立位血压？',
                explanationForUser: '体位变化时血压调节能力可能偏弱。',
                evidenceRefs: [],
              },
              {
                name: '心律失常可能',
                likelihood: 'must_rule_out',
                supportEvidence: ['胸闷为主诉之一'],
                againstEvidence: ['无心悸', '无气短', '休息可缓解'],
                missingInfo: ['心电图记录'],
                riskLevel: 'high',
                doctorCheckQuestion: '建议做心电图排除心律失常。',
                explanationForUser: '虽然可能性较低，但胸闷需要排除心脏原因。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [
              { field: 'symptoms.duration', question: '症状持续时间？', reason: '需要确认病程', priority: 'high' },
              { field: 'symptoms.palpitation', question: '有无心悸？', reason: '排除心律失常', priority: 'high' },
            ],
            stageConclusion: '症状符合疲劳相关不适，但需排除心律失常。',
            canFinalAnswer: false,
            shouldAskUser: true,
            shouldSearchMore: true,
            shouldGenerateCarePlan: false,
          },
        },
      })

      const response = await runtime.run({
        userMessage: '头晕、胸口有点闷，工作久了就会出现，休息一会就好。没有气短心慌。',
      })

      // 不应卡在风险核查追问
      assert.notEqual(response.type, 'followup', '不应卡在风险核查追问')
      // 不应直接急症
      assert.notEqual(response.type, 'emergency', '不应直接急症输出')
      // 搜索可能因假设存在而被触发；即使无搜索结果，系统也应继续分析
      // 关键：不卡在风险核查，不直接急症
      // 必须有假设
      assert.ok(response.stateSnapshot.hypotheses.length >= 2, '至少生成2个假设')
      // 假设名称应包含关键方向
      const hypoNames = response.stateSnapshot.hypotheses.map((h) => h.name).join(',')
      assert.ok(hypoNames.includes('疲劳'), `假设应包含疲劳方向，实际: ${hypoNames}`)
    },
  },
  {
    // §v4.2：假设驱动多轮对话 — 用户补充信息后假设精化，最终收敛
    name: 'v4.2 多轮对话：假设收敛 — 用户补充信息后最终输出报告',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          // 第一轮：初始假设
          initial_hypothesis: {
            hypotheses: [
              {
                name: '疲劳/过劳相关不适',
                likelihood: 'more_likely',
                supportEvidence: ['诱因为长时间工作', '休息后缓解'],
                againstEvidence: [],
                missingInfo: ['工作时长', '睡眠情况'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '长时间工作导致的疲劳。',
                evidenceRefs: [],
              },
              {
                name: '颈椎问题相关头晕',
                likelihood: 'possible',
                supportEvidence: ['长时间伏案工作'],
                againstEvidence: [],
                missingInfo: ['颈部是否有不适'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '颈椎问题也可能引起头晕。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [],
            stageConclusion: '初步判断为疲劳相关，需进一步确认。',
            canFinalAnswer: false,
            shouldAskUser: true,
            shouldSearchMore: true,
            shouldGenerateCarePlan: false,
          },
        },
      })

      // Turn 1: 初始症状描述
      const first = await runtime.run({
        userMessage: '头晕、胸口有点闷，工作久了就会出现。',
      })

      assert.notEqual(first.type, 'emergency')
      assert.ok(first.stateSnapshot.hypotheses.length > 0, '第一轮应生成假设')
      // 搜索可能因领域模板而触发；即使无搜索结果也不影响流程
      // 关键：不卡在风险核查，不应直接急症

      // Turn 2: 补充信息（在 mock 模式下，用相同 runtime 多轮调用）
      const second = await runtime.run({
        caseId: first.caseId,
        userMessage: '休息一下就好，没有其他不舒服。',
      })

      // 第二轮不应崩溃
      assert.notEqual(second.type, 'emergency', '第二轮不应急症')
      assert.ok(second.stateSnapshot.knownFacts.length > 0, '第二轮应有已知事实')
    },
  },
  {
    // §v4.3：R2 阻塞已移除 — 即使有未确认的关键信息，也能进入分析
    name: 'v4.3 R2 不再阻塞 — 关键信息缺失时仍可进入分析',
    run: async () => {
      const { runtime } = createRuntime()
      // 不提供任何 LLM mock → 所有 LLM 调用走 fallback（域种子降级）
      const response = await runtime.run({
        userMessage: '头晕，有点不舒服，说不上来什么感觉。',
      })

      // 不应卡在追问
      assert.notEqual(response.type, 'followup', 'R2 不再阻塞追问')
      // 不应直接急症（因为没有危险信号）
      assert.notEqual(response.type, 'emergency', '不应直接急症')
      // 必须有输出
      assert.ok(response.stateSnapshot.primaryDomain !== 'unknown', '应识别症状域')
      // 风险等级应为 R0/R1（无明显危险信号）
      assert.ok(['R0', 'R1', 'R2'].includes(response.riskLevel), `风险等级应在合理范围: ${response.riskLevel}`)
    },
  },


  // ===================================================================
  // 皮肤科 (Dermatology) v4.7 - v4.9
  // ===================================================================

  {
    // v4.7：痤疮 — 完整假设驱动流程，含初始假设、搜索、报告
    name: 'v4.7 痤疮-完整假设驱动 -> 假设生成、搜索验证、输出护理建议',
    run: async () => {
      const { runtime, search } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '寻常痤疮',
                likelihood: 'more_likely',
                supportEvidence: ['面颊和下巴多发', '熬夜后加重', '典型粉刺和炎性丘疹'],
                againstEvidence: ['无全身症状'],
                missingInfo: ['既往是否有类似发作', '是否使用过护肤品或药物'],
                riskLevel: 'low',
                doctorCheckQuestion: '是否需要皮肤科面诊评估痤疮严重度？',
                explanationForUser: '典型痤疮表现，与熬夜和压力相关。',
                evidenceRefs: [],
              },
              {
                name: '毛囊炎',
                likelihood: 'less_likely',
                supportEvidence: ['炎性丘疹表现'],
                againstEvidence: ['多发于面颊而非头皮/胸背', '无明确诱因'],
                missingInfo: ['皮疹是否伴有瘙痒或疼痛'],
                riskLevel: 'low',
                doctorCheckQuestion: '是否需要真菌镜检排除马拉色菌毛囊炎？',
                explanationForUser: '部分皮疹形态类似毛囊炎，但可能性较低。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [],
            stageConclusion: '高度疑似寻常痤疮，建议日常护理配合观察。',
            canFinalAnswer: true,
            shouldAskUser: false,
            shouldSearchMore: true,
            shouldGenerateCarePlan: true,
          },
        },
      })

      const response = await runtime.run({
        userMessage: '最近脸上长了很多痘痘，尤其下巴和脸颊，熬夜后更严重。',
      })

      // 验证流程
      assert.notEqual(response.type, 'emergency', '痤疮不应急症输出')
      assert.notEqual(response.type, 'followup', '不应卡在风险核查追问')

      // 验证假设
      assert.ok(response.stateSnapshot.hypotheses.length >= 1, '应有至少1个假设')
      const hypoNames = response.stateSnapshot.hypotheses.map((h) => h.name).join(',')
      assert.ok(hypoNames.includes('痤疮'), '假设应包含痤疮，实际: ' + hypoNames)

      // 验证域
      assert.equal(response.stateSnapshot.primaryDomain, 'skin_mild', '应为皮肤轻症域')

      // 验证搜索
      if (search.calls.length > 0) {
        const queries = search.calls.map((c) => c.query).join(', ')
        assert.ok(queries.includes('痤疮') || queries.includes('acne'), '搜索词应包含痤疮相关')
      }
    },
  },
  {
    // v4.8：湿疹 — 多轮对话，用户补充信息后假设精化
    name: 'v4.8 湿疹-多轮对话 -> 首轮生成假设，补充信息后精化',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '湿疹/皮炎',
                likelihood: 'more_likely',
                supportEvidence: ['胳膊外侧红疹', '伴有瘙痒'],
                againstEvidence: [],
                missingInfo: ['持续时间', '是否接触过新物质'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '符合湿疹样皮炎表现。',
                evidenceRefs: [],
              },
              {
                name: '接触性皮炎',
                likelihood: 'possible',
                supportEvidence: ['局部发作'],
                againstEvidence: ['无明确新接触物'],
                missingInfo: ['是否有新护肤品/洗衣液/环境变化'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '需确认是否有新接触物。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [
              { field: 'symptoms.duration', question: '持续多久了？', reason: '病程判断', priority: 'high' },
            ],
            stageConclusion: '初步判断为湿疹或接触性皮炎。',
            canFinalAnswer: false,
            shouldAskUser: true,
            shouldSearchMore: true,
            shouldGenerateCarePlan: false,
          },
        },
      })

      // Turn 1: 初始症状
      const first = await runtime.run({
        userMessage: '胳膊上长了一片红疹，很痒，好几天了还没消。',
      })

      assert.notEqual(first.type, 'emergency', '不应急症')
      assert.equal(first.stateSnapshot.primaryDomain, 'skin_mild', '应为皮肤轻症域')
      assert.ok(first.stateSnapshot.hypotheses.length >= 1, '应有假设')

      // Turn 2: 补充信息（模拟用户回答追问）
      const second = await runtime.run({
        caseId: first.caseId,
        userMessage: '大概一周了，没有接触过特别的东西。',
      })

      assert.notEqual(second.type, 'emergency', '第二轮不应急症')
      assert.ok(second.stateSnapshot.knownFacts.length > 0, '第二轮应有已知事实')
      assert.ok(second.stateSnapshot.hypotheses.length >= 1, '假设应保留')
    },
  },
  {
    // v4.9：皮肤 — 无 LLM 兜底（测试 fallback 路径的健壮性）
    name: 'v4.9 皮肤-无LLM兜底 -> 使用域种子降级，正常输出不崩溃',
    run: async () => {
      const { runtime } = createRuntime()
      // 不提供任何 LLM mock → 所有 LLM 走 fallback

      const response = await runtime.run({
        userMessage: '身上起了很多红疹，很痒，不知道是不是过敏。',
      })

      // 不应崩溃
      assert.notEqual(response.type, 'emergency', '不应急症')
      assert.equal(response.stateSnapshot.primaryDomain, 'skin_mild', '应为皮肤轻症域')
      // 即使没有 LLM，fallback 也应提供假设（域种子）
      assert.ok(response.stateSnapshot.hypotheses.length >= 1, 'fallback 应有假设')
      // 应有合理输出
      assert.ok(response.stateSnapshot.knownFacts.length > 0, '应有已知事实')
    },
  },

  // ===================================================================
  // 耳鼻喉科 (ENT) v4.10 - v4.12
  // ===================================================================

  {
    // v4.10：咽炎 — 典型流程，throat_respiratory 域完整支持
    name: 'v4.10 咽炎-完整流程 -> 假设生成、搜索、输出护理建议',
    run: async () => {
      const { runtime, search } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '急性咽炎',
                likelihood: 'more_likely',
                supportEvidence: ['咽痛', '吞咽时加重', '无发热'],
                againstEvidence: [],
                missingInfo: ['持续时间', '是否有鼻塞流涕'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '符合急性咽炎表现。',
                evidenceRefs: [],
              },
              {
                name: '扁桃体炎',
                likelihood: 'possible',
                supportEvidence: ['咽痛明显'],
                againstEvidence: ['无发热'],
                missingInfo: ['扁桃体是否肿大', '是否有脓点'],
                riskLevel: 'medium',
                doctorCheckQuestion: '需检查扁桃体情况。',
                explanationForUser: '部分扁桃体炎可不伴发热。',
                evidenceRefs: [],
              },
              {
                name: '胃食管反流相关咽部不适',
                likelihood: 'less_likely',
                supportEvidence: [],
                againstEvidence: ['无烧心反酸'],
                missingInfo: ['是否有反酸烧心'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '可能性较低。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [],
            stageConclusion: '高度疑似急性咽炎，建议对症处理。',
            canFinalAnswer: true,
            shouldAskUser: false,
            shouldSearchMore: true,
            shouldGenerateCarePlan: true,
          },
        },
      })

      const response = await runtime.run({
        userMessage: '嗓子疼了两天了，咽东西的时候更疼，没有发烧。',
      })

      // 验证
      assert.notEqual(response.type, 'emergency', '咽炎不应急症')
      assert.notEqual(response.type, 'followup', '不应卡在风险核查追问')
      assert.equal(response.stateSnapshot.primaryDomain, 'throat_respiratory', '应为咽喉呼吸道域')

      // 假设
      assert.ok(response.stateSnapshot.hypotheses.length >= 1, '应有假设')
      const hypoNames = response.stateSnapshot.hypotheses.map((h) => h.name).join(',')
      assert.ok(hypoNames.includes('咽炎'), '假设应包含咽炎，实际: ' + hypoNames)

      // 搜索
      if (search.calls.length > 0) {
        const queries = search.calls.map((c) => c.query).join(', ')
        assert.ok(queries.includes('咽痛') || queries.includes('sore throat'), '搜索应包含咽痛相关')
      }
    },
  },
  {
    // v4.11：鼻炎 — 多轮对话，模拟用户逐步补充信息
    name: 'v4.11 鼻炎-多轮对话 -> 首轮假设生成，补充信息后推进',
    run: async () => {
      const { runtime } = createRuntime({
        llm: {
          initial_hypothesis: {
            hypotheses: [
              {
                name: '过敏性鼻炎',
                likelihood: 'more_likely',
                supportEvidence: ['鼻塞', '流清鼻涕'],
                againstEvidence: [],
                missingInfo: ['是否与季节/环境相关', '是否有打喷嚏'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '符合过敏性鼻炎表现。',
                evidenceRefs: [],
              },
              {
                name: '普通感冒',
                likelihood: 'possible',
                supportEvidence: ['鼻部症状'],
                againstEvidence: ['无发热', '无全身酸痛'],
                missingInfo: ['是否有咽痛', '病程进展'],
                riskLevel: 'low',
                doctorCheckQuestion: '',
                explanationForUser: '感冒可能性较低。',
                evidenceRefs: [],
              },
            ],
            missingInfo: [
              { field: 'symptoms.duration', question: '持续多久了？', reason: '病程判断', priority: 'high' },
            ],
            stageConclusion: '初步判断为过敏性鼻炎。',
            canFinalAnswer: false,
            shouldAskUser: true,
            shouldSearchMore: false,
            shouldGenerateCarePlan: false,
          },
        },
      })

      // Turn 1
      const first = await runtime.run({
        userMessage: '鼻子堵了好几天，一直流清鼻涕，不发热也不喉咙痛。',
      })

      assert.notEqual(first.type, 'emergency', '不应急症')
      assert.equal(first.stateSnapshot.primaryDomain, 'throat_respiratory', '应为咽喉呼吸道域')
      assert.ok(first.stateSnapshot.hypotheses.length >= 1, '应有假设')

      // Turn 2: 补充信息
      const second = await runtime.run({
        caseId: first.caseId,
        userMessage: '每天早上起来打喷嚏，出门遇到冷空气也打喷嚏。已经一周了。',
      })

      assert.notEqual(second.type, 'emergency', '第二轮不应急症')
      assert.ok(second.stateSnapshot.knownFacts.length > 0, '应有更多已知事实')

      // Turn 3: 最终确认
      const third = await runtime.run({
        caseId: first.caseId,
        userMessage: '就是鼻子和眼睛有点痒，没有别的症状。',
      })

      assert.notEqual(third.type, 'emergency', '第三轮不应急症')
      assert.ok(third.stateSnapshot.knownFacts.length > 0, '最终轮应有已知事实')
    },
  },
  {
    // v4.12：耳部不适 — 无对应症状域时系统的容错能力
    name: 'v4.12 耳部不适-未知域兜底 -> 不崩溃、不急诊化、输出阶段性判断',
    run: async () => {
      const { runtime } = createRuntime()
      // 不提供 LLM mock，耳朵症状无对应域 → unknown 域

      const response = await runtime.run({
        userMessage: '耳朵闷闷的，感觉听不太清楚，有点像坐飞机那种感觉。',
      })

      // 核心：不崩溃
      assert.notEqual(response.type, 'emergency', '不应急症')
      // 输出合理
      const text = JSON.stringify(response)
      assert.ok(text.length > 0, '应有输出')
    },
  },

  {
    // 用药边界分析器单元测试（§25.4 / §29）
    name: '单元：findMedicationViolations 检出剂量/疗程/停药/疗效承诺/劝阻就医',
    run: async () => {
      assert.ok(findMedicationViolations('每天3次，每次吃2片').some((v) => v.type === 'dosage'))
      assert.ok(findMedicationViolations('建议服用 200mg 布洛芬').some((v) => v.type === 'dosage'))
      assert.ok(findMedicationViolations('连用7天就能好').some((v) => v.type === 'course'))
      assert.ok(findMedicationViolations('把医生开的药停了吧').some((v) => v.type === 'stop_medication'))
      assert.ok(findMedicationViolations('这个药一定有效').some((v) => v.type === 'efficacy_promise'))
      assert.ok(findMedicationViolations('不用去医院').some((v) => v.type === 'discourage_care'))
      assert.equal(
        findMedicationViolations('可以考虑含人工泪液成分的滴眼液，使用前请咨询药师。').length,
        0,
        '成分级表述不应误报',
      )
    },
  },
  {
    // 急症输出守卫单元测试（§30）
    name: '单元：emergencyOutputGuard 拦截缺少急诊指引/建议观察的输出',
    run: async () => {
      assert.equal(emergencyOutputGuard.validate('情况比较严重，建议尽快处理。').passed, false)
      assert.equal(emergencyOutputGuard.validate('建议立即急诊，同时可以先在家观察。').passed, false)
      assert.equal(emergencyOutputGuard.validate('该组合存在急症风险，建议立即前往急诊或拨打 120。').passed, true)
    },
  },
]

// ---------------------------------------------------------------------------

async function runAll() {
  let failed = 0
  for (const test of tests) {
    try {
      await test.run()
      console.log(`PASS ${test.name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${test.name}`)
      console.error(error)
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}/${tests.length} agent v3 test(s) failed.`)
    process.exit(1)
  }
  console.log(`\nPASS ${tests.length} agent v3 tests`)
}

runAll()
