// 症状抽取工具 symptom.extract — v3.0 设计文档 §31.1
// LLM 抽取为主；LLM 不可用时降级为词典 + 规则抽取（TECHNICAL.md fallback 要求）。

import { z } from 'zod'
import { defineTool } from '../tools/Tool.ts'
import type { CaseState, SymptomState, UserProfile } from '../case/CaseState.ts'
import { buildUnderstandSymptomsPrompt } from '../llm/prompts/understandSymptoms.prompt.ts'
import { isRecoverableLlmError } from '../llm/llmClient.ts'
import {
  extractDurationText,
  extractTermsByDictionary,
  normalizeSymptomText,
} from './symptomNormalizer.ts'
import { SYMPTOM_DOMAIN_CONFIGS } from './symptomDomainConfig.ts'

const SYMPTOM_EXTRACT_LLM_BUDGET_MS = Number(process.env.AGENT_SYMPTOM_EXTRACT_LLM_BUDGET_MS ?? 12000)
const SYMPTOM_EXTRACT_TOOL_TIMEOUT_MS = Number(process.env.AGENT_SYMPTOM_EXTRACT_TOOL_TIMEOUT_MS ?? 30000)

const symptomExtractInputSchema = z.object({
  userMessage: z.string().min(1),
})

const symptomExtractOutputSchema = z.object({
  chiefComplaint: z.string(),
  onsetTime: z.string(),
  duration: z.string(),
  location: z.string(),
  severity: z.string(),
  frequency: z.string(),
  painQuality: z.string(),
  onsetPattern: z.string(),
  triggers: z.array(z.string()),
  relievingFactors: z.array(z.string()),
  associatedSymptoms: z.array(z.string()),
  negativeSymptoms: z.array(z.string()),
  progression: z.enum(['improving', 'stable', 'worsening', 'unknown']),
  age: z.number().nullable(),
  sex: z.enum(['male', 'female', 'unknown']),
  pregnancy: z.boolean().nullable(),
  chronicDiseases: z.array(z.string()),
  currentMedications: z.array(z.string()),
  unclearFields: z.array(z.string()),
  userOriginalText: z.string(),
})

export type SymptomExtractOutput = z.infer<typeof symptomExtractOutputSchema>

type LlmSymptomExtractOutput = Omit<SymptomExtractOutput, 'userOriginalText'>

const flatLlmSymptomExtractSchema = symptomExtractOutputSchema.omit({ userOriginalText: true })

const nestedLlmSymptomExtractSchema = z.object({
  symptoms: z.record(z.string(), z.unknown()).optional(),
  userProfile: z.record(z.string(), z.unknown()).optional(),
  unclearFields: z.array(z.string()).optional(),
}).transform((value): LlmSymptomExtractOutput => {
  const symptoms = value.symptoms ?? {}
  const profile = value.userProfile ?? {}

  return {
    chiefComplaint: firstString(symptoms.chiefComplaint, firstArrayItem(symptoms.userOriginalText)),
    onsetTime: firstString(symptoms.onsetTime),
    duration: firstString(symptoms.duration),
    location: firstString(symptoms.location),
    severity: firstString(symptoms.severity),
    frequency: firstString(symptoms.frequency),
    painQuality: firstString(symptoms.painQuality, symptoms.character),
    onsetPattern: firstString(symptoms.onsetPattern),
    triggers: uniqueStrings([...toStringArray(symptoms.triggers), ...toStringArray(symptoms.aggravatingFactors)]),
    relievingFactors: toStringArray(symptoms.relievingFactors),
    associatedSymptoms: toStringArray(symptoms.associatedSymptoms),
    negativeSymptoms: toStringArray(symptoms.negativeSymptoms),
    progression: normalizeProgression(symptoms.progression),
    age: normalizeAge(profile.age),
    sex: normalizeSex(firstString(profile.sex, profile.gender)),
    pregnancy: normalizeBoolean(profile.pregnancy),
    chronicDiseases: toStringArray(profile.chronicDiseases),
    currentMedications: toStringArray(profile.currentMedications),
    unclearFields: value.unclearFields ?? toStringArray(symptoms.unclearFields),
  }
})

