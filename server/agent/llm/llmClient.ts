// LLM 客户端封装 — DeepSeek 直连主路径 + OpenRouter 回退。
// DeepSeek 官方 API 走 json_object + 本地 Zod 校验；OpenRouter 保留 json_schema -> json_object 降级。
// 未配置 API Key 时抛出 LlmUnavailableError，由上层走规则降级。
// 调用方可传入 trace 钩子，记录完整请求/响应/解析结果/重试/失败原因。

import OpenAI from 'openai'
import type { ZodType } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { TraceLogger, TraceStatus } from '../logs/traceLogger.ts'

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

export function isRecoverableLlmError(error: unknown): error is LlmUnavailableError | LlmOutputInvalidError {
  return error instanceof LlmUnavailableError || error instanceof LlmOutputInvalidError
}

export type LlmTraceHook = {
  traceLogger: TraceLogger
  caseId: string
  node: string
}

export type LlmStructuredOptions<T> = {
  schema: ZodType<T>
  schemaName: string
  system: string
  user: string
  temperature?: number
  /** 可选：限制本次结构化调用的总耗时，耗尽后抛 LlmUnavailableError 让工具走降级。 */
  maxDurationMs?: number
  /** 可选：把这次调用的完整请求/响应写入 Trace（model_request/model_response） */
  trace?: LlmTraceHook
}

export interface LlmClient {
  readonly model: string
  available(): boolean
  structured<T>(options: LlmStructuredOptions<T>): Promise<T>
}

type ProviderName = 'deepseek' | 'openrouter'
type ResponseFormatMode = 'json_schema' | 'json_object'

type ProviderAttemptConfig = {
  provider: ProviderName
  model: string
  baseURL: string
  apiKey: string
  client: OpenAI
  responseFormatMode: ResponseFormatMode
  jsonSchemaMemoKey?: 'openrouter'
}

type Attempt<T> = {
  data?: T
  provider: ProviderName
  model: string
  baseURL: string
  tokens?: number
  finishReason?: string
  httpStatus?: number
  responseRaw?: unknown
  responseParsed?: unknown
  durationMs: number
  responseFormatMode: ResponseFormatMode
  error?: { name?: string; message: string; statusCode?: number; responseBody?: unknown }
}

type AttemptError = NonNullable<Attempt<unknown>['error']>

/** LLM 调用关键步骤日志，便于在后台定位"哪一步慢、花了多少 token"。AGENT_LLM_LOG=false 可关闭。 */
function logLlm(line: string) {
  if (process.env.AGENT_LLM_LOG !== 'false') {
    console.log(`[LLM] ${line}`)
  }
}

