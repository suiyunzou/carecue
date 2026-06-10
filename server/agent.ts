import OpenAI from 'openai'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import FirecrawlApp from '@mendable/firecrawl-js'
import type { ConsultationAnswer, RuleResult, ScenarioKey } from './rules.ts'
import type { AiChatMessage } from './ai-prompt.ts'
import { buildSiteFilter } from './source-whitelist.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AiAgentStateInput = {
  answers: ConsultationAnswer[]
  chatMessages: AiChatMessage[]
  chiefComplaint: string
  ruleResult: RuleResult
  scenario: ScenarioKey
  round?: number // 追问轮次
}

// ==========================================
// Schema Definitions
// ==========================================

export const SymptomsExtractionSchema = z.object({
  knownInfo: z.object({
    patient: z.string().describe('就诊对象：本人 / 家人 / 不清楚'),
    age: z.string().describe('年龄'),
    gender: z.string().describe('性别'),
    mainSymptoms: z.array(z.string()).describe('主要症状'),
    symptomLocations: z.array(z.string()).describe('症状部位'),
    duration: z.string().describe('持续时间'),
    onsetMode: z.string().describe('发作方式：突然 / 逐渐 / 反复 / 不清楚'),
    severity: z.string().describe('严重程度：轻 / 中 / 重 / 不清楚'),
    triggers: z.array(z.string()).describe('诱因：活动、进食、情绪、睡眠不足等'),
    accompanyingSymptoms: z.array(z.string()).describe('伴随症状'),
    medicalHistory: z.array(z.string()).describe('既往病史'),
    currentMedications: z.array(z.string()).describe('当前用药'),
  }),
  deniedInfo: z.array(z.string()).describe('已明确否认的信息'),
  missingBasicInfo: z.array(z.string()).describe('缺失的基础信息'),
  missingDetailInfo: z.array(z.string()).describe('可能还需要确认的症状细节'),
  possibleCategories: z.array(z.string()).describe('可能涉及的症状大类'),
  userIntent: z.string().describe('用户当前意图'),
})
export type SymptomsExtraction = z.infer<typeof SymptomsExtractionSchema>

export const QuestionGenerationSchema = z.object({
  criticalMissingInfo: z.string().describe('当前最关键缺失信息'),
  reason: z.string().describe('为什么要问这个问题'),
  question: z.string().describe('给用户的问题，口语化，一次只问一个'),
  options: z.array(z.string()).describe('按钮选项，2到4个'),
  fieldsToUpdate: z.array(z.string()).describe('用户回答后应更新的字段'),
  shouldContinueAsking: z.boolean().describe('是否建议继续追问'),
})
export type QuestionGeneration = z.infer<typeof QuestionGenerationSchema>

export const SearchTaskGenerationSchema = z.object({
  tasks: z.array(
    z.object({
      intent: z.string().describe('检索意图'),
      keywords: z.string().describe('医学关键词'),
      recommendedSourceLevel: z.string().describe('推荐来源等级（A/B/C）'),
      purpose: z.string().describe('查询目的'),
      isRequired: z.boolean().describe('是否必须检索'),
    })
  ).describe('检索任务列表'),
})
export type SearchTaskGeneration = z.infer<typeof SearchTaskGenerationSchema>

export const FinalAdviceGenerationSchema = z.object({
  generalJudgment: z.array(z.string()).describe('大概可能是什么方向，不超过3个'),
  judgmentBasis: z.string().describe('判断依据'),
  howToHandleNow: z.array(z.string()).describe('现在可以怎么处理：生活处理、观察建议、饮食起居等'),
  medicationInfo: z.string().nullable().describe('是否可以了解非处方药类别或药品信息，如果不适用或不确定，请返回 null'),
  whenToSeeDoctor: z.array(z.string()).describe('什么时候必须就医：明确风险信号'),
  needsMoreInfo: z.boolean().describe('是否还需要继续补充信息'),
  followUpQuestion: z.string().nullable().describe('如果还需要补充信息，补充的一个问题，不需要补充则为 null'),
})
export type FinalAdviceGeneration = z.infer<typeof FinalAdviceGenerationSchema>

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'dummy',
  fetch: global.fetch,
  defaultHeaders: {
    'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:5173',
    'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE || 'CareCue',
  },
})

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY || 'dummy'
})

