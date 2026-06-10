import {
  buildFallbackAiResult,
  mergeAiResult,
  scoreAndRankSources,
  type AiEnhancedResult,
  type AiStatus,
  type SourceReference,
} from './ai-schema.ts'
import type { AiChatMessage } from './ai-prompt.ts'
import type { ConsultationAnswer, RuleResult, ScenarioKey } from './rules.ts'
import { rateSourceUrl } from './source-whitelist.ts'
import {
  extractSymptoms,
  generateQuestion,
  generateSearchTask,
  generateFinalAdvice,
  executeSearches,
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
      chatMessages: input.chatMessages || []
    })

    let searchResults: SearchResultItem[] = []
    let webSearchUsed = false
    if (process.env.AI_WEB_SEARCH_ENABLED === 'true') {
      const searchTask = await generateSearchTask(symptoms)
      const searchTasks: SearchTask[] = searchTask.tasks
        .filter(t => t.isRequired)
        .map(t => ({ keyword: t.keywords, sourceLevel: t.recommendedSourceLevel }))
      if (searchTasks.length > 0) {
        console.log(`[AI Analyze] 准备执行 ${searchTasks.length} 个检索任务`)
        searchResults = await executeSearches(searchTasks)
        webSearchUsed = true
        console.log(`[AI Analyze] 检索完成，获得 ${searchResults.length} 条结果`)
      } else {
         console.log(`[AI Analyze] AI 判定当前症状无需执行联网检索`)
      }
    }

    console.log(`[AI Analyze] 准备生成最终报告...`)
    const finalAdvice = await generateFinalAdvice(symptoms, input.ruleResult, searchResults)
    const sourceReferences: SourceReference[] = scoreAndRankSources(
      searchResults.map(r => ({
        title: String(r.title || '参考资料'),
        url: String(r.url || ''),
        content: typeof r.snippet === 'string' ? r.snippet.substring(0, 100) : '',
        sourceLevel: rateSourceUrl(String(r.url || '')),
      })).filter(r => r.url)
    )

    // Map FinalAdviceGeneration to AiAnalysisOutput to reuse mergeAiResult
    const aiResult = {
      aiStatus: 'success' as const,
      aiSummary: finalAdvice.generalJudgment.join('\n') + '\n\n' + finalAdvice.judgmentBasis,
      possibleDirections: finalAdvice.generalJudgment.map(title => ({
        title,
        support: [finalAdvice.judgmentBasis.substring(0, 100)],
        caution: finalAdvice.whenToSeeDoctor.slice(0, 2),
        suggestedAction: finalAdvice.howToHandleNow[0] || '建议就医评估'
      })),
      missingInformation: finalAdvice.needsMoreInfo && finalAdvice.followUpQuestion ? [finalAdvice.followUpQuestion] : [],
      departmentSuggestion: input.ruleResult.departmentSuggestion,
      nextSteps: finalAdvice.howToHandleNow,
      dailyAdvice: finalAdvice.howToHandleNow,
      uncertaintyItems: ['线上评估无法替代线下医生面诊'],
      doctorSummary: `主诉：${input.chiefComplaint}\n大致判断：${finalAdvice.generalJudgment.join('、')}\n依据：${finalAdvice.judgmentBasis}`,
      safetyFlags: finalAdvice.whenToSeeDoctor,
      sourceReferences
    }

    // Ensure possibleDirections has at least 2 items to satisfy schema if needed, but we bypass zod here and directly use mergeAiResult
    if (aiResult.possibleDirections.length === 0) {
      aiResult.possibleDirections.push({
        title: '需要进一步评估',
        support: ['当前信息不足以给出明确方向'],
        caution: finalAdvice.whenToSeeDoctor,
        suggestedAction: '建议线下就医'
      })
    }
    if (aiResult.possibleDirections.length === 1) {
      aiResult.possibleDirections.push({
        title: '其他潜在原因',
        support: ['症状可能由多种因素引起'],
        caution: ['请注意观察病情变化'],
        suggestedAction: '如不缓解请就医'
      })
    }

    console.log(`========== [AI Analyze] 报告生成完毕 ========== \n`)
    return mergeAiResult(input.ruleResult, aiResult as AiAnalysisOutput, configuredModel, sourceReferences, webSearchUsed)
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
        message: `根据您的描述，存在较高风险（${input.ruleResult.urgencyTitle}）。建议您停止线上咨询，尽快前往医院急诊排查。您可以点击“生成分析报告”保存记录。`,
        sourceReferences: [],
        webSearchUsed: false,
      }
    }

    const isInfoMissing = symptoms.missingBasicInfo.length > 0 || symptoms.missingDetailInfo.length > 0
    const round = input.chatMessages.filter(m => m.role === 'assistant').length + 1
    
    console.log(`[AI Chat] 轮次: ${round}, 缺失基础信息: ${symptoms.missingBasicInfo.length}个, 缺失细节: ${symptoms.missingDetailInfo.length}个`)
    console.log(`[AI Chat] 提取到的当前症状已知信息:\n`, JSON.stringify(symptoms.knownInfo, null, 2))

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

    console.log(`[AI Chat] 信息已充分或达到轮次上限，提示用户生成报告`)
    console.log('========== [AI Chat] 结束 ==========\n')
    return {
      aiStatus: 'success',
      aiModel: configuredModel,
      message: '目前收集的信息已经比较充分。如果您没有其他要补充的症状，可以直接点击“生成分析报告”查看综合建议。',
      sourceReferences: [],
      webSearchUsed: false,
    }
  } catch (error) {
    console.error('[AI Chat] 发生异常，返回 fallback 回复:', error)
    return fallbackChatReply('fallback', configuredModel, 'AI 聊天暂不可用。请把新的症状补充写在这里，生成报告时会优先保留你的补充信息。')
  }
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