const llmSymptomExtractSchema = z.union([flatLlmSymptomExtractSchema, nestedLlmSymptomExtractSchema])

export const symptomExtractTool = defineTool({
  name: 'symptom.extract',
  description: '从用户最新消息中抽取症状结构化信息（不诊断、不建议）。',
  inputSchema: symptomExtractInputSchema,
  outputSchema: symptomExtractOutputSchema,
  guardLevel: 'medical_reasoning',
  timeoutMs: SYMPTOM_EXTRACT_TOOL_TIMEOUT_MS,

  async call(input, ctx) {
    const userMessage = input.userMessage

    try {
      const prompt = buildUnderstandSymptomsPrompt(userMessage, ctx.state)
      const result = await ctx.llm.structured({
        schema: llmSymptomExtractSchema,
        schemaName: 'symptom_extraction',
        system: prompt.system,
        user: prompt.user,
        temperature: 0.1,
        maxDurationMs: SYMPTOM_EXTRACT_LLM_BUDGET_MS,
        trace: { traceLogger: ctx.traceLogger, caseId: ctx.caseId, node: 'symptom.extract' },
      })
      return mergeWithHeuristic(result, heuristicExtract(userMessage), userMessage)
    } catch (error) {
      if (!isRecoverableLlmError(error)) throw error
      ctx.traceLogger.log(ctx.caseId, 'llm_fallback', {
        reason: 'symptom.extract 使用词典规则降级抽取',
      })
      ctx.markFallback('symptom.extract: LLM 不可用，使用词典规则降级抽取')
      return heuristicExtract(userMessage)
    }
  },

  toStatePatch(output, state): Partial<CaseState> {
    const symptoms: Partial<SymptomState> = {
      chiefComplaint: output.chiefComplaint || state.symptoms.chiefComplaint || output.userOriginalText,
      onsetTime: output.onsetTime || undefined,
      duration: output.duration || undefined,
      location: output.location || undefined,
      severity: output.severity || undefined,
      frequency: output.frequency || undefined,
      painQuality: output.painQuality || undefined,
      onsetPattern: output.onsetPattern || undefined,
      triggers: output.triggers,
      relievingFactors: output.relievingFactors,
      associatedSymptoms: output.associatedSymptoms,
      negativeSymptoms: output.negativeSymptoms,
      progression: output.progression,
      userOriginalText: [output.userOriginalText],
    }

    const validAge =
      typeof output.age === 'number' && Number.isFinite(output.age) && output.age > 0 && output.age <= 120
        ? Math.round(output.age)
        : undefined

    const userProfile: Partial<UserProfile> = {
      age: validAge,
      sex: output.sex === 'unknown' ? undefined : output.sex,
      pregnancy: output.pregnancy ?? undefined,
      chronicDiseases: output.chronicDiseases.length > 0 ? output.chronicDiseases : undefined,
      currentMedications: output.currentMedications.length > 0 ? output.currentMedications : undefined,
    }

    return {
      symptoms: symptoms as SymptomState,
      userProfile: userProfile as UserProfile,
    }
  },

  toTrace(output) {
    return { output, reason: '症状抽取完成' }
  },
})

