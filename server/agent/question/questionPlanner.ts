// 追问优先级规划 — v3.0 设计文档 §26.2
// 优先红旗 > 时间/严重程度/进展/缓解 > 鉴别问题 > 处理建议问题。

import type { FollowupQuestion } from '../case/CaseState.ts'

const TYPE_PRIORITY: Record<FollowupQuestion['type'], number> = {
  risk_probe: 0,
  differential: 1,
  care_plan: 2,
}

const PRIORITY_RANK: Record<FollowupQuestion['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const CORE_FIELD_BONUS = ['duration', 'severity', 'progression', 'relievingFactors', 'onsetPattern']

export function planQuestions(questions: FollowupQuestion[]): FollowupQuestion[] {
  return [...questions].sort((a, b) => {
    const byType = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]
    if (byType !== 0) return byType
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (byPriority !== 0) return byPriority
    return coreFieldRank(a.targetField) - coreFieldRank(b.targetField)
  })
}

function coreFieldRank(targetField: string): number {
  const index = CORE_FIELD_BONUS.findIndex((field) => targetField.includes(field))
  return index === -1 ? CORE_FIELD_BONUS.length : index
}
