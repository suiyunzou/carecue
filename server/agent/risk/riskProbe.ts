// 风险核查工具 risk.probe — v3.0 设计文档 §11
// 职责：识别症状域必须确认的风险问题，判断红旗已确认 / 已否认 / 仍缺失，
// 决定是否先追问而不是直接判急症。

import { z } from 'zod'
import { defineTool } from '../tools/Tool.ts'
import type { CaseState, FollowupQuestion, RiskProbeState } from '../case/CaseState.ts'
import { getDomainConfig } from '../symptoms/symptomDomainConfig.ts'
import { extractTermsByDictionary } from '../symptoms/symptomNormalizer.ts'
import { SYMPTOM_DOMAINS } from '../symptoms/symptomDomain.ts'
import { fieldHasValue, humanizeFieldPath } from '../case/stateFields.ts'

const inputSchema = z.object({})

const followupQuestionSchema = z.object({
  question: z.string(),
  reason: z.string(),
  targetField: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  relatedHypothesis: z.string().optional(),
  relatedRiskRule: z.string().optional(),
  type: z.enum(['risk_probe', 'differential', 'care_plan']),
})

const outputSchema = z.object({
  symptomDomain: z.enum(SYMPTOM_DOMAINS),
  triggerTerms: z.array(z.string()),
  requiredQuestions: z.array(followupQuestionSchema),
  redFlagConfirmed: z.array(z.string()),
  redFlagDenied: z.array(z.string()),
  unresolvedRedFlags: z.array(z.string()),
  probeStatus: z.enum(['not_started', 'in_progress', 'completed']),
  canProceedToAnalysis: z.boolean(),
  reason: z.string(),
})

export const riskProbeTool = defineTool({
  name: 'risk.probe',
  description: '根据症状域加载风险核查问题，判断红旗确认/否认/缺失状态。',
  inputSchema,
  outputSchema,
  guardLevel: 'safe_read',
  timeoutMs: 5000,

  async call(_input, ctx) {
    return computeRiskProbe(ctx.state)
  },

  toStatePatch(output): Partial<CaseState> {
    return { riskProbe: output as RiskProbeState }
  },

  toTrace(output) {
    return {
      output: {
        probeStatus: output.probeStatus,
        confirmed: output.redFlagConfirmed,
        denied: output.redFlagDenied,
        unresolved: output.unresolvedRedFlags,
      },
      reason: output.reason,
    }
  },
})

export function computeRiskProbe(state: CaseState): RiskProbeState {
  const domain = state.symptomDomain.primaryDomain
  const config = getDomainConfig(domain)

  if (!config || domain === 'unknown') {
    return {
      symptomDomain: domain,
      triggerTerms: state.symptomDomain.triggerTerms,
      requiredQuestions: [],
      redFlagConfirmed: [],
      redFlagDenied: [],
      unresolvedRedFlags: [],
      probeStatus: 'completed',
      canProceedToAnalysis: true,
      reason: '未识别到具体症状域，按未覆盖域处理，仅输出阶段性整理和风险提示。',
    }
  }

  const allText = [
    ...(state.symptoms.associatedSymptoms ?? []),
    ...state.symptoms.userOriginalText,
  ].join('；')
  const negativeText = (state.symptoms.negativeSymptoms ?? []).join('；')

  const fromText = extractTermsByDictionary(allText, config.redFlagSignals)
  const explicitlyDenied = config.redFlagSignals.filter((signal) =>
    (state.symptoms.negativeSymptoms ?? []).some(
      (neg) => neg.includes(signal) || signal.includes(neg),
    ) || negativeText.includes(signal),
  )

  const redFlagConfirmed = Array.from(new Set(fromText.confirmed))
  const redFlagDenied = Array.from(new Set([...fromText.denied, ...explicitlyDenied]))
    .filter((signal) => !redFlagConfirmed.includes(signal))

  // 缺失的核心字段 -> 未确认的红旗问题
  const askedTexts = state.askedQuestions.map((q) => q.question)
  const missingCoreFields = config.requiredCoreFields.filter(
    (field) => !fieldHasValue(state, `symptoms.${field}`),
  )

  const pendingQuestions: FollowupQuestion[] = config.riskProbeQuestions.filter((question) => {
    const fieldName = question.targetField.replace(/^symptoms\./, '')
    const fieldMissing = !fieldHasValue(state, question.targetField)
    const isCoreMissing = missingCoreFields.includes(fieldName)
    const alreadyAsked = askedTexts.includes(question.question)
    return fieldMissing && (isCoreMissing || question.targetField === 'symptoms.associatedSymptoms') && !alreadyAsked
  })

  // 用户可读描述（内部字段名不允许出现在用户可见文案中）
  const unresolvedRedFlags = missingCoreFields.map((field) => `${humanizeFieldPath(`symptoms.${field}`)}未确认`)

  const hasUnaskedQuestions = pendingQuestions.length > 0
  const probeStatus: RiskProbeState['probeStatus'] =
    unresolvedRedFlags.length === 0
      ? 'completed'
      : hasUnaskedQuestions
        ? 'in_progress'
        : 'completed'

  const canProceedToAnalysis = unresolvedRedFlags.length === 0 || !hasUnaskedQuestions

  return {
    symptomDomain: domain,
    triggerTerms: state.symptomDomain.triggerTerms,
    requiredQuestions: pendingQuestions,
    redFlagConfirmed,
    redFlagDenied,
    unresolvedRedFlags,
    probeStatus,
    canProceedToAnalysis,
    reason:
      unresolvedRedFlags.length === 0
        ? '关键风险信息已覆盖，可进入疾病方向分析。'
        : hasUnaskedQuestions
          ? `仍有未确认的关键信息：${unresolvedRedFlags.join('、')}，需要先核查。`
          : '关键信息仍缺失但相关问题已问过，按现有信息继续，并在输出中说明不确定风险。',
  }
}
