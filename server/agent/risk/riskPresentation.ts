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

/**
 * 兜底替换：把遗漏进文案的内部风险码替换为用户可读表述。
 * 仅匹配独立出现的 R0-R3（后面不跟字母数字），避免误伤 URL 等内容。
 */
export function sanitizeInternalCodes(text: string): string {
  return text
    .replace(/[（(]\s*R([0-3])\s*[）)]/g, (_m, d: string) => `（${INLINE_LABELS[`R${d}`]}）`)
    .replace(/R([0-3])(?![0-9A-Za-z])/g, (_m, d: string) => INLINE_LABELS[`R${d}`])
}