export async function extractSymptoms(input: AiAgentStateInput): Promise<SymptomsExtraction> {
  const systemPrompt = `你是“问康”的症状信息提取助手。

你的任务是从用户输入和历史对话中提取健康信息。
你只做信息提取，不做诊断，不给建议，不推荐药品。

请提取并输出以下结构化内容：
一、已知信息（就诊对象、年龄、性别、主要症状、症状部位、持续时间、发作方式、严重程度、诱因、伴随症状、既往病史、当前用药）
二、已否认信息
三、缺失的基础信息
四、可能还需要确认的症状细节
五、可能涉及的症状大类
六、用户当前意图

注意：
- 如果用户回复的是数字（如“1”），请结合上一轮 AI 的提问选项进行理解并提取。
- “喘不上气”归为呼吸困难；
- “快晕了”归为接近晕厥；
- “半边没力气”归为单侧肢体无力；
- “说话含糊”归为言语异常；
- “眼睛磨得慌”归为异物感；
- “脸上红疙瘩”归为皮疹 / 丘疹 / 痘样损害。

当前用户主诉：${input.chiefComplaint}
请基于以上信息及后续对话历史进行提取。`

  const structuredContext = {
    chiefComplaint: input.chiefComplaint,
    scenario: input.scenario,
    ruleResult: {
      urgencyLevel: input.ruleResult.urgencyLevel,
      urgencyTitle: input.ruleResult.urgencyTitle,
      urgencyAdvice: input.ruleResult.urgencyAdvice,
      departmentSuggestion: input.ruleResult.departmentSuggestion,
    },
    answers: input.answers.map((answer) => ({
      questionKey: answer.questionKey,
      questionText: answer.questionText,
      answerText: answer.answerText || '未说明',
      answerValue: answer.answerValue,
    })),
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `以下是用户已经完成的结构化问卷资料，必须纳入提取结果：\n${JSON.stringify(structuredContext)}`,
    },
    ...input.chatMessages.map((msg): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: msg.role,
      content: msg.content
    }))
  ]

  console.log('\n--- [Agent Prompt] 1. Extract Symptoms ---')
  console.log(`[Agent Input] User Complaint: ${input.chiefComplaint}, Answers: ${input.answers.length}, Chat History Length: ${input.chatMessages.length}`)

  const completion = await openai.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro',
    messages,
    response_format: zodResponseFormat(SymptomsExtractionSchema, 'symptoms_extraction'),
    temperature: 0.1,
  })

  const rawContent = completion.choices[0]?.message?.content
  if (!rawContent) {
    throw new Error('Failed to extract symptoms: no content from AI.')
  }

  console.log('[Agent Output] Extracted Symptoms JSON:\n', rawContent)
  console.log('--------------------------------------------\n')
  return SymptomsExtractionSchema.parse(JSON.parse(rawContent))
}

export async function generateQuestion(symptoms: SymptomsExtraction, round: number, chatMessages: AiChatMessage[] = []): Promise<QuestionGeneration> {
  const systemPrompt = `你是“问康”的追问生成助手。

系统已经判断当前需要继续追问。
你的任务是根据缺失信息，生成一个最关键的问题。

要求：
- 一次只问一个问题；
- 优先确认高危信号；
- 问题必须口语化；
- 适合长辈理解；
- 给出 2 到 4 个按钮选项；
- 不要使用复杂医学术语；
- 不要一次问多个并列问题；
- 严禁重复之前已经问过的问题；
- 当前已追问轮次：${round}，如果已经追问 3 轮，应优先结束追问，建议 shouldContinueAsking 为 false。

追问优先级：
1. 高危信号；2. 持续时间；3. 是否加重；4. 严重程度；5. 伴随症状；6. 诱因；7. 既往病史；8. 当前用药；9. 症状细节。

当前提取到的已知症状：${symptoms.knownInfo.mainSymptoms.join(', ')}
缺失的基础信息：${symptoms.missingBasicInfo.join(', ')}
需要确认的细节：${symptoms.missingDetailInfo.join(', ')}

请输出最关键的追问问题。`

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...chatMessages.map((msg): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: msg.role,
      content: msg.content
    }))
  ]

  console.log('\n--- [Agent Prompt] 2. Generate Question ---')
  console.log(`[Agent Input] Round: ${round}, Missing Basic: ${symptoms.missingBasicInfo.join(',')}, Missing Detail: ${symptoms.missingDetailInfo.join(',')}`)

  const completion = await openai.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro',
    messages,
    response_format: zodResponseFormat(QuestionGenerationSchema, 'question_generation'),
    temperature: 0.2,
  })

  const rawContent = completion.choices[0]?.message?.content
  if (!rawContent) {
    throw new Error('Failed to generate question: no content from AI.')
  }

  console.log('[Agent Output] Generated Question JSON:\n', rawContent)
  console.log('--------------------------------------------\n')
  return QuestionGenerationSchema.parse(JSON.parse(rawContent))
}

