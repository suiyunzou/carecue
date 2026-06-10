// 证据校验 — v3.0 设计文档 §22.1
// 必须保留来源 URL；不能抽取具体剂量作为用户建议。

import type { MedicalEvidence } from './evidenceSchema.ts'
import { containsDosageInstruction } from '../analysis/medicationBoundaryAnalyzer.ts'

export interface EvidenceValidationResult {
  valid: MedicalEvidence[]
  dropped: Array<{ sourceUrl: string; reason: string }>
}

export const evidenceValidator = {
  validate(items: MedicalEvidence[]): EvidenceValidationResult {
    const valid: MedicalEvidence[] = []
    const dropped: Array<{ sourceUrl: string; reason: string }> = []

    for (const item of items) {
      if (!item.sourceUrl || !/^https?:\/\//.test(item.sourceUrl)) {
        dropped.push({ sourceUrl: item.sourceUrl, reason: '来源 URL 缺失或非法。' })
        continue
      }
      if (!item.summary || item.summary.trim().length < 10) {
        dropped.push({ sourceUrl: item.sourceUrl, reason: '证据摘要为空或过短。' })
        continue
      }

      // 用药边界类内容剔除具体剂量表述（保留成分方向）
      const facts = { ...item.extractedFacts }
      if (facts.medicationBoundary) {
        facts.medicationBoundary = facts.medicationBoundary.filter(
          (line) => !containsDosageInstruction(line),
        )
      }
      if (facts.otcIngredients) {
        facts.otcIngredients = facts.otcIngredients.filter(
          (line) => !containsDosageInstruction(line),
        )
      }

      valid.push({ ...item, extractedFacts: facts })
    }

    return { valid, dropped }
  },
}
