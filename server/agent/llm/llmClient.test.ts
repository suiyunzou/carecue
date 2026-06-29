import assert from 'node:assert/strict'
import { z } from 'zod'
import { createCareCueLlmClient, LlmOutputInvalidError, LlmUnavailableError, type LlmStructuredOptions } from './llmClient.ts'
import { TraceLogger } from '../logs/traceLogger.ts'

type FetchCall = {
  url: string
  body: Record<string, unknown>
}

type MockReply =
  | { status?: number; content: string; usage?: { total_tokens: number }; delayMs?: number }
  | ((
      call: FetchCall,
      index: number,
    ) => { status?: number; content: string; usage?: { total_tokens: number }; delayMs?: number })

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = globalThis.fetch
const schema = z.object({ value: z.string() })

function resetEnv() {
  process.env = { ...ORIGINAL_ENV }
  process.env.AI_ENABLED = 'true'
  process.env.AI_TIMEOUT_MS = '5000'
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_BASE_URL
  delete process.env.DEEPSEEK_MODEL
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_MODEL
  delete process.env.OPENROUTER_FALLBACK_MODEL
  delete process.env.OPENROUTER_JSON_SCHEMA
  delete process.env.LLM_PRIMARY_PROVIDER
}

function installMockFetch(replies: MockReply[]) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const rawBody =
      typeof init?.body === 'string'
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : '{}'
    const body = JSON.parse(rawBody || '{}') as Record<string, unknown>
    const call = { url, body }
    calls.push(call)

    const reply = replies[calls.length - 1]
    if (!reply) {
      return jsonResponse(500, { error: { message: 'unexpected fetch call' } })
    }
    const resolved = typeof reply === 'function' ? reply(call, calls.length - 1) : reply
    if (resolved.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, resolved.delayMs))
    }
    if (resolved.status && resolved.status >= 400) {
      return jsonResponse(resolved.status, { error: { message: resolved.content } })
    }
    return jsonResponse(resolved.status ?? 200, {
      id: `chatcmpl-${calls.length}`,
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: resolved.content },
        },
      ],
      usage: resolved.usage ?? { total_tokens: 12 },
    })
  }) as typeof fetch
  return calls
}

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function options(traceLogger?: TraceLogger): LlmStructuredOptions<z.infer<typeof schema>> {
  return {
    schema,
    schemaName: 'llm_client_test',
    system: 'Return a test object.',
    user: 'value=ok',
    trace: traceLogger ? { traceLogger, caseId: 'case-llm-client', node: 'llm.test' } : undefined,
  }
}

async function testDeepSeekPreferred() {
  resetEnv()
  process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
  process.env.OPENROUTER_API_KEY = 'sk-openrouter'
  const calls = installMockFetch([{ content: '{"value":"deepseek"}' }])

  const result = await createCareCueLlmClient().structured(options())

  assert.equal(result.value, 'deepseek')
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /api\.deepseek\.com/)
  assert.equal(calls[0].body.model, 'deepseek-v4-flash')
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' })
}

async function testDeepSeekTransientFallsBackToOpenRouter() {
  resetEnv()
  process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
  process.env.OPENROUTER_API_KEY = 'sk-openrouter'
  process.env.OPENROUTER_MODEL = 'deepseek/deepseek-v4-pro'
  const calls = installMockFetch([
    { status: 503, content: 'server overloaded' },
    { content: '{"value":"openrouter"}' },
  ])

  const result = await createCareCueLlmClient().structured(options())

  assert.equal(result.value, 'openrouter')
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /api\.deepseek\.com/)
  assert.match(calls[1].url, /openrouter\.ai/)
}

async function testInvalidDeepSeekJsonThrowsOutputInvalid() {
  resetEnv()
  process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
  process.env.OPENROUTER_API_KEY = 'sk-openrouter'
  const calls = installMockFetch([{ content: 'not-json' }])

  await assert.rejects(
    () => createCareCueLlmClient().structured(options()),
    (error) => error instanceof LlmOutputInvalidError,
  )
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /api\.deepseek\.com/)
}

async function testOpenRouterSchemaFallsBackToJsonObject() {
  resetEnv()
  process.env.OPENROUTER_API_KEY = 'sk-openrouter'
  process.env.OPENROUTER_MODEL = 'deepseek/deepseek-v4-pro'
  const calls = installMockFetch([
    { status: 400, content: 'response_format json_schema is not supported' },
    { content: '{"value":"json-object"}' },
  ])

  const result = await createCareCueLlmClient().structured(options())

  assert.equal(result.value, 'json-object')
  assert.equal(calls.length, 2)
  assert.equal((calls[0].body.response_format as { type?: string }).type, 'json_schema')
  assert.deepEqual(calls[1].body.response_format, { type: 'json_object' })
}

async function testTraceCapturesFullModelPayload() {
  resetEnv()
  process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
  process.env.TRACE_INCLUDE_MODEL_PAYLOAD = 'false'
  const calls = installMockFetch([{ content: '{"value":"traced"}' }])
  const traceLogger = new TraceLogger({ verbose: false })

  await createCareCueLlmClient().structured(options(traceLogger))

  assert.equal(calls.length, 1)
  const trace = traceLogger.getTrace('case-llm-client')
  const request = trace.find((event) => event.eventType === 'model_request')
  const response = trace.find((event) => event.eventType === 'model_response')
  assert.equal((request?.input as { provider?: string }).provider, 'deepseek')
  assert.equal((request?.input as { responseSchema?: string }).responseSchema, 'llm_client_test')
  assert.equal((request?.input as { responseFormatMode?: string }).responseFormatMode, 'json_object')
  assert.notEqual((response?.output as { responseRaw?: unknown }).responseRaw, '[omitted by TRACE config]')
  assert.deepEqual((response?.output as { responseParsed?: unknown }).responseParsed, { value: 'traced' })
  assert.equal(typeof (response?.output as { durationMs?: unknown }).durationMs, 'number')
}

async function testOverallBudgetExhaustionIsRecoverable() {
  resetEnv()
  process.env.AI_TIMEOUT_MS = '100'
  process.env.DEEPSEEK_API_KEY = 'sk-deepseek'
  process.env.OPENROUTER_API_KEY = 'sk-openrouter'
  const calls = installMockFetch([{ content: '{"value":"late"}', delayMs: 50 }, { content: '{"value":"openrouter"}' }])

  await assert.rejects(
    () => createCareCueLlmClient().structured({ ...options(), maxDurationMs: 5 }),
    (error) => error instanceof LlmUnavailableError,
  )
  assert.equal(calls.length, 1)
}

const tests = [
  testDeepSeekPreferred,
  testDeepSeekTransientFallsBackToOpenRouter,
  testInvalidDeepSeekJsonThrowsOutputInvalid,
  testOpenRouterSchemaFallsBackToJsonObject,
  testTraceCapturesFullModelPayload,
  testOverallBudgetExhaustionIsRecoverable,
]

try {
  for (const test of tests) {
    await test()
    console.log(`✓ ${test.name}`)
  }
} finally {
  process.env = ORIGINAL_ENV
  globalThis.fetch = ORIGINAL_FETCH
}
