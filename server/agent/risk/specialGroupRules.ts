// 特殊人群规则 — v3.0 设计文档 §4.2 / §13.2
// 特殊人群不直接判急症，但会提升基础风险等级（R0 -> R1）。

import type { CaseState, SpecialGroup } from '../case/CaseState.ts'
import type { RiskLevel } from './riskLevel.ts'
import { maxRiskLevel } from './riskLevel.ts'

export function deriveSpecialGroups(state: CaseState): SpecialGroup[] {
  const groups = new Set<SpecialGroup>(state.userProfile.specialGroups ?? [])
  const { age, pregnancy, chronicDiseases } = state.userProfile

  if (age !== undefined) {
    if (age < 12) groups.add('child')
    if (age >= 65) groups.add('elderly')
  }
  if (pregnancy) groups.add('pregnant')
  if (chronicDiseases && chronicDiseases.length > 0) groups.add('chronic_disease')

  return Array.from(groups)
}

/**
 * 特殊人群升级：有症状的特殊人群基础风险至少 R1。
 * 不允许因为用户年轻而降级（§10.2）。
 */
const SPECIAL_GROUP_LABELS: Record<SpecialGroup, string> = {
  child: '儿童',
  elderly: '老年人',
  pregnant: '孕期',
  immunocompromised: '免疫力低下人群',
  chronic_disease: '有慢性病史',
}

export function applySpecialGroupAdjustment(
  level: RiskLevel,
  state: CaseState,
): { level: RiskLevel; note?: string } {
  const groups = deriveSpecialGroups(state)
  if (groups.length === 0) return { level }

  const hasSymptoms = Boolean(state.symptoms.chiefComplaint)
  if (!hasSymptoms) return { level }

  if (level === 'R0') {
    return {
      level: maxRiskLevel(level, 'R1'),
      note: `特殊人群（${groups.map((g) => SPECIAL_GROUP_LABELS[g] ?? g).join('、')}）出现不适，建议不要长期拖延，至少门诊评估。`,
    }
  }
  return { level }
}
