import { z } from 'zod'
import type { RuleResult } from './rules.ts'
import { rateSourceUrl, type SourceLevel } from './source-whitelist.ts'

export const aiStatusSchema = z.enum(['success', 'fallback', 'disabled', 'error'])
export type AiStatus = z.infer<typeof aiStatusSchema>

export const sourceReferenceSchema = z.object({
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().min(1).max(500),
  content: z.string().trim().max(600).optional(),
  sourceLevel: z.enum(['A', 'B', 'C', 'D']).optional(),
})

export type SourceReference = z.infer<typeof sourceReferenceSchema>

const aiDirectionSchema = z.object({
  title: z.string().trim().min(2).max(80),
  support: z.array(z.string().trim().min(2).max(140)).min(1).max(5),
  caution: z.array(z.string().trim().min(2).max(140)).min(1).max(5),
  suggestedAction: z.string().trim().min(2).max(180),
})

export const aiAnalysisOutputSchema = z.object({
  aiStatus: z.literal('success'),
  aiSummary: z.string().trim().min(12).max(900),
  possibleDirections: z.array(aiDirectionSchema).min(2).max(4),
  missingInformation: z.array(z.string().trim().min(2).max(80)).max(10),
  departmentSuggestion: z.string().trim().min(2).max(120),
  nextSteps: z.array(z.string().trim().min(2).max(160)).min(1).max(8),
  dailyAdvice: z.array(z.string().trim().min(2).max(160)).min(1).max(8),
  uncertaintyItems: z.array(z.string().trim().min(2).max(180)).min(1).max(8),
  doctorSummary: z.string().trim().min(20).max(1600),
  safetyFlags: z.array(z.string().trim().min(2).max(120)).min(1).max(8),
  sourceReferences: z.array(sourceReferenceSchema).max(8).optional(),
})

export type AiAnalysisOutput = z.infer<typeof aiAnalysisOutputSchema>
export type AiDirection = z.infer<typeof aiDirectionSchema>

export type AiEnhancedResult = Omit<RuleResult, 'possibleDirections'> & {
  aiStatus: AiStatus
  aiModel?: string
  aiSummary?: string
  possibleDirections: AiDirection[]
  missingInformation: string[]
  nextSteps: string[]
  safetyFlags: string[]
  sourceReferences: SourceReference[]
  webSearchUsed: boolean
}

export const openRouterResponseJsonSchema = {
  name: 'carecue_ai_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'aiStatus',
      'aiSummary',
      'possibleDirections',
      'missingInformation',
      'departmentSuggestion',
      'nextSteps',
      'dailyAdvice',
      'uncertaintyItems',
      'doctorSummary',
      'safetyFlags',
      'sourceReferences',
    ],
    properties: {
      aiStatus: { const: 'success' },
      aiSummary: { type: 'string', minLength: 12, maxLength: 900 },
      possibleDirections: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'support', 'caution', 'suggestedAction'],
          properties: {
            title: { type: 'string', minLength: 2, maxLength: 80 },
            support: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', minLength: 2, maxLength: 140 },
            },
            caution: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', minLength: 2, maxLength: 140 },
            },
            suggestedAction: { type: 'string', minLength: 2, maxLength: 180 },
          },
        },
      },
      missingInformation: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', minLength: 2, maxLength: 80 },
      },
      departmentSuggestion: { type: 'string', minLength: 2, maxLength: 120 },
      nextSteps: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', minLength: 2, maxLength: 160 },
      },
      dailyAdvice: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', minLength: 2, maxLength: 160 },
      },
      uncertaintyItems: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', minLength: 2, maxLength: 180 },
      },
      doctorSummary: { type: 'string', minLength: 20, maxLength: 1600 },
      safetyFlags: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', minLength: 2, maxLength: 120 },
      },
      sourceReferences: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'url', 'content'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 160 },
            url: { type: 'string', minLength: 1, maxLength: 500 },
            content: { type: 'string', maxLength: 600 },
          },
        },
      },
    },
  },
}

const forbiddenMedicalClaimPattern = /(确诊为|可以确诊|已经确诊|诊断为|一定是|肯定是|绝对是|排除.{0,12}(严重|急症|心梗|脑卒中|中风|癌|肿瘤)|保证没事|放心没事|不用就医|无需就医|医生错了|不要去医院|(建议|可以|自行).{0,6}(停药|换药)|(推荐|使用|服用|购买).{0,8}(处方药|抗生素|激素)|(处方药|抗生素|激素).{0,8}(推荐|使用|服用)|每次\s*\d+|\d+\s*(mg|g|ml|片|粒|袋|次\/日)|包治|治愈)/