export function createCareCueLlmClient(): LlmClient {
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 20000)
  const primaryProvider = (process.env.LLM_PRIMARY_PROVIDER?.trim() || 'deepseek').toLowerCase()

  const deepseekBaseURL = process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com'
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash'
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim() || ''

  const openRouterBaseURL = 'https://openrouter.ai/api/v1'
  const openRouterModel = process.env.OPENROUTER_MODEL?.trim() || 'deepseek/deepseek-v4-pro'
  const openRouterFallbackModel = process.env.OPENROUTER_FALLBACK_MODEL?.trim()
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || ''

  let openRouterJsonSchemaDisabled = process.env.OPENROUTER_JSON_SCHEMA === 'false'

  const deepseekClient = new OpenAI({
    baseURL: deepseekBaseURL,
    apiKey: deepseekApiKey || 'dummy',
    timeout: timeoutMs,
    maxRetries: 0,
  })

  const openRouterClient = new OpenAI({
    baseURL: openRouterBaseURL,
    apiKey: openRouterApiKey || 'dummy',
    timeout: timeoutMs,
    maxRetries: 0,
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:5173',
      'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE || 'CareCue',
    },
  })

  function isAvailable(): boolean {
    if (process.env.AI_ENABLED !== 'true') return false
    return Boolean(deepseekApiKey || openRouterApiKey)
  }

  function buildAttemptPlan(): ProviderAttemptConfig[] {
    const deepseekAttempts: ProviderAttemptConfig[] = deepseekApiKey
      ? [
          {
            provider: 'deepseek',
            model: deepseekModel,
            baseURL: deepseekBaseURL,
            apiKey: deepseekApiKey,
            client: deepseekClient,
            responseFormatMode: 'json_object',
          },
        ]
      : []

    const openRouterAttempts: ProviderAttemptConfig[] = openRouterApiKey
      ? [
          {
            provider: 'openrouter',
            model: openRouterModel,
            baseURL: openRouterBaseURL,
            apiKey: openRouterApiKey,
            client: openRouterClient,
            responseFormatMode: openRouterJsonSchemaDisabled ? 'json_object' : 'json_schema',
            jsonSchemaMemoKey: 'openrouter',
          },
          ...(openRouterFallbackModel
            ? [
                {
                  provider: 'openrouter' as const,
                  model: openRouterFallbackModel,
                  baseURL: openRouterBaseURL,
                  apiKey: openRouterApiKey,
                  client: openRouterClient,
                  responseFormatMode: 'json_object' as const,
                },
              ]
            : []),
        ]
      : []

    if (primaryProvider === 'openrouter') return [...openRouterAttempts, ...deepseekAttempts]
    return [...deepseekAttempts, ...openRouterAttempts]
  }

  function emitRequestTrace(options: LlmStructuredOptions<unknown>, config: ProviderAttemptConfig) {
    const trace = options.trace
    if (!trace) return
    trace.traceLogger.logModelRequest(trace.caseId, {
      node: trace.node,
      request: {
        provider: config.provider,
        model: config.model,
        baseURL: config.baseURL,
        temperature: options.temperature ?? 0.1,
        messages: buildMessages(options, config.responseFormatMode),
        responseSchema: options.schemaName,
        responseFormatMode: config.responseFormatMode,
        maxDurationMs: options.maxDurationMs,
      },
    })
  }

  function emitResponseTrace(
    options: LlmStructuredOptions<unknown>,
    attempts: Attempt<unknown>[],
    status: TraceStatus,
    fallbackReason?: string,
  ) {
    const trace = options.trace
    if (!trace) return
    const last = attempts[attempts.length - 1]
    trace.traceLogger.logModelResponse(trace.caseId, {
      node: trace.node,
      response: {
        provider: last?.provider,
        model: last?.model,
        baseURL: last?.baseURL,
        httpStatus: last?.httpStatus ?? last?.error?.statusCode,
        responseFormatMode: last?.responseFormatMode,
        responseRaw: last?.responseRaw,
        responseParsed: last?.responseParsed,
        usage: last?.tokens != null ? { totalTokens: last.tokens } : undefined,
        finishReason: last?.finishReason,
        retries: Math.max(0, attempts.length - 1),
        attempts: attempts.map((attempt) => ({
          provider: attempt.provider,
          model: attempt.model,
          baseURL: attempt.baseURL,
          responseFormatMode: attempt.responseFormatMode,
          durationMs: attempt.durationMs,
          status: attempt.error ? 'failed' : 'success',
          httpStatus: attempt.httpStatus ?? attempt.error?.statusCode,
          error: attempt.error,
        })),
        timeoutMs,
        maxDurationMs: options.maxDurationMs,
        durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      },
      status,
      fallbackReason,
      error: last?.error
        ? {
            name: last.error.name,
            message: last.error.message,
            statusCode: last.error.statusCode,
            responseBody: last.error.responseBody,
          }
        : undefined,
    })
  }

  return {
    model: primaryProvider === 'openrouter' ? openRouterModel : deepseekModel,
    available: isAvailable,
    async structured<T>(options: LlmStructuredOptions<T>): Promise<T> {
      if (!isAvailable()) {
        throw new LlmUnavailableError()
      }

      const startedAt = Date.now()
      const attempts: Attempt<unknown>[] = []
      const plan = buildAttemptPlan()

      for (let index = 0; index < plan.length; index += 1) {
        if (isOverallBudgetExhausted(startedAt, options.maxDurationMs)) {
          break
        }
        const config = plan[index]
        emitRequestTrace(options, config)
        const attempt = await completeOnce(options, config, attemptTimeoutMs(timeoutMs, startedAt, options.maxDurationMs))
        attempts.push(attempt as Attempt<unknown>)

        if (!attempt.error) {
          const status: TraceStatus = index === 0 ? 'success' : 'fallback'
          const fallbackReason =
            index === 0
              ? undefined
              : `前 ${index} 次 LLM 尝试失败，切换到 ${config.provider}:${config.model} 后成功`
          logLlm(
            `${options.schemaName} ✓ ${config.provider}:${config.model} ${config.responseFormatMode} ${Date.now() - startedAt}ms ${attempt.tokens ?? 0}tok`,
          )
          emitResponseTrace(options, attempts, status, fallbackReason)
          return attempt.data as T
        }

        if (config.provider === 'deepseek' && isStructuredOutputError(attempt.error)) {
          logLlm(`${options.schemaName} ✗ ${config.provider}:${config.model} ${Date.now() - startedAt}ms ${attempt.error.message}`)
          emitResponseTrace(options, attempts, 'failed', 'DeepSeek 返回内容不是合法结构化输出，进入工具降级')
          throw toThrowable(attempt.error)
        }

        const formatError = isResponseFormatError(attempt.error.message)
        if (config.jsonSchemaMemoKey === 'openrouter' && formatError && !openRouterJsonSchemaDisabled) {
          openRouterJsonSchemaDisabled = true
          logLlm('检测到 OpenRouter 当前模型不支持 json_schema，后续调用改用 json_object 模式')

          const jsonObjectRetry: ProviderAttemptConfig = { ...config, responseFormatMode: 'json_object' }
          if (isOverallBudgetExhausted(startedAt, options.maxDurationMs)) {
            break
          }
          emitRequestTrace(options, jsonObjectRetry)
          const retryAttempt = await completeOnce(
            options,
            jsonObjectRetry,
            attemptTimeoutMs(timeoutMs, startedAt, options.maxDurationMs),
          )
          attempts.push(retryAttempt as Attempt<unknown>)
          if (!retryAttempt.error) {
            logLlm(`${options.schemaName} ✓ ${config.provider}:${config.model} json(降级) ${Date.now() - startedAt}ms ${retryAttempt.tokens ?? 0}tok`)
            emitResponseTrace(options, attempts, 'fallback', 'OpenRouter json_schema 不支持，降级为 json_object 后成功')
            return retryAttempt.data as T
          }
        }

        logLlm(`${options.schemaName} ✗ ${config.provider}:${config.model} ${Date.now() - startedAt}ms ${attempt.error.message}`)
      }

      const last = attempts[attempts.length - 1]
      const reason = isOverallBudgetExhausted(startedAt, options.maxDurationMs)
        ? `LLM 总预算 ${options.maxDurationMs}ms 已耗尽`
        : attempts.length > 1
          ? '所有 LLM 供应商/模型尝试均失败'
          : undefined
      emitResponseTrace(options, attempts, 'failed', reason)
      if (isOverallBudgetExhausted(startedAt, options.maxDurationMs)) {
        throw new LlmUnavailableError(reason)
      }
      throw toThrowable(last?.error ?? { message: 'LLM 未执行任何可用尝试' })
    },
  }
}

