import 'dotenv/config'
import assert from 'node:assert/strict'
import { PrismaClient } from './generated/prisma/client.ts'
import { PrismaPg } from '@prisma/adapter-pg'

const apiBase = process.env.API_BASE_URL ?? 'http://127.0.0.1:4300/api'
const proxyApiBase = process.env.PROXY_API_BASE_URL ?? 'http://localhost:5173/api'
const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://carecue:carecue@localhost:5432/carecue?schema=public',
  }),
})
const createdAccounts = {
  emails: [] as string[],
  phones: [] as string[],
}

type JsonObject = Record<string, unknown>

type TestResponse = {
  body: JsonObject
  cookie: string
  headers: Headers
  status: number
}

type TestCase = {
  name: string
  run: () => Promise<void>
}

const tests: TestCase[] = [
  {
    name: 'register creates a user, returns public fields, and sets auth cookie',
    run: async () => {
      const account = testEmail('register-success')
      const response = await post('/auth/register', {
        account,
        password: 'secret123',
        displayName: '测试用户',
      })

      assert.equal(response.status, 201)
      assert.equal(userField(response, 'email'), account)
      assert.equal(userField(response, 'displayName'), '测试用户')
      assert.equal(hasUserField(response, 'passwordHash'), false)
      assert.match(response.cookie, /carecue_token=/)
      assert.match(setCookieHeader(response), /HttpOnly/)
      assert.match(setCookieHeader(response), /SameSite=Lax/)
      assert.match(setCookieHeader(response), /Max-Age=604800/)
      assert.match(setCookieHeader(response), /Path=\//)
    },
  },
  {
    name: 'register without displayName uses email prefix as default display name',
    run: async () => {
      const account = testEmail('default-name')
      const response = await post('/auth/register', {
        account,
        password: 'secret123',
      })

      assert.equal(response.status, 201)
      assert.equal(userField(response, 'displayName'), account.split('@')[0])
    },
  },
  {
    name: 'register without displayName uses phone suffix as default display name',
    run: async () => {
      const account = testPhone('188')
      const response = await post('/auth/register', {
        account,
        password: 'secret123',
      })

      assert.equal(response.status, 201)
      assert.equal(userField(response, 'phone'), account)
      assert.equal(userField(response, 'displayName'), `用户${account.slice(-4)}`)
    },
  },
  {
    name: 'register rejects duplicate account',
    run: async () => {
      const account = testEmail('duplicate')
      const first = await post('/auth/register', {
        account,
        password: 'secret123',
        displayName: '重复用户',
      })
      const second = await post('/auth/register', {
        account,
        password: 'secret123',
        displayName: '重复用户',
      })

      assert.equal(first.status, 201)
      assert.equal(second.status, 409)
      assert.equal(second.body.message, '该账号已注册，请直接登录。')
    },
  },
  {
    name: 'register rejects missing account',
    run: async () => {
      const response = await post('/auth/register', {
        password: 'secret123',
        displayName: '缺少账号',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'register rejects missing password',
    run: async () => {
      const response = await post('/auth/register', {
        account: testEmail('missing-password'),
        displayName: '缺少密码',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'register rejects password shorter than six characters',
    run: async () => {
      const response = await post('/auth/register', {
        account: testEmail('short-password'),
        password: '12345',
        displayName: '短密码',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'register rejects blank account after trimming',
    run: async () => {
      const response = await post('/auth/register', {
        account: '   ',
        password: 'secret123',
        displayName: '空账号',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'register rejects empty displayName',
    run: async () => {
      const response = await post('/auth/register', {
        account: testEmail('empty-display-name'),
        password: 'secret123',
        displayName: '',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'register rejects displayName longer than 24 characters',
    run: async () => {
      const response = await post('/auth/register', {
        account: testEmail('long-display-name'),
        password: 'secret123',
        displayName: '一二三四五六七八九十一二三四五六七八九十一二三四五',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'login succeeds with correct email and password',
    run: async () => {
      const account = testEmail('login-success')
      await register(account, '登录用户')

      const response = await post('/auth/login', {
        account,
        password: 'secret123',
      })

      assert.equal(response.status, 200)
      assert.equal(userField(response, 'email'), account)
      assert.match(response.cookie, /carecue_token=/)
    },
  },
  {
    name: 'login succeeds when request includes empty displayName from frontend state',
    run: async () => {
      const account = testEmail('login-empty-display-name')
      await register(account, '登录空昵称字段')

      const response = await post('/auth/login', {
        account,
        password: 'secret123',
        displayName: '',
      })

      assert.equal(response.status, 200)
      assert.equal(userField(response, 'email'), account)
    },
  },
  {
    name: 'login rejects wrong password',
    run: async () => {
      const account = testEmail('wrong-password')
      await register(account, '错误密码')

      const response = await post('/auth/login', {
        account,
        password: 'wrong123',
      })

      assert.equal(response.status, 401)
      assert.equal(response.body.message, '账号或密码不正确。')
    },
  },
  {
    name: 'login rejects nonexistent account',
    run: async () => {
      const response = await post('/auth/login', {
        account: testEmail('not-found'),
        password: 'secret123',
      })

      assert.equal(response.status, 401)
    },
  },
  {
    name: 'login rejects missing account',
    run: async () => {
      const response = await post('/auth/login', {
        password: 'secret123',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'login rejects missing password',
    run: async () => {
      const response = await post('/auth/login', {
        account: testEmail('login-missing-password'),
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'login rejects password shorter than six characters',
    run: async () => {
      const response = await post('/auth/login', {
        account: testEmail('login-short-password'),
        password: '12345',
      })

      assert.equal(response.status, 400)
    },
  },
  {
    name: 'auth/me returns current user after registration cookie',
    run: async () => {
      const account = testEmail('me-after-register')
      const registered = await register(account, '会话用户')
      const response = await get('/auth/me', registered.cookie)

      assert.equal(response.status, 200)
      assert.equal(userField(response, 'email'), account)
    },
  },
  {
    name: 'auth/me rejects missing cookie',
    run: async () => {
      const response = await get('/auth/me')

      assert.equal(response.status, 401)
      assert.equal(response.body.message, '请先登录。')
    },
  },
  {
    name: 'auth/me rejects invalid cookie',
    run: async () => {
      const response = await get('/auth/me', 'carecue_token=invalid-token')

      assert.equal(response.status, 401)
      assert.equal(response.body.message, '登录状态已失效，请重新登录。')
    },
  },
  {
    name: 'registered cookie can call protected agent consult',
    run: async () => {
      const account = testEmail('protected-agent')
      const registered = await register(account, 'Agent 用户')
      const response = await post('/agent/consult', {
        message: '最近总是站起来头晕',
      }, registered.cookie)
      const agentResponse = response.body.response
      assertJsonObject(agentResponse)

      assert.equal(response.status, 200)
      assert.equal(typeof agentResponse.caseId, 'string')
      assert.ok(['followup', 'stage_report', 'final_report', 'emergency'].includes(String(agentResponse.type)))
    },
  },
  {
    name: 'agent consult supports multi-turn follow-up on the same case',
    run: async () => {
      const account = testEmail('agent-multiturn')
      const registered = await register(account, '多轮用户')
      const first = await post('/agent/consult', {
        message: '咳嗽 2 天，有一点喉咙痒，没有发热',
      }, registered.cookie)
      const firstResponse = first.body.response
      assertJsonObject(firstResponse)

      assert.equal(first.status, 200)
      const caseId = String(firstResponse.caseId)

      const second = await post('/agent/consult', {
        caseId,
        message: '晚上咳得稍微多一点',
      }, registered.cookie)
      const secondResponse = second.body.response
      assertJsonObject(secondResponse)

      assert.equal(second.status, 200)
      assert.equal(String(secondResponse.caseId), caseId)
      assert.ok(['followup', 'stage_report', 'final_report', 'emergency'].includes(String(secondResponse.type)))
    },
  },
  {
    name: 'logout clears browser cookie and unauthenticated request is rejected',
    run: async () => {
      const account = testEmail('logout')
      const registered = await register(account, '登出用户')
      const beforeLogout = await get('/auth/me', registered.cookie)
      const logoutResponse = await post('/auth/logout', {}, registered.cookie)
      const afterCookieCleared = await get('/auth/me')

      assert.equal(beforeLogout.status, 200)
      assert.equal(logoutResponse.status, 200)
      assert.match(setCookieHeader(logoutResponse), /carecue_token=/)
      assert.match(setCookieHeader(logoutResponse), /Expires=Thu, 01 Jan 1970/)
      assert.match(setCookieHeader(logoutResponse), /Path=\//)
      assert.equal(afterCookieCleared.status, 401)
      assert.equal(afterCookieCleared.body.message, '请先登录。')
    },
  },
  {
    name: 'users cannot read or delete another user consultation record',
    run: async () => {
      const owner = await register(testEmail('record-owner'), '记录所有者')
      const otherUser = await register(testEmail('record-other-user'), '其他用户')
      const ownerUser = responseUser(owner)
      const record = await createTestConsultationRecord(ownerUser.id as string)

      const ownerRead = await get(`/consultations/${record.id}`, owner.cookie)
      const otherRead = await get(`/consultations/${record.id}`, otherUser.cookie)
      const otherDelete = await del(`/consultations/${record.id}`, otherUser.cookie)
      const ownerDelete = await del(`/consultations/${record.id}`, owner.cookie)
      const ownerReadAfterDelete = await get(`/consultations/${record.id}`, owner.cookie)

      assert.equal(ownerRead.status, 200)
      assert.equal(otherRead.status, 404)
      assert.equal(otherRead.body.message, '没有找到该咨询记录。')
      assert.equal(otherDelete.status, 404)
      assert.equal(ownerDelete.status, 200)
      assert.equal(ownerReadAfterDelete.status, 404)
    },
  },
]

await main()

async function main() {
  let failed = 0
  try {
    await assertApiIsRunning()

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

    await runProxyCookieContinuitySmoke()

    if (failed > 0) {
      throw new Error(`${failed} API auth test(s) failed.`)
    }

    console.log(`PASS ${tests.length} API auth tests`)
  } finally {
    await cleanupCreatedUsers()
    await prisma.$disconnect()
  }
}

async function assertApiIsRunning() {
  const response = await fetch(`${apiBase}/health`).catch(() => undefined)
  assert.ok(response, `API is not reachable at ${apiBase}. Start it with npm run dev:api.`)
  assert.equal(response.status, 200)
}

async function runProxyCookieContinuitySmoke() {
  const health = await fetch(`${proxyApiBase}/health`).catch(() => undefined)
  if (!health || health.status !== 200) {
    console.log(`SKIP proxy cookie continuity smoke: ${proxyApiBase} is not reachable.`)
    return
  }

  const account = testEmail('proxy-cookie')
  const registered = await request(`${proxyApiBase}/auth/register`, {
    method: 'POST',
    body: {
      account,
      password: 'secret123',
      displayName: '代理会话用户',
    },
  })
  const consulted = await request(`${proxyApiBase}/agent/consult`, {
    cookie: registered.cookie,
    method: 'POST',
    body: { message: '最近总是站起来头晕' },
  })

  assert.equal(registered.status, 201)
  assert.equal(consulted.status, 200)
  assert.equal(typeof consulted.body.response, 'object')
  console.log('PASS proxy cookie continuity smoke')
}

async function register(account: string, displayName: string) {
  const response = await post('/auth/register', {
    account,
    password: 'secret123',
    displayName,
  })

  assert.equal(response.status, 201)
  return response
}

async function get(path: string, cookie = '') {
  return request(`${apiBase}${path}`, {
    cookie,
    method: 'GET',
  })
}

async function post(path: string, body: JsonObject, cookie = '') {
  return request(`${apiBase}${path}`, {
    cookie,
    method: 'POST',
    body,
  })
}

async function del(path: string, cookie = '') {
  return request(`${apiBase}${path}`, {
    cookie,
    method: 'DELETE',
  })
}

async function request(url: string, options: { body?: JsonObject; cookie?: string; method: 'DELETE' | 'GET' | 'POST' }) {
  const headers = new Headers()
  if (options.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (options.cookie) {
    headers.set('Cookie', options.cookie)
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const body = await response.json().catch(() => ({})) as JsonObject

  return {
    body,
    cookie: authCookie(response.headers),
    headers: response.headers,
    status: response.status,
  } satisfies TestResponse
}

function authCookie(headers: Headers) {
  const header = headers.get('set-cookie') ?? ''
  return header.split(';')[0] ?? ''
}

function setCookieHeader(response: TestResponse) {
  return response.headers.get('set-cookie') ?? ''
}

function userField(response: TestResponse, key: string) {
  const user = response.body.user
  assertUserObject(user)
  return user[key]
}

function hasUserField(response: TestResponse, key: string) {
  const user = response.body.user
  assertUserObject(user)
  return Object.hasOwn(user, key)
}

function assertUserObject(value: unknown): asserts value is JsonObject {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
}

function responseUser(response: TestResponse) {
  const user = response.body.user
  assertUserObject(user)
  return user
}

function assertJsonObject(value: unknown): asserts value is JsonObject {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
}

async function createTestConsultationRecord(userId: string) {
  return prisma.consultationRecord.create({
    data: {
      userId,
      chiefComplaint: '最近总是站起来头晕',
      scenario: 'agent_v3',
      riskLevel: 'low',
      result: {
        create: {
          riskLevel: 'low',
          urgencyLevel: 'C',
          urgencyTitle: '测试记录',
          urgencyAdvice: '建议观察',
          possibleDirections: [],
          departmentSuggestion: '全科',
          dailyAdvice: [],
          doctorSummary: '测试摘要',
          uncertaintyItems: [],
          aiStatus: 'success',
        },
      },
    },
  })
}

function testEmail(prefix: string) {
  const email = `${prefix}-${runId}@example.com`
  createdAccounts.emails.push(email)
  return email
}

function testPhone(prefix: string) {
  const phone = `${prefix}${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`
  createdAccounts.phones.push(phone)
  return phone
}

async function cleanupCreatedUsers() {
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { in: createdAccounts.emails } },
        { phone: { in: createdAccounts.phones } },
      ],
    },
  })
}
