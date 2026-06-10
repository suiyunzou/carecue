import 'dotenv/config'
import bcrypt from 'bcrypt'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import morgan from 'morgan'
import { z } from 'zod'
import { Prisma, PrismaClient } from './generated/prisma/client.ts'
import { PrismaPg } from '@prisma/adapter-pg'
import { analyzeConsultationWithAi, chatWithAi } from './ai.ts'
import {
  buildResult,
  getScenario,
  identifyScenario,
  scenarios,
  type ConsultationAnswer,
  type ScenarioKey,
} from './rules.ts'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://carecue:carecue@localhost:5432/carecue?schema=public',
})
const prisma = new PrismaClient({ adapter })
const app = express()
const port = Number(process.env.PORT ?? 4300)
const host = process.env.HOST ?? '127.0.0.1'
const jwtSecret = process.env.JWT_SECRET ?? 'carecue-local-dev-secret'
const authCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
} satisfies express.CookieOptions
const clientOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(helmet())
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || clientOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`CORS origin is not allowed: ${origin}`))
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(morgan('dev'))

type AuthedRequest = express.Request & {
  userId?: string
}

const loginSchema = z.object({
  account: z.string().trim().min(3),
  password: z.string().min(6),
})

const registerSchema = loginSchema.extend({
  displayName: z.string().trim().min(1).max(24).optional(),
})

const answerSchema = z.object({
  questionKey: z.string(),
  questionText: z.string(),
  answerValue: z.union([z.string(), z.array(z.string())]),
  answerText: z.string(),
})

const completeConsultationSchema = z.object({
  chiefComplaint: z.string().trim().min(2),
  scenario: z.string(), // changed from enum to string to support "general"
  answers: z.array(answerSchema).optional(), // changed to optional since chat might replace answers
  chatMessages: z.array(z.object({
    role: z.enum(['assistant', 'user']),
    content: z.string().trim().min(1).max(1200),
  })).max(30).optional(),
})

const chatConsultationSchema = completeConsultationSchema.extend({
  chatMessages: z.array(z.object({
    role: z.enum(['assistant', 'user']),
    content: z.string().trim().min(1).max(1200),
  })).min(1).max(30),
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'carecue-api' })
})

app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: '请输入手机号/邮箱和至少 6 位密码。' })
  }

  const { account, password, displayName } = parsed.data
  const where = accountWhere(account)
  const existing = await prisma.user.findFirst({ where })
  if (existing) {
    return res.status(409).json({ message: '该账号已注册，请直接登录。' })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: {
      ...accountData(account),
      passwordHash,
      displayName: displayName || defaultDisplayName(account),
      lastLoginAt: new Date(),
    },
  })

  setAuthCookie(res, user.id)
  return res.status(201).json({ user: publicUser(user) })
})

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: '请输入账号和密码。' })
  }

  const { account, password } = parsed.data
  const user = await prisma.user.findFirst({ where: accountWhere(account) })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: '账号或密码不正确。' })
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  setAuthCookie(res, updated.id)
  return res.json({ user: publicUser(updated) })
})

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('carecue_token', authCookieOptions)
  return res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user) {
    return res.status(401).json({ message: '登录状态已失效。' })
  }

  return res.json({ user: publicUser(user) })
})

app.get('/api/rules/scenarios', requireAuth, (_req, res) => {
  res.json({
    scenarios: scenarios.map((scenario) => ({
      key: scenario.key,
      name: scenario.name,
      questions: scenario.questions,
    })),
  })
})

app.post('/api/consultations/start', requireAuth, (req, res) => {
  const chiefComplaint = z.string().trim().min(2).safeParse(req.body?.chiefComplaint)
  if (!chiefComplaint.success) {
    return res.status(400).json({ message: '请先简单描述哪里不舒服。' })
  }

  const scenario = identifyScenario(chiefComplaint.data)
  return res.json({
    scenario: scenario.key,
    scenarioName: scenario.name,
    questions: scenario.questions,
  })
})

app.post('/api/consultations/chat', requireAuth, async (req, res) => {
  const parsed = chatConsultationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: '聊天信息格式不正确。' })
  }

  const payload = parsed.data
  const scenario = getScenario(payload.scenario)
  if (!scenario) {
    return res.status(400).json({ message: '暂不支持该咨询场景。' })
  }

  const answers = payload.answers || []

  const ruleResult = buildResult(
    payload.chiefComplaint,
    payload.scenario as ScenarioKey,
    answers as ConsultationAnswer[],
  )
  const reply = await chatWithAi({
    answers: answers as ConsultationAnswer[],
    chatMessages: payload.chatMessages,
    chiefComplaint: payload.chiefComplaint,
    ruleResult,
    scenario: payload.scenario as ScenarioKey,
  })

  return res.json({ reply })
})

