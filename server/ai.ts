import {
  aiAnalysisOutputSchema,
  buildFallbackAiResult,
  mergeAiResult,
  scoreAndRankSources,
  type AiAnalysisOutput,
  type AiEnhancedResult,
  type AiStatus,
  type SourceReference,
} from './ai-schema.ts'
import type { AiChatMessage } from './ai-prompt.ts'
import type { ConsultationAnswer, RuleResult, ScenarioKey } from './rules.ts'
import { rateSourceUrl } from './source-whitelist.ts'
import {
  buildEmergencyFinalAdvice,
  executeSearches,
  extractSymptoms,
  generateFinalAdvice,
  generateQuestion,
  generateSearchTask,
  type SearchResultItem,
  type SearchTask,
} from './agent.ts'

type AiAnalyzeInput = {
  answers: ConsultationAnswer[]
  chatMessages?: AiChatMessage[]
  chiefComplaint: string
  ruleResult: RuleResult
  scenario: ScenarioKey
}

export type AiChatInput = {
  answers: ConsultationAnswer[]
  chatMessages: AiChatMessage[]
  chiefComplaint: string
  ruleResult: RuleResult
  scenario: ScenarioKey
}

export type AiChatReply = {
  aiStatus: AiStatus
  aiModel?: string
  message: string
  sourceReferences: SourceReference[]
  webSearchUsed: boolean
}

const defaultModel = 'deepseek/deepseek-v4-pro'

export async function analyzeConsultationWithAi(input: AiAnalyzeInput): Promise<AiEnhancedResult> {
  const configuredModel = process.env.OPENROUTER_MODEL?.trim() || defaultModel
  console.log('\n========== [AI Analyze] 开始生成分析报告 ==========')
  console.log(`[AI Analyze] 模型: ${configuredModel}`)
  console.log(`[AI Analyze] 输入主诉: ${input.chiefComplaint}`)
  console.log(`[AI Analyze] 历史对话数: ${input.chatMessages?.length || 0}`)

  if (process.env.AI_ENABLED !== 'true') {
    console.log('[AI Analyze] AI 未启用，返回规则降级结果')
    return buildFallbackAiResult(input.ruleResult, 'disabled', configuredModel)
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    console.log('[AI Analyze] API Key 未配置，返回规则降级结果')
    return buildFallbackAiResult(input.ruleResult, 'fallback', configuredModel)
  }

  try {
    const symptoms = await extractSymptoms({
      ...input,
      chatMessages: input.chatMessages || [],
    })

    let searchResults: SearchResultItem[] = []
    let webSearchUsed = false

    if (process.env.AI_WEB_SEARCH_ENABLED === 'true' && input.ruleResult.urgencyLevel !== 'A') {
      const searchTask = await generateSearchTask(symptoms)
      const searchTasks: SearchTask[] = searchTask.tasks
        .filter((task) => task.isRequired)
        .map((task) => ({ keyword: task.keywords, sourceLevel: task.recommendedSourceLevel }))

      if (searchTasks.length > 0) {
        console.log(`[AI Analyze] 准备执行 ${searchTasks.length} 个检索任务`)
        searchResults = await executeSearches(searchTasks)
        webSearchUsed = true
        console.log(`[AI Analyze] 检索完成，获得 ${searchResults.length} 条结果`)
      } else {
        console.log('[AI Analyze] AI 判定当前症状无需执行联网检索')
      }
    }

    console.log('[AI Analyze] 准备生成最终报告...')
    const finalAdvice = input.ruleResult.urgencyLevel === 'A'
      ? buildEmergencyFinalAdvice(symptoms, input.ruleResult)
      : await generateFinalAdvice(symptoms, input.ruleResult, searchResults)

    const sourceReferences: SourceReference[] = scoreAndRankSources(
      searchResults.map(toSourceReference).filter((source): source is SourceReference => Boolean(source)),
    )

    const aiResult: AiAnalysisOutput = aiAnalysisOutputSchema.parse({
      aiStatus: 'success',
      aiSummary: clip(`${finalAdvice.generalJudgment.join('\n')}\n\n${finalAdvice.judgmentBasis}`, 900),
      possibleDirections: buildDirections(finalAdvice),
      missingInformation: finalAdvice.needsMoreInfo && finalAdvice.followUpQuestion
        ? [clip(finalAdvice.followUpQuestion, 80)]
        : [],
      departmentSuggestion: clip(input.ruleResult.departmentSuggestion, 120),
      nextSteps: clipList(finalAdvice.howToHandleNow, 160, 8),
      dailyAdvice: clipList(finalAdvice.howToHandleNow, 160, 8),
      uncertaintyItems: ['线上评估无法替代线下医生面诊、查体和必要检查。'],
      doctorSummary: clip(`主诉：${input.chiefComplaint}\n大致判断：${finalAdvice.generalJudgment.join('、')}\n依据：${finalAdvice.judgmentBasis}`, 1600),
      safetyFlags: finalAdvice.whenToSeeDoctor.length > 0
        ? clipList(finalAdvice.whenToSeeDoctor, 120, 8)
        : ['以上内容是就医前信息整理，不是确诊结论。'],
      sourceReferences,
    })

    console.log('========== [AI Analyze] 报告生成完毕 ==========\n')
    return mergeAiResult(input.ruleResult, aiResult, configuredModel, sourceReferences, webSearchUsed)
  } catch (error) {
    console.error('[AI Analyze] 发生异常，降级返回规则结果:', error)
    return buildFallbackAiResult(input.ruleResult, 'fallback', configuredModel)
  }
}