export function assertAiOutputIsSafe(output: AiAnalysisOutput) {
  const joined = [
    output.aiSummary,
    output.departmentSuggestion,
    output.doctorSummary,
    ...output.possibleDirections.flatMap((direction) => [
      direction.title,
      direction.suggestedAction,
      ...direction.support,
      ...direction.caution,
    ]),
    ...output.missingInformation,
    ...output.nextSteps,
    ...output.dailyAdvice,
    ...output.uncertaintyItems,
    ...output.safetyFlags,
  ].join('\n')

  if (forbiddenMedicalClaimPattern.test(joined)) {
    throw new Error('AI output contains unsafe medical wording.')
  }
}

export function mergeAiResult(
  ruleResult: RuleResult,
  aiResult: AiAnalysisOutput,
  aiModel?: string,
  sourceReferences: SourceReference[] = [],
  webSearchUsed = false,
): AiEnhancedResult {
  assertAiOutputIsSafe(aiResult)

  const departmentSuggestion = ruleResult.urgencyLevel === 'A'
    ? ruleResult.departmentSuggestion
    : aiResult.departmentSuggestion

  return {
    ...ruleResult,
    aiStatus: 'success',
    aiModel,
    aiSummary: aiResult.aiSummary,
    possibleDirections: aiResult.possibleDirections,
    missingInformation: aiResult.missingInformation,
    departmentSuggestion,
    dailyAdvice: aiResult.dailyAdvice,
    doctorSummary: ensureDoctorSummaryCarriesRisk(aiResult.doctorSummary, ruleResult),
    uncertaintyItems: withRequiredSafetyBoundary(aiResult.uncertaintyItems),
    nextSteps: aiResult.nextSteps,
    safetyFlags: withRequiredSafetyBoundary(aiResult.safetyFlags),
    sourceReferences: dedupeSources([...(aiResult.sourceReferences ?? []), ...sourceReferences]),
    webSearchUsed,
  }
}

export function buildFallbackAiResult(ruleResult: RuleResult, aiStatus: AiStatus, aiModel?: string): AiEnhancedResult {
  return {
    ...ruleResult,
    aiStatus,
    aiModel,
    possibleDirections: ruleResult.possibleDirections.map((direction) => ({
      ...direction,
      suggestedAction: ruleResult.urgencyAdvice,
    })),
    missingInformation: [],
    nextSteps: [ruleResult.urgencyAdvice],
    safetyFlags: [
      '本次展示规则分析结果。',
      '线上信息不能替代医生面诊、查体和必要检查。',
    ],
    sourceReferences: [],
    webSearchUsed: false,
  }
}

function ensureDoctorSummaryCarriesRisk(summary: string, ruleResult: RuleResult) {
  if (summary.includes(ruleResult.urgencyTitle)) {
    return summary
  }

  return `${summary.trim()}\n风险提示：${ruleResult.urgencyTitle}。${ruleResult.urgencyAdvice}`
}

function withRequiredSafetyBoundary(items: string[]) {
  const required = [
    '以上内容是就医前信息整理，不是确诊结论。',
    '线上信息不能替代医生面诊、查体和必要检查。',
  ]

  return Array.from(new Set([...items, ...required]))
}

function dedupeSources(items: SourceReference[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.url || item.title
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

/**
 * 过滤掉 D 级（论坛/自媒体/营销）来源。
 * 在 {@link mergeAiResult} 调用前使用。
 */
export function filterLowQualitySources(items: SourceReference[]): SourceReference[] {
  return items.filter((item) => rateSourceUrl(item.url) !== 'D')
}

/**
 * 对来源进行评分并排序。
 * - A 级 → 排序权重 0
 * - B 级 → 排序权重 1
 * - C 级 → 排序权重 2
 * - D 级 → 直接过滤
 * - 同一等级内保持原始顺序（稳定排序）
 */
export function scoreAndRankSources(items: SourceReference[]): SourceReference[] {
  const levelOrder: Record<SourceLevel, number> = { A: 0, B: 1, C: 2, D: 99 }

  const withLevel = items.map((item) => {
    const level = item.sourceLevel ?? rateSourceUrl(item.url)
    return { item: { ...item, sourceLevel: level }, order: levelOrder[level] }
  })

  return withLevel
    .filter((entry) => entry.item.sourceLevel !== 'D')
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.item)
    .slice(0, 8)
}
