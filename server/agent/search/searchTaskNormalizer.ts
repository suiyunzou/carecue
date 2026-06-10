// 搜索任务规范化 — v3.0 设计文档 §19.2
// 去重、限数（每轮最多 5 个）、过滤照抄用户原话的 query、按目的排序。

import type { MedicalSearchTask, SearchPurpose } from '../actionSchema.ts'
import type { CaseState } from '../case/CaseState.ts'
import { AGENT_LIMITS } from '../agentLimits.ts'

const PURPOSE_PRIORITY: Record<SearchPurpose, number> = {
  red_flag: 0,
  differential: 1,
  when_to_seek_care: 2,
  self_care: 3,
  medication_boundary: 4,
  department: 5,
  exam: 6,
}

export const searchTaskNormalizer = {
  normalize(tasks: MedicalSearchTask[], state: CaseState): MedicalSearchTask[] {
    const seen = new Set<string>()
    const userTexts = state.symptoms.userOriginalText

    return tasks
      .filter((task) => {
        const query = task.query.trim()
        if (query.length < 2) return false
        // 不直接搜索用户原话
        if (userTexts.some((text) => text.trim() === query)) return false
        const key = `${task.purpose}:${query}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => PURPOSE_PRIORITY[a.purpose] - PURPOSE_PRIORITY[b.purpose])
      .slice(0, AGENT_LIMITS.maxQueriesPerRound)
  },
}
