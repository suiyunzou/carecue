import {
  aiAnalysisOutputSchema,
  buildFallbackAiResult,
  mergeAiResult,
  openRouterResponseJsonSchema,
  type AiEnhancedResult,
  type AiStatus,
  type SourceReference,
} from './ai-schema.ts'
import { buildAiMessages, buildChatMessages, type AiChatMessage } from './ai-prompt.ts'
import type { ConsultationAnswer, RuleResult, ScenarioKey } from './rules.ts'

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

type OpenRouterChoice = {
  message?: {
    annotations?: unknown
    content?: unknown
  }
}

type OpenRouterResponse = {
  choices?: OpenRouterChoice[]
  model?: string
  usage?: {
    server_tool_use?: {
      web_search_requests?: number
    }
  }
}

const defaultModel = 'deepseek/deepseek-v4-pro'
const defaultFallbackModel = 'deepseek/deepseek-v4-flash'

export async function analyzeConsultationWithAi(input: AiAnalyzeInput): Promise<AiEnhancedResult> {
  const configuredModel = process.env.OPENROUTER_MODEL?.trim() || defaultModel

  if (process.env.AI_ENABLED !== 'true') {
    return buildFallbackAiResult(input.ruleResult, 'disabled', configuredModel)
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    return buildFallbackAiResult(input.ruleResult, 'fallback', configuredModel)
  }

  try {
    const response = await callOpenRouter({
      apiKey,
      body: {
        ...modelRoutingBody(configuredModel),
        messages: buildAiMessages(input),
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: openRouterResponseJsonSchema,
        },
        ...webSearchBody(),
      },
    })
    const rawContent = extractMessageContent(response)
    const parsedJson = JSON.parse(rawContent) as unknown
    const parsed = aiAnalysisOutputSchema.parse(parsedJson)
    const sourceReferences = extractSourceReferences(response)
    const webSearchUsed = webSearchWasUsed(response)

    return mergeAiResult(input.ruleResult, parsed, response.model ?? configuredModel, sourceReferences, webSearchUsed)
  } catch (error) {
    console.error('AI analysis fallback', error)
    return buildFallbackAiResult(input.ruleResult, 'fallback', configuredModel)
  }
}

export async function chatWithAi(input: AiChatInput): Promise<AiChatReply> {
  const configuredModel = process.env.OPENROUTER_MODEL?.trim() || defaultModel

  if (process.env.AI_ENABLED !== 'true') {
    return fallbackChatReply('disabled', configuredModel, 'AI 聊天未启用。你可以继续补充症状，点击“生成分析报告”后系统会展示规则分析结果。')
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    return fallbackChatReply('fallback', configuredModel, 'AI 服务暂未配置。你可以继续补充症状，最终报告会先使用规则结果。')
  }

  try {
    const response = await callOpenRouter({
      apiKey,
      body: {
        ...modelRoutingBody(configuredModel),
        messages: buildChatMessages(input),
        temperature: 0.3,
        ...webSearchBody(),
      },
    })

    return {
      aiStatus: 'success',
      aiModel: response.model ?? configuredModel,
      message: extractMessageContent(response),
      sourceReferences: extractSourceReferences(response),
      webSearchUsed: webSearchWasUsed(response),
    }
  } catch (error) {
    console.error('AI chat fallback', error)
    return fallbackChatReply('fallback', configuredModel, 'AI 聊天暂不可用。请把新的症状补充写在这里，生成报告时会优先保留你的补充信息。')
  }
}

async function callOpenRouter(input: { apiKey: string; body: Record<string, unknown> }) {
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 20000)
  const controller = new AbortController()
  const timeout = windowlessSetTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_REFERER?.trim() || 'http://localhost:5173',
        'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE?.trim() || 'CareCue',
      },
      body: JSON.stringify(input.body),
    })

    if (!response.ok) {
      throw new Error(`OpenRouter request failed with ${response.status}.`)
    }

    return await response.json() as OpenRouterResponse
  } finally {
    clearTimeout(timeout)
  }
}

function modelRoutingBody(configuredModel: string) {
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL?.trim() || defaultFallbackModel
  return fallbackModel && fallbackModel !== configuredModel
    ? { models: [configuredModel, fallbackModel], route: 'fallback' }
    : { model: configuredModel }
}

function webSearchBody() {
  if (process.env.AI_WEB_SEARCH_ENABLED !== 'true') {
    return {}
  }

  const allowedDomains = parseCsv(process.env.OPENROUTER_SEARCH_ALLOWED_DOMAINS)
  const excludedDomains = parseCsv(process.env.OPENROUTER_SEARCH_EXCLUDED_DOMAINS)
  const parameters = {
    engine: process.env.OPENROUTER_SEARCH_ENGINE?.trim() || 'auto',
    max_results: Number(process.env.OPENROUTER_SEARCH_MAX_RESULTS ?? 5),
    max_total_results: Number(process.env.OPENROUTER_SEARCH_MAX_TOTAL_RESULTS ?? 10),
    search_context_size: process.env.OPENROUTER_SEARCH_CONTEXT_SIZE?.trim() || 'low',
    ...(allowedDomains.length ? { allowed_domains: allowedDomains } : {}),
    ...(excludedDomains.length && !allowedDomains.length ? { excluded_domains: excludedDomains } : {}),
  }

  return {
    tools: [
      {
        type: 'openrouter:web_search',
        parameters,
      },
    ],
  }
}

function extractMessageContent(response: OpenRouterResponse) {
  const content = response.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === 'string') return item
        if (typeof item === 'object' && item !== null && 'text' in item) {
          return String((item as { text: unknown }).text)
        }
        return ''
      })
      .join('')
      .trim()

    if (text) return text
  }

  throw new Error('OpenRouter response does not contain text content.')
}

function extractSourceReferences(response: OpenRouterResponse): SourceReference[] {
  const annotations = response.choices?.flatMap((choice) => {
    const raw = choice.message?.annotations
    return Array.isArray(raw) ? raw : []
  }) ?? []

  const references = annotations.flatMap((annotation) => {
    if (typeof annotation !== 'object' || annotation === null) return []
    const item = annotation as Record<string, unknown>
    const citation = typeof item.url_citation === 'object' && item.url_citation !== null
      ? item.url_citation as Record<string, unknown>
      : item
    const url = typeof citation.url === 'string' ? citation.url : ''
    const title = typeof citation.title === 'string' ? citation.title : url
    const content = typeof citation.content === 'string' ? citation.content : undefined
    return url ? [{ title, url, content }] : []
  })

  const seen = new Set<string>()
  return references.filter((reference) => {
    if (seen.has(reference.url)) return false
    seen.add(reference.url)
    return true
  }).slice(0, 8)
}

function webSearchWasUsed(response: OpenRouterResponse) {
  return Number(response.usage?.server_tool_use?.web_search_requests ?? 0) > 0 || extractSourceReferences(response).length > 0
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

function parseCsv(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function windowlessSetTimeout(callback: () => void, timeoutMs: number) {
  return setTimeout(callback, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000)
}