export async function chatWithAi(input: AiChatInput): Promise<AiChatReply> {
  const configuredModel = process.env.OPENROUTER_MODEL?.trim() || defaultModel
  console.log('\n========== [AI Chat] 开始处理用户回复 ==========')
  console.log(`[AI Chat] 最新用户回复: ${input.chatMessages[input.chatMessages.length - 1]?.content}`)

  if (process.env.AI_ENABLED !== 'true') {
    return fallbackChatReply('disabled', configuredModel, 'AI 聊天未启用。你可以继续补充症状，点击“生成分析报告”后系统会展示规则分析结果。')
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    return fallbackChatReply('fallback', configuredModel, 'AI 服务暂未配置。你可以继续补充症状，最终报告会先使用规则结果。')
  }

  try {
    const symptoms = await extractSymptoms(input)

    if (input.ruleResult.urgencyLevel === 'A') {
      console.log(`[AI Chat] 触发规则高危 (A级): ${input.ruleResult.urgencyTitle}`)
      return {
        aiStatus: 'success',
        aiModel: configuredModel,
        message: `根据您的描述，存在较高风险（${input.ruleResult.urgencyTitle}）。建议停止线上咨询，优先前往医院急诊排查。可以点击“生成分析报告”保存急诊沟通摘要。`,
        sourceReferences: [],
        webSearchUsed: false,
      }
    }

    const isInfoMissing = symptoms.missingBasicInfo.length > 0 || symptoms.missingDetailInfo.length > 0
    const round = countEffectiveAssistantQuestions(input.chatMessages) + 1

    console.log(`[AI Chat] 轮次: ${round}, 缺失基础信息: ${symptoms.missingBasicInfo.length}个, 缺失细节: ${symptoms.missingDetailInfo.length}个`)
    console.log('[AI Chat] 提取到的当前症状已知信息:\n', JSON.stringify(symptoms.knownInfo, null, 2))

    if (isInfoMissing && round <= 3) {
      const questionGen = await generateQuestion(symptoms, round, input.chatMessages)

      console.log(`[AI Chat] AI 判断是否需要继续追问: ${questionGen.shouldContinueAsking}`)

      if (questionGen.shouldContinueAsking) {
        const optionsText = questionGen.options.map((opt, i) => `${i + 1}. ${opt}`).join('  ')
        const finalMessage = `${questionGen.question}\n(选项参考: ${optionsText})`
        console.log(`[AI Chat] 最终返回给用户的消息: \n${finalMessage}`)
        console.log('========== [AI Chat] 结束 ==========\n')
        return {
          aiStatus: 'success',
          aiModel: configuredModel,
          message: finalMessage,
          sourceReferences: [],
          webSearchUsed: false,
        }
      }
    }

    console.log('[AI Chat] 信息已充分或达到轮次上限，提示用户生成报告')
    console.log('========== [AI Chat] 结束 ==========\n')
    return {
      aiStatus: 'success',
      aiModel: configuredModel,
      message: '目前收集的信息已经比较充分。如果没有其他要补充的症状，可以直接点击“生成分析报告”查看综合建议。',
      sourceReferences: [],
      webSearchUsed: false,
    }
  } catch (error) {
    console.error('[AI Chat] 发生异常，返回 fallback 回复:', error)
    return fallbackChatReply('fallback', configuredModel, 'AI 聊天暂不可用。请把新的症状补充写在这里，生成报告时会优先保留你的补充信息。')
  }
}

function clip(value: string, maxLength: number) {
  const normalized = String(value || '').trim()
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized
}

function clipList(values: string[], maxLength: number, maxItems: number) {
  const clipped = values.map((value) => clip(value, maxLength)).filter(Boolean).slice(0, maxItems)
  return clipped.length > 0 ? clipped : ['线上信息不能替代医生面诊、查体和必要检查。']
}

function buildDirections(finalAdvice: ReturnType<typeof buildEmergencyFinalAdvice>): AiAnalysisOutput['possibleDirections'] {
  const directions = finalAdvice.generalJudgment.slice(0, 4).map((title) => ({
    title: clip(title, 80),
    support: [clip(finalAdvice.judgmentBasis, 140)],
    caution: finalAdvice.whenToSeeDoctor.slice(0, 2).length > 0
      ? clipList(finalAdvice.whenToSeeDoctor.slice(0, 2), 140, 2)
      : ['线上信息不能替代医生面诊。'],
    suggestedAction: clip(finalAdvice.howToHandleNow[0] || '结合症状变化安排线下评估。', 180),
  }))

  while (directions.length < 2) {
    directions.push({
      title: directions.length === 0 ? '需要进一步评估' : '其他可能因素',
      support: ['当前信息仍有限，需要结合持续时间、伴随症状和医生检查判断。'],
      caution: ['如果症状加重或出现红旗信号，应及时就医。'],
      suggestedAction: clip(finalAdvice.howToHandleNow[0] || '继续观察并补充关键信息。', 180),
    })
  }

  return directions
}

function toSourceReference(result: SearchResultItem): SourceReference | null {
  const title = result.metadata?.title || result.title || '参考资料'
  const url = result.metadata?.sourceURL || result.url || ''
  if (!url) return null

  const content = typeof result.markdown === 'string'
    ? result.markdown.substring(0, 300)
    : typeof result.snippet === 'string'
      ? result.snippet.substring(0, 300)
      : ''

  return {
    title: String(title).substring(0, 160),
    url: String(url),
    content,
    sourceLevel: rateSourceUrl(String(url)),
  }
}

function countEffectiveAssistantQuestions(messages: AiChatMessage[]) {
  return messages.filter((message) => {
    if (message.role !== 'assistant') return false
    return /\?|？|选项参考/.test(message.content)
  }).length
}

function fallbackChatReply(aiStatus: AiStatus, aiModel: string, message: string): AiChatReply {
  return {
    aiStatus,
    aiModel,
    message,
    sourceReferences: [],
    webSearchUsed: false,
  }
}
