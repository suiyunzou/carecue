// 通用工具守卫 — v3.0 设计文档 §16.4
// 医学安全边界在工具调用前置检查。

import type { CaseState } from '../case/CaseState.ts'
import type { ToolGuardResult } from './Tool.ts'

/** R3 急症状态下禁止普通医学推理 / 处理建议类工具 */
export function blockWhenEmergency(state: CaseState): ToolGuardResult {
  if (state.risk.level === 'R3') {
    return {
      allowed: false,
      reason: '已确认 R3 急症风险，必须 emergency_stop，不允许继续普通分析。',
      failureCode: 'INVALID_ACTION',
    }
  }
  return { allowed: true }
}

/** 没有任何症状信息时禁止分析 / 搜索 */
export function requireSymptoms(state: CaseState): ToolGuardResult {
  if (!state.symptoms.chiefComplaint && state.symptoms.userOriginalText.length === 0) {
    return {
      allowed: false,
      reason: '当前没有任何症状信息，不能执行该工具。',
      failureCode: 'TOOL_INPUT_INVALID',
    }
  }
  return { allowed: true }
}

/** 生成 carePlan 前必须已有疑似方向和证据（§8.3 generate_care_plan 禁止条件） */
export function requireHypothesesAndEvidence(state: CaseState): ToolGuardResult {
  const emergency = blockWhenEmergency(state)
  if (!emergency.allowed) return emergency

  if (state.hypotheses.length === 0) {
    return {
      allowed: false,
      reason: '缺少疑似疾病方向，不能生成处理建议。',
      failureCode: 'CARE_PLAN_GUARD_FAILED',
    }
  }
  if (state.evidence.length === 0) {
    return {
      allowed: false,
      reason: '缺少医学证据，不能生成处理建议。',
      failureCode: 'CARE_PLAN_GUARD_FAILED',
    }
  }
  return { allowed: true }
}
