// 风险等级用户侧展示 — 内部码（R0-R3）不允许出现在任何用户可见文案中。
// 业务原因：用户看不懂内部等级；内部分级口径也不应暴露给外部。
// 所有用户可见的渲染出口（报告/阶段整理/急症输出/状态快照）统一经过本模块。

import type { RiskLevel } from './riskLevel.ts'

export const RISK_LEVEL_USER_LABELS: Record<RiskLevel, string> = {
  R0: '未见明显危险信号',
  R1: '低风险，可先观察',
  R2: '建议尽快就医评估',
  R3: '急症风险，建议立即就医',
}

export function riskLevelLabel(level: RiskLevel): string {
  return RISK_LEVEL_USER_LABELS[level]
}

/** 短标签（嵌入句子时使用） */
const INLINE_LABELS: Record<string, string> = {
  R0: '未见明显危险信号',
  R1: '低风险',
  R2: '需尽快就医评估',
  R3: '急症风险',
}

export const SYMPTOM_DOMAIN_USER_LABELS: Record<string, string> = {
  throat_respiratory: '咽喉与呼吸不适',
  gastrointestinal: '胃肠不适',
  eye_discomfort: '眼部不适',
  skin_mild: '皮肤轻微问题',
  chest_pain: '胸痛胸闷',
  headache: '头晕头痛',
  limb_pain: '肢体疼痛',
  fever: '发热相关',
  general_discomfort: '全身不适',
  unknown: '症状咨询',
}

const FIELD_PATH_USER_LABELS: Record<string, string> = {
  'symptoms.chiefComplaint': '主要不适',
  'symptoms.onsetTime': '出现时间',
  'symptoms.duration': '持续时间',
  'symptoms.location': '具体部位',
  'symptoms.severity': '不适程度',
  'symptoms.frequency': '发作频率',
  'symptoms.painQuality': '疼痛性质',
  'symptoms.onsetPattern': '发作方式',
  'symptoms.triggers': '诱因',
  'symptoms.relievingFactors': '缓解方式',
  'symptoms.associatedSymptoms': '伴随症状',
  'symptoms.negativeSymptoms': '已排除的症状',
  'symptoms.progression': '变化趋势',
  'userProfile.age': '年龄',
  'userProfile.sex': '性别',
  'userProfile.pregnancy': '是否怀孕',
  'userProfile.chronicDiseases': '既往慢性病',
  'userProfile.currentMedications': '当前用药',
  'userProfile.allergies': '过敏史',
}

const LIKELIHOOD_USER_LABELS: Record<string, string> = {
  more_likely: '更像',
  possible: '也可能',
  less_likely: '暂不太支持',
  must_rule_out: '需优先排除',
}

const FAILURE_CODE_USER_LABELS: Record<string, string> = {
  INVALID_ACTION: '系统暂时无法完成完整分析，已先做阶段性整理。',
  TOOL_INPUT_INVALID: '系统暂时无法完成完整分析，已先做阶段性整理。',
  TOOL_OUTPUT_INVALID: '系统暂时无法完成完整分析，已先做阶段性整理。',
  TOOL_RUNTIME_ERROR: '系统暂时无法完成完整分析，已先做阶段性整理。',
  GUARD_BLOCKED: '当前信息还不足，已先做阶段性整理。',
  MAX_STEP_REACHED: '当前信息较多，已先做阶段性整理。',
  SEARCH_NO_RESULT: '本次未获取到可用权威资料，已根据现有信息整理。',
  SEARCH_ALL_REJECTED: '本次未获取到可用权威资料，已根据现有信息整理。',
  EVIDENCE_CONFLICT: '资料之间存在不一致，建议以线下医生判断为准。',
  CARE_PLAN_GUARD_FAILED: '日常建议需要进一步确认，已先做阶段性整理。',
  FINAL_GUARD_FAILED: '完整报告需要更多信息确认，已先做阶段性整理。',
}

/**
 * 兜底替换：把遗漏进文案的内部风险码替换为用户可读表述。
 * 仅匹配独立出现的 R0-R3（后面不跟字母数字），避免误伤 URL 等内容。
 */
export function sanitizeInternalCodes(text: string): string {
  return text
    .replace(/[（(]\s*R([0-3])\s*[）)]/g, (_m, d: string) => `（${INLINE_LABELS[`R${d}`]}）`)
    .replace(/R([0-3])(?![0-9A-Za-z])/g, (_m, d: string) => INLINE_LABELS[`R${d}`])
}

/** 用户可见文本统一清洗：风险码、症状域、字段路径、错误码、倾向枚举均不可外露。 */
export function sanitizeUserVisibleText(text: string): string {
  let output = sanitizeInternalCodes(text)

  for (const [code, label] of Object.entries(FIELD_PATH_USER_LABELS)) {
    output = output.replaceAll(code, label)
  }
  for (const [code, label] of Object.entries(SYMPTOM_DOMAIN_USER_LABELS)) {
    output = output.replace(new RegExp(`\\b${code}\\b`, 'g'), label)
  }
  for (const [code, label] of Object.entries(LIKELIHOOD_USER_LABELS)) {
    output = output.replace(new RegExp(`\\b${code}\\b`, 'g'), label)
  }
  for (const [code, label] of Object.entries(FAILURE_CODE_USER_LABELS)) {
    output = output.replace(new RegExp(`\\b${code}\\b`, 'g'), label)
  }

  return output
    .replace(/AI 分析暂不可用/g, '目前依据已提供信息做阶段性整理')
    .replace(/本方向仅为该症状域常见参考/g, '该方向仅为同类症状的常见参考')
    .replace(/症状域\s+([^，。；\s]+)\s+的常见方向之一/g, '$1的常见方向之一')
}