/** 词典 + 规则降级抽取 */
function heuristicExtract(userMessage: string): SymptomExtractOutput {
  const text = normalizeSymptomText(userMessage)

  const allSignals = Array.from(
    new Set(SYMPTOM_DOMAIN_CONFIGS.flatMap((config) => [...config.redFlagSignals, ...config.triggerTerms])),
  )
  const { confirmed, denied } = extractTermsByDictionary(text, allSignals)

  const ageMatch = text.match(/(\d{1,3})\s*岁/)
  const worsening = /越来越(重|疼|痛|严重)|不断加重|加重了/.test(text)
  const improving = /好(多了|转)|缓解了|轻多了/.test(text)
  const location = extractLikelyLocation(text)
  const triggers = [
    /熬夜|通宵/.test(text) ? '熬夜' : '',
    /不洗澡|没洗澡|未洗澡/.test(text) ? '不洗澡' : '',
  ].filter(Boolean)
  const relievingFactors = [
    improving ? '休息后缓解' : '',
    /洗澡.*(减轻|缓解|好转)|洗完澡.*(减轻|缓解|好转)/.test(text) ? '洗澡后减轻' : '',
  ].filter(Boolean)

  return {
    chiefComplaint: userMessage.slice(0, 60),
    onsetTime: '',
    duration: extractDurationText(text) ?? '',
    location,
    severity: /剧烈|特别(疼|痛|严重)|受不了/.test(text) ? '重' : '',
    frequency: '',
    painQuality: /压榨|闷紧|压迫/.test(text) ? '压榨感' : /刺痛|针扎/.test(text) ? '刺痛' : '',
    onsetPattern: /突然|一下子/.test(text) ? '突然发生' : '',
    triggers,
    relievingFactors,
    associatedSymptoms: confirmed,
    negativeSymptoms: denied,
    progression: worsening ? 'worsening' : improving ? 'improving' : 'unknown',
    age: ageMatch ? Number(ageMatch[1]) : null,
    sex: 'unknown',
    pregnancy: /怀孕|孕期|孕妇/.test(text) ? true : null,
    chronicDiseases: [],
    currentMedications: [],
    unclearFields: ['heuristic_extraction'],
    userOriginalText: userMessage,
  }
}

function extractLikelyLocation(text: string): string {
  const locations = ['背部', '后背', '脸部', '脸上', '下巴', '脸颊', '额头', '胸口', '胸部', '腹部', '上腹', '下腹', '左眼', '右眼', '双眼', '喉咙', '嗓子']
  const match = locations.find((location) => text.includes(location))
  if (!match) return ''
  if (match === '后背') return '背部'
  if (match === '脸上') return '脸部'
  return match
}

function mergeWithHeuristic(
  llm: LlmSymptomExtractOutput,
  heuristic: SymptomExtractOutput,
  userMessage: string,
): SymptomExtractOutput {
  return {
    ...llm,
    chiefComplaint: llm.chiefComplaint || heuristic.chiefComplaint || userMessage,
    onsetTime: llm.onsetTime || heuristic.onsetTime,
    duration: llm.duration || heuristic.duration,
    location: llm.location || heuristic.location,
    severity: llm.severity || heuristic.severity,
    frequency: llm.frequency || heuristic.frequency,
    painQuality: llm.painQuality || heuristic.painQuality,
    onsetPattern: llm.onsetPattern || heuristic.onsetPattern,
    triggers: uniqueStrings([...llm.triggers, ...heuristic.triggers]),
    relievingFactors: uniqueStrings([...llm.relievingFactors, ...heuristic.relievingFactors]),
    associatedSymptoms: uniqueStrings([...llm.associatedSymptoms, ...heuristic.associatedSymptoms]),
    negativeSymptoms: uniqueStrings([...llm.negativeSymptoms, ...heuristic.negativeSymptoms]),
    progression: llm.progression === 'unknown' ? heuristic.progression : llm.progression,
    age: llm.age ?? heuristic.age,
    sex: llm.sex === 'unknown' ? heuristic.sex : llm.sex,
    pregnancy: llm.pregnancy ?? heuristic.pregnancy,
    chronicDiseases: uniqueStrings([...llm.chronicDiseases, ...heuristic.chronicDiseases]),
    currentMedications: uniqueStrings([...llm.currentMedications, ...heuristic.currentMedications]),
    unclearFields: uniqueStrings(llm.unclearFields.filter((field) => field !== 'heuristic_extraction')),
    userOriginalText: userMessage,
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function firstArrayItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => firstString(item)).filter(Boolean)
  }
  const item = firstString(value)
  return item ? [item] : []
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)))
}

function normalizeAge(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const match = value.match(/\d{1,3}/)
    if (match) return Number(match[0])
  }
  return null
}

function normalizeSex(value: string): LlmSymptomExtractOutput['sex'] {
  if (/男|male/i.test(value)) return 'male'
  if (/女|female/i.test(value)) return 'female'
  return 'unknown'
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalizeProgression(value: unknown): LlmSymptomExtractOutput['progression'] {
  return value === 'improving' || value === 'stable' || value === 'worsening' || value === 'unknown'
    ? value
    : 'unknown'
}
