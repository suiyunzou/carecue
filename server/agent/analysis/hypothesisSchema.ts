// Hypothesis / 分析输出 schema — v3.0 设计文档 §13.5 / §24

import { z } from 'zod'

const likelihoodValues = ['more_likely', 'possible', 'less_likely', 'must_rule_out'] as const
const riskLevelValues = ['low', 'medium', 'high'] as const

const baseHypothesisSchema = z.object({
  name: z.string(),
  likelihood: z.enum(likelihoodValues),
  supportEvidence: z.array(z.string()),
  againstEvidence: z.array(z.string()),
  missingInfo: z.array(z.string()),
  riskLevel: z.enum(riskLevelValues),
  doctorCheckQuestion: z.string(),
  explanationForUser: z.string(),
  evidenceRefs: z.array(z.string()),
})

export const hypothesisSchema = z.preprocess(normalizeHypothesis, baseHypothesisSchema)

const baseMissingInfoSchema = z.object({
  field: z.string(),
  question: z.string(),
  reason: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  relatedHypothesis: z.string().nullable().optional(),
  relatedRiskRule: z.string().nullable().optional(),
})

export const missingInfoSchema = z.preprocess(normalizeMissingInfo, baseMissingInfoSchema)

const baseCaseAnalyzeOutputSchema = z.object({
  hypotheses: z.array(hypothesisSchema).min(1).max(5),
  missingInfo: z.array(missingInfoSchema),
  stageConclusion: z.string(),
  canFinalAnswer: z.boolean(),
  shouldAskUser: z.boolean(),
  shouldSearchMore: z.boolean(),
  shouldGenerateCarePlan: z.boolean(),
})

export const caseAnalyzeOutputSchema = z.preprocess(normalizeCaseAnalyzeOutput, baseCaseAnalyzeOutputSchema)

export type CaseAnalyzeOutput = z.infer<typeof caseAnalyzeOutputSchema>

function normalizeCaseAnalyzeOutput(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    hypotheses: Array.isArray(value.hypotheses) ? value.hypotheses : [],
    missingInfo: toArray(value.missingInfo ?? value.uncertainties ?? value.needMoreInfo),
    stageConclusion: firstString(value.stageConclusion, value.conclusion, value.summary, '目前根据已提供信息形成阶段性整理。'),
    canFinalAnswer: firstBoolean(value.canFinalAnswer, false),
    shouldAskUser: firstBoolean(value.shouldAskUser, toArray(value.missingInfo ?? value.needMoreInfo).length > 0),
    shouldSearchMore: firstBoolean(value.shouldSearchMore, false),
    shouldGenerateCarePlan: firstBoolean(value.shouldGenerateCarePlan, false),
  }
}

function normalizeHypothesis(value: unknown): unknown {
  if (typeof value === 'string') {
    return buildHypothesis({
      name: value,
      likelihood: 'possible',
      supportEvidence: ['用户描述提示该方向可能相关。'],
      missingInfo: ['仍需补充更多信息来区分不同方向。'],
    })
  }
  if (!isRecord(value)) return value

  const name = firstString(
    value.name,
    value.hypothesisName,
    value.hypothesis,
    value.disease,
    value.condition,
    value.diagnosis,
    value.direction,
    value.title,
    value.label,
    '需进一步确认的方向',
  )
  const supportEvidence = toStringArray(
    value.supportEvidence ??
      value.supportingEvidence ??
      value.support ??
      value.evidence ??
      value.reasons ??
      value.reason ??
      value.basis,
  )
  const againstEvidence = toStringArray(
    value.againstEvidence ??
      value.contraEvidence ??
      value.contraryEvidence ??
      value.against ??
      value.negativeEvidence,
  )
  const missingInfo = toStringArray(
    value.missingInfo ??
      value.uncertainties ??
      value.uncertainty ??
      value.needMoreInfo ??
      value.unconfirmedInfo ??
      value.questions,
  )

  return buildHypothesis({
    name,
    likelihood: normalizeLikelihood(value.likelihood ?? value.probability ?? value.possibility ?? value.confidence ?? value.tendency),
    supportEvidence,
    againstEvidence,
    missingInfo,
    riskLevel: normalizeRiskLevel(value.riskLevel ?? value.risk ?? value.severity),
    doctorCheckQuestion: firstString(value.doctorCheckQuestion, value.questionForDoctor, value.doctorQuestion),
    explanationForUser: firstString(value.explanationForUser, value.explanation, value.summary, value.reason),
    evidenceRefs: toStringArray(value.evidenceRefs ?? value.references ?? value.refs),
  })
}

