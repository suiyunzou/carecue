// LLM 客户端封装 — OpenRouter（DeepSeek），结构化输出 + 降级
// TECHNICAL.md §5：json_schema 不稳定时降级为 json_object + 本地 Zod 校验；
// 未配置 API Key 时抛出 LlmUnavailableError，由上层走规则降级。

import OpenAI from 'openai'
import type { ZodType } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

export class LlmUnavailableError extends Error {
  constructor(message = 'LLM 未启用或未配置 API Key') {
    super(message)
    this.name = 'LlmUnavailableError'
  }
}

export class LlmOutputInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmOutputInvalidError'
  }
}

export type LlmStructuredOptions<T> = {
  schema: ZodType<T>
  schemaName: string
  system: string
  user: string
  temperature?: number
}

export interface LlmClient {
  readonly model: string
  available(): boolean
  structured<T>(options: LlmStructuredOptions<T>): Promise<T>
}

/** LLM 调用关键步骤日志，便于在后台定位"哪一步慢、花了多少 token"。AGENT_LLM_LOG=false 可关闭。 */
function logLlm(line: string) {
  if (process.env.AGENT_LLM_LOG !== 'false') {
    console.log(`[LLM] ${line}`)
  }
}

export function createOpenRouterLlmClient(): LlmClient {
  const model = process.env.OPENROUTER_MODEL?.trim() || 'deepseek/deepseek-v4-pro'
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL?.trim()
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 20000)

  // 一旦确认当前模型不支持 json_schema（response_format 报错），后续调用直接走 json_object，
  // 避免每次调用都先发一次注定失败的 json_schema 请求（这会让每步 LLM 付出双倍延迟）。
  let jsonSchemaDisabled = process.env.OPENROUTER_JSON_SCHEMA === 'false'

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || 'dummy',
    timeout: timeoutMs,
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:5173',
      'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE || 'CareCue',
    },
  })

  function isAvailable(): boolean {
    return process.env.AI_ENABLED === 'true' && Boolean(process.env.OPENROUTER_API_KEY?.trim())
  }

  async function completeOnce<T>(
    options: LlmStructuredOptions<T>,
    useModel: string,
    mode: 'json_schema' | 'json_object',
  ): Promise<{ data: T; tokens: number }> {
    const completion = await client.chat.completions.create({
      model: useModel,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      temperature: options.temperature ?? 0.1,
      response_format:
        mode === 'json_schema'
          ? zodResponseFormat(options.schema, options.schemaName)
          : { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content
    if (!raw) {
      throw new LlmOutputInvalidError('LLM 未返回内容')
    }

    const parsed = options.schema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      throw new LlmOutputInvalidError(`LLM 输出不符合 schema: ${parsed.error.message}`)
    }
    return { data: parsed.data, tokens: completion.usage?.total_tokens ?? 0 }
  }

  return {
    model,
    available: isAvailable,
    async structured<T>(options: LlmStructuredOptions<T>): Promise<T> {
      if (!isAvailable()) {
        throw new LlmUnavailableError()
      }

      const startedAt = Date.now()
      const useSchema = !jsonSchemaDisabled

      // json_schema -> json_object -> 备选模型，逐级降级
      try {
        const result = await completeOnce(options, model, useSchema ? 'json_schema' : 'json_object')
        logLlm(`${options.schemaName} ✓ ${model} ${useSchema ? 'schema' : 'json'} ${Date.now() - startedAt}ms ${result.tokens}tok`)
        return result.data
      } catch (error) {
        const formatError = isResponseFormatError(error)
        if (formatError && !jsonSchemaDisabled) {
          jsonSchemaDisabled = true
          logLlm(`检测到模型不支持 json_schema，后续调用改用 json_object 模式`)
        }
        if (error instanceof LlmOutputInvalidError || formatError) {
          try {
            const result = await completeOnce(options, model, 'json_object')
            logLlm(`${options.schemaName} ✓ ${model} json(降级) ${Date.now() - startedAt}ms ${result.tokens}tok`)
            return result.data
          } catch (secondError) {
            if (fallbackModel) {
              const result = await completeOnce(options, fallbackModel, 'json_object')
              logLlm(`${options.schemaName} ✓ ${fallbackModel} json(备选模型) ${Date.now() - startedAt}ms ${result.tokens}tok`)
              return result.data
            }
            logLlm(`${options.schemaName} ✗ ${Date.now() - startedAt}ms ${String(secondError).slice(0, 120)}`)
            throw secondError
          }
        }
        if (fallbackModel) {
          const result = await completeOnce(options, fallbackModel, useSchema ? 'json_schema' : 'json_object')
          logLlm(`${options.schemaName} ✓ ${fallbackModel} ${useSchema ? 'schema' : 'json'}(备选模型) ${Date.now() - startedAt}ms ${result.tokens}tok`)
          return result.data
        }
        logLlm(`${options.schemaName} ✗ ${Date.now() - startedAt}ms ${String(error).slice(0, 120)}`)
        throw error
      }
    },
  }
}

function isResponseFormatError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /response_format|json_schema|structured/i.test(message)
}