export async function generateSearchTask(symptoms: SymptomsExtraction): Promise<SearchTaskGeneration> {
  const systemPrompt = `你是“问康”的检索任务生成助手。

你的任务是根据结构化症状，生成联网核验所需的检索意图和医学关键词。
你不能生成确诊类搜索、处方药推荐搜索、偏方搜索或“能不能不去医院”类搜索。
你不能直接照抄用户原话。

只有当基础信息已经基本够用，或系统已达到追问轮次上限时，才生成检索任务。
如果主诉完全不清楚、症状为空、只是在问“我是什么病”但没有任何具体症状，应返回空 tasks。
不要为了凑证据生成探索性检索任务。

允许的检索意图：
1. 高危信号核验；2. 可能疾病方向核验；3. 轻重程度判断；4. 日常处理建议；5. 非处方药信息说明；6. 就医边界核验；7. 就医沟通建议。

注意：不要自己拼接 site 限定词。信息源由后端自动拼接。

当前提取到的已知症状：${JSON.stringify(symptoms.knownInfo)}
请输出需要执行的检索任务列表。如果无需检索（例如完全没有提供任何症状），可以返回空列表。`

  console.log('\n--- [Agent Prompt] 3. Generate Search Task ---')
  console.log(`[Agent Input] Known Symptoms:\n`, JSON.stringify(symptoms.knownInfo))

  const completion = await openai.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro',
    messages: [{ role: 'system', content: systemPrompt }],
    response_format: zodResponseFormat(SearchTaskGenerationSchema, 'search_task_generation'),
    temperature: 0.1,
  })

  const rawContent = completion.choices[0]?.message?.content
  if (!rawContent) {
    throw new Error('Failed to generate search task: no content from AI.')
  }

  console.log('[Agent Output] Generated Search Task JSON:\n', rawContent)
  console.log('--------------------------------------------\n')
  return SearchTaskGenerationSchema.parse(JSON.parse(rawContent))
}

export type SearchResultItem = {
  metadata?: {
    title?: string
    sourceURL?: string
  }
  markdown?: string
  title?: string
  url?: string
  snippet?: string
}

export function buildEmergencyFinalAdvice(symptoms: SymptomsExtraction, ruleResult: RuleResult): FinalAdviceGeneration {
  const symptomText = symptoms.knownInfo.mainSymptoms.length > 0
    ? symptoms.knownInfo.mainSymptoms.join('、')
    : '当前不适'

  return {
    generalJudgment: ['当前需要优先排查急症风险'],
    judgmentBasis: `规则判断为 ${ruleResult.urgencyLevel} 级：${ruleResult.urgencyTitle}。已知症状包括：${symptomText}。线上信息不能判断具体疾病，也不应替代急诊评估。`,
    howToHandleNow: [
      ruleResult.urgencyAdvice,
      '停止剧烈活动，尽量由家人陪同前往线下急诊或联系当地急救。',
      '保留发作时间、持续多久、伴随症状、既往病史和正在用药信息，方便医生快速判断。',
    ],
    medicationInfo: null,
    whenToSeeDoctor: [
      ruleResult.urgencyAdvice,
      '如出现呼吸困难、胸痛加重、意识异常、肢体无力、说话不清、大量出血等情况，应立即急诊。',
    ],
    needsMoreInfo: false,
    followUpQuestion: null,
  }
}

