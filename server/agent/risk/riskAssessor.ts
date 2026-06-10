// 风险评估工具 risk.red_flag_assess — v3.0 设计文档 §10 / §12 / §14
// 规则：R3 不允许自动降级；R2 在关键红旗被否认后可降级，且必须记录被否认条件。

import { z } from 'zod'
import { defineTool } from '../tools/Tool.ts'
import type { CaseState, RiskState } from '../case/CaseState.ts'
import type { RiskLevel } from './riskLevel.ts'
import { riskRank } from './riskLevel.ts'
import { getRulesForDomain } from './redFlagRules.ts'
import { evaluateRules, type RuleMatchResult } from './redFlagRuleEngine.ts'
import { applySpecialGroupAdjustment } from './specialGroupRules.ts'

const inputSchema = z.object({})

const outputSchema = z.object({
  level: z.enum(['R0', 'R1', 'R2', 'R3']),
  redFlags: z.array(z.string()),
  matchedRules: z.array(z.string()),
  deniedRules: z.array(z.string()),
  reason: z.string(),
  shouldStopOnlineConsultation: z.boolean(),
  assessedAt: z.string(),
  unresolvedCriticalQuestions: z.array(z.string()),
})

export type RiskAssessOutput = z.infer<typeof outputSchema>

export const riskAssessTool = defineTool({
  name: 'risk.red_flag_assess',
  description: '代码执行红旗组合规则，输出风险分级。红旗词只触发核查，红旗组合才触发高风险。',
  inputSchema,
  outputSchema,
  guardLevel: 'safe_read',
  timeoutMs: 5000,

  async call(_input, ctx) {
    return assessRisk(ctx.state)
  },

  toStatePatch(output): Partial<CaseState> {
    const risk: RiskState = {
      level: output.level,
      redFlags: output.redFlags,
      matchedRules: output.matchedRules,
      reason: output.reason,
      shouldStopOnlineConsultation: output.shouldStopOnlineConsultation,
      assessedAt: output.assessedAt,
      unresolvedCriticalQuestions: output.unresolvedCriticalQuestions,
    }
    return {
      risk,
      status: output.level === 'R3' ? 'emergency' : undefined,
    } as Partial<CaseState>
  },

  toTrace(output) {
    return {
      output: {
        level: output.level,
        matchedRules: output.matchedRules,
        deniedRules: output.deniedRules,
      },
      reason: output.reason,
    }
  },
})

export function assessRisk(state: CaseState): RiskAssessOutput {
  const domains = [state.symptomDomain.primaryDomain, ...state.symptomDomain.secondaryDomains]
  const results: RuleMatchResult[] = domains.flatMap((domain) =>
    evaluateRules(getRulesForDomain(domain), state),
  )

  const matched = results.filter((r) => r.matched)
  const matchedR3 = matched.filter((r) => r.rule.level === 'R3')
  const matchedR2 = matched.filter((r) => r.rule.level === 'R2')

  // 已被否认的红旗使 R2 缺信息规则失效：如果规则关注的红旗被用户否认，规则不再视为命中
  const deniedSignals = state.riskProbe.redFlagDenied

  let computedLevel: RiskLevel
  let reasonParts: string[] = []

  const confirmedSignals = state.riskProbe.redFlagConfirmed
  const unresolvedSignals = state.riskProbe.unresolvedRedFlags

  if (matchedR3.length > 0) {
    computedLevel = 'R3'
    reasonParts = matchedR3.map((r) => r.rule.reason)
  } else if (matchedR2.length > 0) {
    computedLevel = 'R2'
    reasonParts = matchedR2.map((r) => r.rule.reason)
  } else {
    // 无红旗组合命中：R0/R1 基础判断，按三层表述（已命中 / 疑似（已确认警示信号）/ 待确认）
    if (confirmedSignals.length > 0) {
      // 已出现单个警示信号（如放射痛）：不构成急症组合，但不能说“未命中红旗”，至少 R1
      computedLevel = 'R1'
      reasonParts = [
        `整体暂不符合急症组合，但已出现需要警惕的信号（${confirmedSignals.join('、')}）。若反复发作、活动后诱发、持续超过10分钟，或伴出汗、恶心、气短、头晕，应立即急诊。`,
      ]
    } else if (state.symptoms.progression === 'worsening') {
      computedLevel = 'R1'
      reasonParts = ['症状呈加重趋势，建议门诊评估，不建议长期拖延。']
    } else {
      computedLevel = 'R0'
      reasonParts = ['当前未命中红旗组合，可继续分析并给出观察和日常处理建议。']
    }
    if (unresolvedSignals.length > 0) {
      reasonParts.push(`仍有待确认的关键信息：${unresolvedSignals.join('、')}。`)
    }
    const adjusted = applySpecialGroupAdjustment(computedLevel, state)
    computedLevel = adjusted.level
    if (adjusted.note) reasonParts.push(adjusted.note)
  }

  // 降级控制（§14）：R3 不允许自动降级；R2 只有在红旗被明确否认后才允许降
  const previousLevel = state.risk.level
  let finalLevel = computedLevel
  if (previousLevel === 'R3') {
    finalLevel = 'R3'
    reasonParts.push('既往已确认 R3，不允许自动降级。')
  } else if (riskRank(previousLevel) > riskRank(computedLevel)) {
    if (previousLevel === 'R2' && deniedSignals.length > 0) {
      reasonParts.push(`关键红旗已被否认（${deniedSignals.join('、')}），风险由 R2 调整为 ${computedLevel}。若再次出现这些信号需升级处理。`)
    } else if (previousLevel === 'R2' && state.riskProbe.unresolvedRedFlags.length > 0) {
      finalLevel = previousLevel
      reasonParts.push('关键红旗仍未确认，维持 R2。')
    }
  }

  const redFlags = Array.from(
    new Set([...state.riskProbe.redFlagConfirmed, ...matched.flatMap((r) => [r.rule.doctorSummaryHint])]),
  )

  return {
    level: finalLevel,
    redFlags,
    matchedRules: matched.map((r) => r.rule.id),
    deniedRules: deniedSignals,
    reason: reasonParts.join(' '),
    shouldStopOnlineConsultation: finalLevel === 'R3',
    assessedAt: new Date().toISOString(),
    unresolvedCriticalQuestions: state.riskProbe.unresolvedRedFlags,
  }
}