/** 保留旧导出名，避免现有调用方和外部测试断裂。 */
export function createOpenRouterLlmClient(): LlmClient {
  return createCareCueLlmClient()
}

async function completeOnce<T>(
  options: LlmStructuredOptions<T>,
  config: ProviderAttemptConfig,
  timeoutMs: number,
): Promise<Attempt<T>> {
  const startedAt = Date.now()
  let completion: OpenAI.Chat.Completions.ChatCompletion
  try {
    completion = await withLocalTimeout(
      config.client.chat.completions.create({
        model: config.model,
        messages: buildMessages(options, config.responseFormatMode),
        temperature: options.temperature ?? 0.1,
        response_format:
          config.responseFormatMode === 'json_schema'
            ? zodResponseFormat(options.schema, options.schemaName)
            : { type: 'json_object' },
      }),
      timeoutMs,
    )
  } catch (error) {
    const err = error as { status?: number; message?: string; error?: unknown; name?: string }
    return {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      durationMs: Date.now() - startedAt,
      responseFormatMode: config.responseFormatMode,
      error: {
        name: err.name,
        message: err.message ?? String(error),
        statusCode: err.status,
        responseBody: err.error,
      },
    }
  }

  const raw = completion.choices[0]?.message?.content
  const finishReason = completion.choices[0]?.finish_reason
  const tokens = completion.usage?.total_tokens ?? 0

  if (!raw) {
    return {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      durationMs: Date.now() - startedAt,
      responseFormatMode: config.responseFormatMode,
      tokens,
      finishReason,
      responseRaw: completion,
      error: { name: 'LlmOutputInvalidError', message: 'LLM 未返回内容' },
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch (jsonError) {
    return {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      durationMs: Date.now() - startedAt,
      responseFormatMode: config.responseFormatMode,
      tokens,
      finishReason,
      responseRaw: raw,
      error: { name: 'JSONParseError', message: `LLM 返回内容不是合法 JSON: ${String(jsonError)}` },
    }
  }

  const parsed = options.schema.safeParse(parsedJson)
  if (!parsed.success) {
    return {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      durationMs: Date.now() - startedAt,
      responseFormatMode: config.responseFormatMode,
      tokens,
      finishReason,
      responseRaw: raw,
      responseParsed: parsedJson,
      error: { name: 'SchemaValidationError', message: `LLM 输出不符合 schema: ${parsed.error.message}` },
    }
  }

  return {
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL,
    data: parsed.data,
    tokens,
    finishReason,
    durationMs: Date.now() - startedAt,
    responseFormatMode: config.responseFormatMode,
    responseRaw: raw,
    responseParsed: parsed.data,
  }
}

function buildMessages<T>(
  options: LlmStructuredOptions<T>,
  mode: ResponseFormatMode,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const jsonInstruction =
    mode === 'json_object'
      ? `\n\nYou must return only valid JSON. Do not wrap it in Markdown. The JSON must conform to the requested schema named "${options.schemaName}".`
      : ''
  return [
    { role: 'system', content: `${options.system}${jsonInstruction}` },
    { role: 'user', content: options.user },
  ]
}

function toThrowable(error: { name?: string; message: string; statusCode?: number }): Error {
  if (isTransientLlmUnavailableError(error)) {
    return new LlmUnavailableError(error.message)
  }
  if (error.name === 'SchemaValidationError' || error.name === 'JSONParseError' || error.name === 'LlmOutputInvalidError') {
    return new LlmOutputInvalidError(error.message)
  }
  return new Error(error.message)
}

function isResponseFormatError(message: string): boolean {
  return /response_format|json_schema|structured/i.test(message)
}

function isStructuredOutputError(error: Pick<AttemptError, 'name'>): boolean {
  return error.name === 'SchemaValidationError' || error.name === 'JSONParseError' || error.name === 'LlmOutputInvalidError'
}

function isTransientLlmUnavailableError(error: Pick<AttemptError, 'name' | 'message' | 'statusCode'>): boolean {
  const message = `${error.name ?? ''} ${error.message}`.toLowerCase()
  if (/timeout|timed out|etimedout|econnreset|econnrefused|enotfound|fetch failed|network|socket hang up/.test(message)) {
    return true
  }
  return error.statusCode === 408 || error.statusCode === 429 || (error.statusCode != null && error.statusCode >= 500)
}

function isOverallBudgetExhausted(startedAt: number, maxDurationMs: number | undefined): boolean {
  return maxDurationMs != null && Date.now() - startedAt >= maxDurationMs
}

function attemptTimeoutMs(timeoutMs: number, startedAt: number, maxDurationMs: number | undefined): number {
  if (maxDurationMs == null) return timeoutMs
  const remainingMs = maxDurationMs - (Date.now() - startedAt)
  return Math.max(1, Math.min(timeoutMs, remainingMs))
}

async function withLocalTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LlmUnavailableError(`LLM request timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
