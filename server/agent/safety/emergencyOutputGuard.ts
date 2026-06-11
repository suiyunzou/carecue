// 急症输出守卫 + 急症响应器 — v3.0 设计文档 §30
// R3 输出结构：风险判断 / 触发组合 / 为什么停止线上判断 / 现在做什么 / 不要做什么 / 医生摘要。

import type { CaseState } from '../case/CaseState.ts'
import type { EmergencyResponse } from '../agentResponse.ts'
import { reportRenderer } from '../report/reportRenderer.ts'
import { buildDoctorSummary } from '../report/reportGenerator.ts'
import { findMedicationViolations } from '../analysis/medicationBoundaryAnalyzer.ts'
import { getRulesByIds } from '../risk/redFlagRules.ts'
import type { TraceLogger } from '../logs/traceLogger.ts'

export interface EmergencyGuardResult {
  passed: boolean
  issues: string[]
}

export const emergencyOutputGuard = {
  validate(content: string): EmergencyGuardResult {
    const issues: string[] = []

    if (!/急诊|急救|120/.test(content)) {
      issues.push('急症输出必须明确建议急诊或急救。')
    }
    if (/继续观察|在家观察|先观察/.test(content)) {
      issues.push('急症输出不允许建议继续观察。')
    }
    if (findMedicationViolations(content).some((v) => v.type === 'dosage' || v.type === 'course')) {
      issues.push('急症输出不允许包含用药剂量建议。')
    }
    if (content.length > 1200) {
      issues.push('急症输出应简短直接，不长篇解释。')
    }

    return { passed: issues.length === 0, issues }
  },
}

export class EmergencyResponder {
  constructor(private traceLogger: TraceLogger) {}

  async respond(state: CaseState): Promise<EmergencyResponse> {
    const matchedRules = getRulesByIds(state.risk.matchedRules)
    const triggeredCombination =
      state.risk.redFlags.length > 0
        ? state.risk.redFlags
        : matchedRules.map((r) => r.doctorSummaryHint)

    const userMessages = Array.from(new Set(matchedRules.map((r) => r.userMessage)))
    const doctorSummary = buildDoctorSummary(state)

    const content = [
      '【当前风险判断】',
      '根据你描述的症状组合，目前存在需要立即线下处理的急症风险。',
      '',
      '【触发风险的症状组合】',
      triggeredCombination.length > 0 ? triggeredCombination.map((t) => `- ${t}`).join('\n') : `- ${state.risk.reason}`,
      '',
      '【为什么不能继续线上判断】',
      '这类症状组合需要现场检查（如心电图、查体、影像）才能判断，线上分析可能延误处理。',
      '',
      '【现在应该做什么】',
      userMessages.length > 0 ? userMessages.map((m) => `- ${m}`).join('\n') : '- 建议立即前往急诊或拨打 120。',
      '- 尽量由家人陪同，不要独自驾车前往。',
      '',
      '【当前不要做什么】',
      '- 不要等待症状自行缓解再决定。',
      '- 不要剧烈活动。',
      '- 不要自行服药压制症状后继续硬扛。',
      '',
      '【给医生看的简短摘要】',
      doctorSummary,
    ].join('\n')

    const guardResult = emergencyOutputGuard.validate(content)
    this.traceLogger.log(state.caseId, 'emergency_guard', {
      output: guardResult,
      reason: guardResult.passed ? '急症输出复核通过' : `急症输出复核问题：${guardResult.issues.join('；')}`,
    })

    this.traceLogger.log(state.caseId, 'final_output', { reason: 'emergency', output: { riskLevel: 'R3' } })
    return reportRenderer.renderEmergency(state, content, doctorSummary)
  }
}
