// CaseState 合并规则 — v3.0 设计文档 §14
// 1. 不覆盖已有明确字段，除非新信息更具体
// 2. 保留用户否认症状 / 原始表达 / 时间线
// 7. 风险层级不能被 LLM 随意降级（由 riskAssessor 控制，这里只接受 system/tool 来源）
// 8. evidence 追加前必须去重
// 9. hypotheses 每次 analyze_case 后整体重算
// 10. askedQuestions 只追加，不删除

import type { CaseState, FollowupQuestion } from './CaseState.ts'
import type { MedicalEvidence } from '../evidence/evidenceSchema.ts'

export interface MergeResult {
  state: CaseState
  changedFields: string[]
}

export function mergeCaseState(
  current: CaseState,
  patch: Partial<CaseState>,
  source: 'user' | 'llm' | 'tool' | 'system',
): MergeResult {
  const changedFields: string[] = []
  const next: CaseState = structuredClone(current)

  if (patch.symptoms) {
    const merged = mergeSymptoms(next, patch.symptoms, changedFields)
    next.symptoms = merged
  }

  if (patch.userProfile) {
    for (const [key, value] of Object.entries(patch.userProfile)) {
      if (value === undefined || value === null) continue
      // 年龄合法性校验：防止把"5分钟"之类的时长误当年龄写入
      if (key === 'age' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 120)) {
        continue
      }
      const existing = (next.userProfile as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        const existingArray = Array.isArray(existing) ? existing : []
        const union = Array.from(new Set([...existingArray, ...value]))
        if (union.length !== existingArray.length) {
          ;(next.userProfile as Record<string, unknown>)[key] = union
          changedFields.push(`userProfile.${key}`)
        }
      } else if (existing !== value) {
        // 用户画像标量字段（年龄/性别等）：用户后补充或更正的明确信息必须能覆盖旧值
        ;(next.userProfile as Record<string, unknown>)[key] = value
        changedFields.push(`userProfile.${key}`)
      }
    }
  }

  if (patch.symptomDomain) {
    next.symptomDomain = patch.symptomDomain
    changedFields.push('symptomDomain')
  }

  if (patch.riskProbe) {
    next.riskProbe = patch.riskProbe
    changedFields.push('riskProbe')
  }

  if (patch.risk) {
    // 风险只接受系统/工具评估结果，LLM 不允许直接改风险
    if (source === 'system' || source === 'tool') {
      next.risk = patch.risk
      changedFields.push('risk')
    }
  }

  if (patch.hypotheses) {
    next.hypotheses = patch.hypotheses
    changedFields.push('hypotheses')
  }

  if (patch.carePlan) {
    next.carePlan = patch.carePlan
    changedFields.push('carePlan')
  }

  if (patch.evidence) {
    next.evidence = dedupeEvidence([...next.evidence, ...patch.evidence])
    changedFields.push('evidence')
  }

  if (patch.searchTrace) {
    next.searchTrace = [...(next.searchTrace ?? []), ...patch.searchTrace]
    changedFields.push('searchTrace')
  }

  if (patch.missingInfo) {
    next.missingInfo = patch.missingInfo
    changedFields.push('missingInfo')
  }

  if (patch.askedQuestions) {
    next.askedQuestions = appendQuestions(next.askedQuestions, patch.askedQuestions)
    changedFields.push('askedQuestions')
  }

  if (patch.decisionHistory) {
    next.decisionHistory = [...next.decisionHistory, ...patch.decisionHistory]
    changedFields.push('decisionHistory')
  }

  if (patch.status) {
    next.status = patch.status
    changedFields.push('status')
  }

  if (patch.meta) {
    next.meta = { ...next.meta, ...patch.meta }
    changedFields.push('meta')
  }

  next.meta.updatedAt = new Date().toISOString()
  return { state: next, changedFields }
}

function mergeSymptoms(
  state: CaseState,
  patch: Partial<CaseState['symptoms']>,
  changedFields: string[],
): CaseState['symptoms'] {
  const current = state.symptoms
  const merged = { ...current }

  const scalarFields = [
    'chiefComplaint',
    'onsetTime',
    'duration',
    'location',
    'severity',
    'frequency',
    'painQuality',
    'onsetPattern',
  ] as const

  for (const field of scalarFields) {
    const incoming = patch[field]
    if (typeof incoming !== 'string' || incoming.trim() === '') continue
    const existing = merged[field]
    // 不覆盖已有明确字段，除非新信息更具体（更长视为更具体）
    if (!existing || incoming.length > existing.length) {
      merged[field] = incoming
      changedFields.push(`symptoms.${field}`)
    }
  }

  const arrayFields = [
    'triggers',
    'relievingFactors',
    'associatedSymptoms',
    'negativeSymptoms',
    'userOriginalText',
  ] as const

  for (const field of arrayFields) {
    const incoming = patch[field]
    if (!Array.isArray(incoming) || incoming.length === 0) continue
    const existing = merged[field] ?? []
    const union = Array.from(new Set([...existing, ...incoming.filter(Boolean)]))
    if (union.length !== existing.length) {
      merged[field] = union
      changedFields.push(`symptoms.${field}`)
    }
  }

  // 被新确认的症状不再保留在否认列表中
  if (merged.negativeSymptoms && merged.associatedSymptoms) {
    const incomingConfirmed = new Set(patch.associatedSymptoms ?? [])
    merged.negativeSymptoms = merged.negativeSymptoms.filter((neg) => !incomingConfirmed.has(neg))
  }

  if (patch.progression && patch.progression !== 'unknown' && patch.progression !== merged.progression) {
    merged.progression = patch.progression
    changedFields.push('symptoms.progression')
  }

  return merged
}

function dedupeEvidence(items: MedicalEvidence[]): MedicalEvidence[] {
  const seen = new Map<string, MedicalEvidence>()
  for (const item of items) {
    const existing = seen.get(item.sourceUrl)
    if (!existing || credibilityRank(item.credibility) > credibilityRank(existing.credibility)) {
      seen.set(item.sourceUrl, item)
    }
  }
  return Array.from(seen.values())
}

function credibilityRank(level: 'A' | 'B' | 'C'): number {
  return { A: 3, B: 2, C: 1 }[level]
}

function appendQuestions(existing: FollowupQuestion[], incoming: FollowupQuestion[]): FollowupQuestion[] {
  const known = new Set(existing.map((q) => q.question))
  const fresh = incoming.filter((q) => !known.has(q.question))
  return [...existing, ...fresh]
}