app.post('/api/consultations/complete', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = completeConsultationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: '咨询信息校验失败，请检查提交内容。' })
  }

  const payload = parsed.data
  const scenario = getScenario(payload.scenario)
  if (!scenario) {
    return res.status(400).json({ message: '暂不支持该咨询场景。' })
  }

  const answers = payload.answers || []

  const ruleResult = buildResult(
    payload.chiefComplaint,
    payload.scenario as ScenarioKey,
    answers as ConsultationAnswer[],
  )
  const result = await analyzeConsultationWithAi({
    answers: answers as ConsultationAnswer[],
    chatMessages: payload.chatMessages,
    chiefComplaint: payload.chiefComplaint,
    ruleResult,
    scenario: payload.scenario as ScenarioKey,
  })

  const record = await prisma.$transaction(async (tx) => {
    const createdRecord = await tx.consultationRecord.create({
      data: {
        userId: req.userId!,
        chiefComplaint: payload.chiefComplaint,
        scenario: payload.scenario,
        riskLevel: result.riskLevel,
        answers: {
          create: payload.answers.map((answer) => ({
            questionKey: answer.questionKey,
            questionText: answer.questionText,
            answerValue: answer.answerValue,
            answerText: answer.answerText,
          })),
        },
        result: {
          create: {
            riskLevel: result.riskLevel,
            urgencyLevel: result.urgencyLevel,
            urgencyTitle: result.urgencyTitle,
            urgencyAdvice: result.urgencyAdvice,
            possibleDirections: result.possibleDirections,
            departmentSuggestion: result.departmentSuggestion,
            dailyAdvice: result.dailyAdvice,
            doctorSummary: result.doctorSummary,
            uncertaintyItems: result.uncertaintyItems,
            aiStatus: result.aiStatus,
            aiModel: result.aiModel,
            aiSummary: result.aiSummary,
            missingInformation: result.missingInformation,
            nextSteps: result.nextSteps,
            safetyFlags: result.safetyFlags,
            sourceReferences: result.sourceReferences,
            webSearchUsed: result.webSearchUsed,
          },
        },
      },
      include: consultationInclude,
    })

    return createdRecord
  })

  return res.status(201).json({ record: serializeRecord(record), result })
})

app.get('/api/consultations', requireAuth, async (req: AuthedRequest, res) => {
  const records = await prisma.consultationRecord.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    include: { result: true },
  })

  return res.json({
    records: records.map((record) => ({
      id: record.id,
      chiefComplaint: record.chiefComplaint,
      scenario: record.scenario,
      riskLevel: record.riskLevel,
      urgencyLevel: record.result?.urgencyLevel,
      departmentSuggestion: record.result?.departmentSuggestion,
      createdAt: record.createdAt,
    })),
  })
})

app.get('/api/consultations/:id', requireAuth, async (req: AuthedRequest, res) => {
  const recordId = paramAsString(req.params.id)
  const record = await prisma.consultationRecord.findFirst({
    where: { id: recordId, userId: req.userId },
    include: consultationInclude,
  })

  if (!record) {
    return res.status(404).json({ message: '没有找到该咨询记录。' })
  }

  return res.json({ record: serializeRecord(record) })
})

app.delete('/api/consultations/:id', requireAuth, async (req: AuthedRequest, res) => {
  const recordId = paramAsString(req.params.id)
  const record = await prisma.consultationRecord.findFirst({
    where: { id: recordId, userId: req.userId },
    select: { id: true },
  })

  if (!record) {
    return res.status(404).json({ message: '没有找到该咨询记录。' })
  }

  await prisma.consultationRecord.delete({ where: { id: record.id } })
  return res.json({ ok: true })
})

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next
  console.error(err)
  return res.status(500).json({ message: '服务暂时不可用，请稍后重试。' })
})

const server = app.listen(port, host, () => {
  console.log(`CareCue API listening on http://${host}:${port}`)
})

server.on('error', (error) => {
  console.error('CareCue API failed to start', error)
  process.exit(1)
})

function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  const token = req.cookies?.carecue_token || bearer

  if (!token) {
    return res.status(401).json({ message: '请先登录。' })
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as { userId: string }
    req.userId = payload.userId
    return next()
  } catch {
    return res.status(401).json({ message: '登录状态已失效，请重新登录。' })
  }
}

function setAuthCookie(res: express.Response, userId: string) {
  const token = jwt.sign({ userId }, jwtSecret, { expiresIn: '7d' })
  res.cookie('carecue_token', token, authCookieOptions)
}

function accountWhere(account: string) {
  return account.includes('@') ? { email: account.toLowerCase() } : { phone: account }
}

function accountData(account: string) {
  return account.includes('@') ? { email: account.toLowerCase() } : { phone: account }
}

function defaultDisplayName(account: string) {
  if (account.includes('@')) {
    return account.split('@')[0]
  }

  return `用户${account.slice(-4)}`
}

function publicUser(user: { id: string; phone: string | null; email: string | null; displayName: string; lastLoginAt: Date | null }) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    displayName: user.displayName,
    lastLoginAt: user.lastLoginAt,
  }
}

const consultationInclude = {
  answers: { orderBy: { createdAt: 'asc' } },
  result: true,
} satisfies Prisma.ConsultationRecordInclude

type ConsultationWithDetails = Prisma.ConsultationRecordGetPayload<{
  include: typeof consultationInclude
}>

function serializeRecord(record: ConsultationWithDetails) {
  return {
    id: record.id,
    chiefComplaint: record.chiefComplaint,
    scenario: record.scenario,
    riskLevel: record.riskLevel,
    status: record.status,
    createdAt: record.createdAt,
    answers: record.answers,
    result: record.result,
  }
}

function paramAsString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