export async function generateFinalAdvice(symptoms: SymptomsExtraction, ruleResult: RuleResult, searchResults: SearchResultItem[]): Promise<FinalAdviceGeneration> {
  const systemPrompt = `你是“问康”的最终建议生成助手。

你的任务是根据用户症状、追问信息、规则判断和证据核验结果，生成普通用户能理解的建议。
即使信息仍然不完整（例如用户直接跳过了追问），你也必须基于现有的初步症状进行推理，给出可能的疾病方向、判断依据和日常处理建议。
你不能确诊。不能排除严重疾病。不能推荐处方药。不能给药物剂量。不能保证没事。不能说医生错了。
非常重要：严禁在输出中使用“诊断为”、“确诊为”、“治疗方案”、“治愈”等医疗确诊词汇。

规则判断紧急程度：${ruleResult.urgencyLevel} - ${ruleResult.urgencyTitle}

当前提取的已知症状：${JSON.stringify(symptoms.knownInfo)}
联网核验证据：${JSON.stringify(searchResults.map(r => ({ title: r.metadata?.title || r.title, url: r.metadata?.sourceURL || r.url, markdown: r.markdown?.substring(0, 300) || r.snippet?.substring(0, 300) })))}

请回答用户最关心的五件事（必须提供实质性内容，不能全部回答“暂无建议”或“无法判断”）：
1. 大概可能是什么方向（不超过3个，说明更像哪些方向，不说“你就是某病”）；
2. 为什么这样判断（结合症状和联网证据）；
3. 现在可以先怎么处理（生活处理、观察建议、饮食起居等）；
4. 是否可以了解非处方药类别或药品信息（如果适用，说明药品类别和注意事项，但不要给出具体用量，可以说“按说明书”）；
5. 什么情况下必须就医（列出明确风险信号）。

如果信息仍然不足以给出精确建议，可以提出一个最后的补充问题，并设置 needsMoreInfo 为 true，但前面的1-5项仍然必须根据已知症状进行探索性解答。

语言要求：简单、直接、不吓人、不堆砌医学术语，适合长辈阅读。`

  console.log('\n--- [Agent Prompt] 4. Generate Final Advice ---')
  console.log(`[Agent Input] Urgency: ${ruleResult.urgencyLevel}, Search Results Count: ${searchResults.length}`)

  const completion = await openai.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro',
    messages: [{ role: 'system', content: systemPrompt }],
    response_format: zodResponseFormat(FinalAdviceGenerationSchema, 'final_advice_generation'),
    temperature: 0.2,
  })

  const rawContent = completion.choices[0]?.message?.content
  if (!rawContent) {
    throw new Error('Failed to generate final advice: no content from AI.')
  }

  console.log('[Agent Output] Generated Final Advice JSON:\n', rawContent)
  console.log('--------------------------------------------\n')
  return FinalAdviceGenerationSchema.parse(JSON.parse(rawContent))
}

export type SearchTask = {
  keyword: string
  sourceLevel: string
}

export async function executeSearches(tasks: SearchTask[]): Promise<SearchResultItem[]> {
  if (!tasks || tasks.length === 0) return []

  const searchPromises = tasks.map((task) => {
    const siteFilter = buildSiteFilter(task.sourceLevel)
    // D级来源直接跳过，不搜索
    if (!siteFilter && task.sourceLevel.toUpperCase() === 'D') {
      console.log(`[Search] 跳过 D 级检索: ${task.keyword}`)
      return Promise.resolve(null)
    }

    const query = `${task.keyword}${siteFilter}`
    console.log(`[Search] 检索: "${query}" (等级: ${task.sourceLevel})`)

    return firecrawl.search(query, {
      limit: 2,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true
      }
    })
  })

  const results = await Promise.allSettled(searchPromises)

  return results
    .filter((r) => r.status === 'fulfilled' && r.value !== null && (r.value as any).success !== false)
    .flatMap((r) => {
      const data = (r as PromiseFulfilledResult<any>).value?.data
      return data || []
    })
}

export type AgentDecision = {
  type: 'ask_question' | 'generate_report'
  question?: string
  options?: string[]
  report?: FinalAdviceGeneration
}

