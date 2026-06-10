// 证据聚合 — v3.0 设计文档 §23
// 同 URL 去重、同域名保留最高可信、同方向最多 3 条、A > B > C、冲突标记。

import type { MedicalEvidence } from './evidenceSchema.ts'
import { AGENT_LIMITS } from '../agentLimits.ts'

export interface EvidenceAggregatorOutput {
  evidence: MedicalEvidence[]
  droppedEvidence: Array<{ sourceUrl: string; reason: string }>
}

const MAX_PER_HYPOTHESIS = 3

export const evidenceAggregator = {
  merge(items: MedicalEvidence[]): EvidenceAggregatorOutput {
    const dropped: Array<{ sourceUrl: string; reason: string }> = []

    // 1. 同一 URL 只保留一条
    const byUrl = new Map<string, MedicalEvidence>()
    for (const item of items) {
      if (!byUrl.has(item.sourceUrl)) {
        byUrl.set(item.sourceUrl, item)
      } else {
        dropped.push({ sourceUrl: item.sourceUrl, reason: '重复 URL。' })
      }
    }

    // 2. 按可信度排序：A > B > C
    const sorted = Array.from(byUrl.values()).sort(
      (a, b) => credibilityRank(b.credibility) - credibilityRank(a.credibility),
    )

    // 3. 同一疾病方向最多 3 条
    const perHypothesisCount = new Map<string, number>()
    const result: MedicalEvidence[] = []

    for (const item of sorted) {
      const hypotheses = item.relatedHypotheses.length > 0 ? item.relatedHypotheses : ['_general']
      const overLimit = hypotheses.every(
        (h) => (perHypothesisCount.get(h) ?? 0) >= MAX_PER_HYPOTHESIS,
      )
      if (overLimit) {
        dropped.push({ sourceUrl: item.sourceUrl, reason: '该疾病方向证据已达上限。' })
        continue
      }
      for (const h of hypotheses) {
        perHypothesisCount.set(h, (perHypothesisCount.get(h) ?? 0) + 1)
      }
      result.push(item)
      if (result.length >= AGENT_LIMITS.maxEvidenceItems) break
    }

    // 4. 冲突标记：同一方向下红旗/就医建议明显互斥时打 conflict
    markConflicts(result)

    return { evidence: result, droppedEvidence: dropped }
  },
}

function markConflicts(items: MedicalEvidence[]) {
  const byHypothesis = new Map<string, MedicalEvidence[]>()
  for (const item of items) {
    for (const h of item.relatedHypotheses) {
      const list = byHypothesis.get(h) ?? []
      list.push(item)
      byHypothesis.set(h, list)
    }
  }

  for (const list of byHypothesis.values()) {
    if (list.length < 2) continue
    const hasSelfCare = list.some((e) => (e.extractedFacts.selfCareAdvice ?? []).length > 0)
    const hasUrgent = list.some((e) =>
      (e.extractedFacts.whenToSeekCare ?? []).some((line) => /立即|急诊|马上/.test(line)),
    )
    if (hasSelfCare && hasUrgent) {
      for (const e of list) e.conflict = true
    }
  }
}

function credibilityRank(level: 'A' | 'B' | 'C'): number {
  return { A: 3, B: 2, C: 1 }[level]
}
