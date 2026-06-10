// 风险等级 — v3.0 设计文档 §10.1
//
// R0：暂无明显红旗信号，可继续分析，可给观察和日常处理建议。
// R1：非急症，但建议门诊评估，不应长期拖延。
// R2：存在疑似高危或关键红旗信息未确认，需要优先追问或尽快线下评估。
// R3：明确急症风险，建议急诊或急救，不继续普通线上分析。

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3'

const RISK_ORDER: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3 }

export function riskRank(level: RiskLevel): number {
  return RISK_ORDER[level]
}

export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b
}