export async function runAgentWorkflow(input: AiAgentStateInput) {
  // 步骤 1：状态理解与关键词提取
  const symptoms = await extractSymptoms(input)

  // 步骤 2 & 3：高危规则判断与通用槽位检查
  // 如果命中高危 (A级)，直接停止追问和猜测，生成报告
  if (input.ruleResult.urgencyLevel === 'A') {
    const finalAdvice = buildEmergencyFinalAdvice(symptoms, input.ruleResult)
    return {
      symptoms,
      searchResults: [],
      decision: {
        type: 'generate_report' as const,
        report: finalAdvice
      }
    }
  }

  // 步骤 4：动态识别症状细节缺口
  const isInfoMissing = symptoms.missingBasicInfo.length > 0 || symptoms.missingDetailInfo.length > 0
  const round = input.round || 1

  console.log(`[Workflow] Round ${round}, isInfoMissing: ${isInfoMissing}`)

  // 步骤 5：如果缺字段且未超过最大轮次，生成追问问题
  if (isInfoMissing && round <= 3) {
    const questionGen = await generateQuestion(symptoms, round, input.chatMessages)
    if (questionGen.shouldContinueAsking) {
      return {
        symptoms,
        searchResults: [],
        decision: {
          type: 'ask_question' as const,
          question: questionGen.question,
          options: questionGen.options
        }
      }
    }
  }

  // 步骤 6：信息足够或超过轮次，生成检索任务
  const searchTask = await generateSearchTask(symptoms)
  
  // 步骤 7：联网搜索
  const searchTasks: SearchTask[] = searchTask.tasks
    .filter(t => t.isRequired)
    .map(t => ({ keyword: t.keywords, sourceLevel: t.recommendedSourceLevel }))
  const searchResults = await executeSearches(searchTasks)

  // 步骤 8：生成最终建议
  const finalAdvice = await generateFinalAdvice(symptoms, input.ruleResult, searchResults)

  return {
    symptoms,
    searchResults: searchResults.map(r => ({ title: r.metadata?.title || r.title || '参考资料', url: r.metadata?.sourceURL || r.url || '' })),
    decision: {
      type: 'generate_report' as const,
      report: finalAdvice
    }
  }
}

// ==========================================
// Optional Prompt 5: Drug Info (agent.md §10)
// ==========================================

export const DrugInfoSchema = z.object({
  usage: z.string().describe('这个药或药品类别主要用于什么症状'),
  contraindications: z.string().describe('它不适合哪些情况'),
  precautions: z.string().describe('使用前需要注意什么'),
  specialPopulations: z.string().describe('哪些人群需要先问医生或药师'),
  whenToSeeDoctor: z.string().describe('什么情况下不能继续自行处理，需要就医'),
  applicableToCurrent: z.string().describe('当前用户情况是否适合了解该类药品信息'),
})
export type DrugInfo = z.infer<typeof DrugInfoSchema>

export async function generateDrugInfo(drugName: string, symptomsContext: string): Promise<DrugInfo> {
  const systemPrompt = `你是“问康”的非处方药信息说明助手。

你的任务是根据药品说明书、国家药监局信息和权威医学资料，解释药品或药品类别的适用症状、注意事项和风险边界。

你不能开药。
你不能给剂量。
你不能推荐处方药。
你不能说“你就用这个”。

请输出：
一、这个药或药品类别主要用于什么症状
二、它不适合哪些情况
三、使用前需要注意什么
四、哪些人群需要先问医生或药师
五、什么情况下不能继续自行处理，需要就医
六、当前用户情况是否适合了解该类药品信息

注意：
- 如果用户是儿童、孕妇、老人、慢病患者、正在服药者，应提高风险提醒。
- 如果是复方感冒药，要提醒避免重复服用相同成分。
- 如果是滴眼液，要提醒眼痛、畏光、视力下降、明显眼红时不要长期自行用药。

用户询问的药品/药品类别：${drugName}
当前用户症状背景：${symptomsContext || '未提供具体症状信息'}`

  const completion = await openai.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro',
    messages: [{ role: 'system', content: systemPrompt }],
    response_format: zodResponseFormat(DrugInfoSchema, 'drug_info'),
    temperature: 0.1,
  })

  const rawContent = completion.choices[0]?.message?.content
  if (!rawContent) {
    throw new Error('Failed to generate drug info: no content from AI.')
  }

  console.log('[Agent Output] Generated Drug Info JSON:\n', rawContent)
  return DrugInfoSchema.parse(JSON.parse(rawContent))
}

