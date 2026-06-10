// 最终报告安全复核 — v3.0 设计文档 §28
// 17 项检查：确诊化、缺方向、缺分级、缺依据、缺建议、缺用药边界、处方化、
// D 级来源、确定化、高危继续观察、缺医生摘要、泛化建议、未经验证归因等。

import type { CaseState } from '../case/CaseState.ts'
import type { FinalReport } from '../report/reportSchema.ts'
import { findCertaintyIssues } from './certaintyGuard.ts'
import { findMedicationViolations } from '../analysis/medicationBoundaryAnalyzer.ts'
import type { SafetyIssue } from './medicationBoundaryGuard.ts'

export interface FinalAnswerGuardResult {
  passed: boolean
  issues: SafetyIssue[]
  fixedReport?: FinalReport
}

export const finalAnswerGuard = {
  async validate(input: { state: CaseState; draftReport: FinalReport }): Promise<FinalAnswerGuardResult> {
    const { state, draftReport } = input
    const issues: SafetyIssue[] = []
    const fixed: FinalReport = structuredClone(draftReport)
    let modified = false

    const fullText = JSON.stringify(draftReport)

    // 1 / 12 / 16 / 17. 确定性表述（确诊化、绝对化、淡化、未经验证归因）
    for (const issue of findCertaintyIssues(fullText)) {
      issues.push({
        code: `CERTAINTY_${issue.type.toUpperCase()}`,
        message: `${issue.text} —— ${issue.suggestion}`,
        location: 'report',
      })
    }

    // 2. 缺少疑似疾病方向
    if (fixed.hypotheses.length === 0) {
      issues.push({ code: 'MISSING_HYPOTHESES', message: '报告缺少疑似疾病方向。', location: 'hypotheses' })
    }

    // 3. 缺少风险分级
    if (!fixed.riskReason || fixed.riskReason.trim().length < 5) {
      issues.push({ code: 'MISSING_RISK_REASON', message: '报告缺少风险分级理由。', location: 'riskReason' })
    }

    // 4 / 5. 每个方向必须有支持依据，且有反对依据或不确定点
    for (const h of fixed.hypotheses) {
      if (h.supportEvidence.length === 0) {
        issues.push({ code: 'HYPOTHESIS_NO_SUPPORT', message: `方向「${h.name}」缺少支持依据。`, location: `hypotheses.${h.name}` })
      }
      if (h.againstEvidence.length === 0 && h.uncertainties.length === 0) {
        h.uncertainties = ['当前信息不足以排除其他方向，需要医生面诊确认。']
        modified = true
      }
    }

    // 6. 缺少日常处理建议
    if (fixed.selfCareAdvice.length === 0) {
      issues.push({ code: 'MISSING_SELF_CARE', message: '报告缺少日常处理建议。', location: 'selfCareAdvice' })
    }

    // 7. 缺少成分级用药边界（完整支持域才强制要求）
    if (
      state.symptomDomain.supportedDepth === 'full' &&
      fixed.otcIngredientOptions.length === 0 &&
      state.carePlan &&
      state.carePlan.otcIngredientOptions.length > 0
    ) {
      fixed.otcIngredientOptions = state.carePlan.otcIngredientOptions.map((o) => ({
        ingredientCategory: o.ingredientCategory,
        suitableFor: o.suitableFor,
        caution: o.caution,
      }))
      modified = true
    }

    // 8 / 9. 处方化用药表述
    const medViolations = findMedicationViolations(fullText)
    for (const violation of medViolations) {
      issues.push({
        code: `MEDICATION_${violation.type.toUpperCase()}`,
        message: `报告包含越界用药表述：${violation.text}`,
        location: 'report',
      })
    }

    // 10. 遗漏红旗提示：未确认的红旗必须出现在升级就医条件中
    if (state.riskProbe.unresolvedRedFlags.length > 0 && fixed.seekCareWhen.length === 0) {
      issues.push({ code: 'MISSING_RED_FLAG_ESCALATION', message: '存在未确认红旗，但报告没有升级就医条件。', location: 'seekCareWhen' })
    }

    // 11. D 级来源检查：references 必须来自 evidence
    const knownUrls = new Set(state.evidence.map((e) => e.sourceUrl))
    const badRefs = fixed.references.filter((r) => !knownUrls.has(r.url))
    if (badRefs.length > 0) {
      fixed.references = fixed.references.filter((r) => knownUrls.has(r.url))
      modified = true
      issues.push({
        code: 'UNKNOWN_REFERENCE',
        message: `报告引用了证据之外的来源（已移除）：${badRefs.map((r) => r.url).join('、')}`,
        location: 'references',
      })
    }

    // 13. 高危情况建议继续观察
    if ((state.risk.level === 'R2' || state.risk.level === 'R3') && /继续观察|在家观察|放心观察/.test(fullText)) {
      issues.push({ code: 'OBSERVE_ON_HIGH_RISK', message: '高风险等级下不允许建议继续观察。', location: 'report' })
    }

    // 14. 缺少医生沟通摘要
    if (!fixed.doctorSummary || fixed.doctorSummary.trim().length < 10) {
      issues.push({ code: 'MISSING_DOCTOR_SUMMARY', message: '报告缺少医生沟通摘要。', location: 'doctorSummary' })
    }

    // 15. 只有泛化就医建议
    const allAdvice = [...fixed.selfCareAdvice, ...fixed.seekCareWhen].join('')
    if (
      fixed.selfCareAdvice.length > 0 &&
      /^(建议)?(及时|尽快)?(就医|看医生|遵医嘱)[。!！]?$/.test(allAdvice.trim())
    ) {
      issues.push({ code: 'GENERIC_ADVICE_ONLY', message: '报告只有泛化就医建议，缺少可执行内容。', location: 'selfCareAdvice' })
    }

    // 风险等级与状态一致性
    if (fixed.riskLevel !== state.risk.level) {
      fixed.riskLevel = state.risk.level
      modified = true
    }

    // 可自动修复项不算 fail；存在结构性/表述性硬违规才 fail
    const fatalCodes = [
      'CERTAINTY_DIAGNOSIS',
      'CERTAINTY_ABSOLUTE',
      'CERTAINTY_DISMISSIVE',
      'CERTAINTY_UNVERIFIED_ATTRIBUTION',
      'MISSING_HYPOTHESES',
      'MISSING_RISK_REASON',
      'HYPOTHESIS_NO_SUPPORT',
      'MISSING_SELF_CARE',
      'MEDICATION_DOSAGE',
      'MEDICATION_COURSE',
      'MEDICATION_STOP_MEDICATION',
      'MEDICATION_INCREASE_MEDICATION',
      'MEDICATION_EFFICACY_PROMISE',
      'MEDICATION_PRESCRIPTION_STYLE',
      'MEDICATION_DISCOURAGE_CARE',
      'OBSERVE_ON_HIGH_RISK',
      'MISSING_DOCTOR_SUMMARY',
      'GENERIC_ADVICE_ONLY',
      'MISSING_RED_FLAG_ESCALATION',
    ]
    const passed = !issues.some((issue) => fatalCodes.includes(issue.code))

    return {
      passed,
      issues,
      fixedReport: modified ? fixed : undefined,
    }
  },
}