function normalizeMissingInfo(value: unknown): unknown {
  if (typeof value === 'string') {
    return {
      field: value,
      question: value.endsWith('？') || value.endsWith('?') ? value : `请补充：${value}`,
      reason: '用于区分不同可能方向。',
      priority: 'medium',
    }
  }
  if (!isRecord(value)) return value
  const question = firstString(value.question, value.label, value.field, '请补充更多关键信息。')
  return {
    field: firstString(value.field, value.targetField, value.path, question),
    question,
    reason: firstString(value.reason, value.why, '用于区分不同可能方向。'),
    priority: normalizePriority(value.priority),
    relatedHypothesis: value.relatedHypothesis ?? undefined,
    relatedRiskRule: value.relatedRiskRule ?? undefined,
  }
}

function buildHypothesis(input: {
  name: string
  likelihood: (typeof likelihoodValues)[number]
  supportEvidence: string[]
  againstEvidence?: string[]
  missingInfo: string[]
  riskLevel?: (typeof riskLevelValues)[number]
  doctorCheckQuestion?: string
  explanationForUser?: string
  evidenceRefs?: string[]
}) {
  return {
    name: input.name,
    likelihood: input.likelihood,
    supportEvidence: input.supportEvidence.length ? input.supportEvidence : ['用户描述提示该方向可能相关。'],
    againstEvidence: input.againstEvidence ?? [],
    missingInfo: input.missingInfo.length ? input.missingInfo : ['仍需补充更多信息来区分不同方向。'],
    riskLevel: input.riskLevel ?? 'medium',
    doctorCheckQuestion: input.doctorCheckQuestion || `请医生评估是否为${input.name}。`,
    explanationForUser: input.explanationForUser || `${input.name}是当前需要进一步确认的方向之一。`,
    evidenceRefs: input.evidenceRefs ?? [],
  }
}

function normalizeLikelihood(value: unknown): (typeof likelihoodValues)[number] {
  const text = firstString(value).toLowerCase()
  if (/must[_ -]?rule[_ -]?out|排除|高风险|危险/.test(text)) return 'must_rule_out'
  if (/more[_ -]?likely|likely|更像|更可能|高度|较高|主要/.test(text)) return 'more_likely'
  if (/less[_ -]?likely|unlikely|不太|较低|低可能|暂不支持/.test(text)) return 'less_likely'
  return 'possible'
}

function normalizeRiskLevel(value: unknown): (typeof riskLevelValues)[number] {
  const text = firstString(value).toLowerCase()
  if (/high|高|严重/.test(text)) return 'high'
  if (/low|低|轻/.test(text)) return 'low'
  return 'medium'
}

function normalizePriority(value: unknown): 'high' | 'medium' | 'low' {
  const text = firstString(value).toLowerCase()
  if (/high|高/.test(text)) return 'high'
  if (/low|低/.test(text)) return 'low'
  return 'medium'
}

function firstBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value == null || value === '' ? [] : [value]
}

function toStringArray(value: unknown): string[] {
  return toArray(value).flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : []
    if (typeof item === 'number' && Number.isFinite(item)) return [String(item)]
    if (isRecord(item)) return [firstString(item.text, item.label, item.question, item.reason)].filter(Boolean)
    return []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
