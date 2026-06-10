// 追问守卫 — v3.0 设计文档 §26.2
// 去重 / 限数（单轮最多 3）/ 目的校验（必须绑定 targetField 和 reason）。

import type { CaseState, FollowupQuestion } from '../case/CaseState.ts'
import { AGENT_LIMITS } from '../agentLimits.ts'
import { planQuestions } from './questionPlanner.ts'
import { fieldHasValue } from '../case/stateFields.ts'

export interface QuestionGuardResult {
  questions: FollowupQuestion[]
  dropped: Array<{ question: string; reason: string }>
}

export const questionGuard = {
  validate(questions: FollowupQuestion[], state: CaseState): QuestionGuardResult {
    const dropped: Array<{ question: string; reason: string }> = []
    const askedTexts = state.askedQuestions.map((q) => normalize(q.question))
    const seenThisTurn = new Set<string>()

    const valid = questions.filter((q) => {
      const normalized = normalize(q.question)

      if (!q.question || q.question.trim().length < 4) {
        dropped.push({ question: q.question, reason: '问题为空或过短。' })
        return false
      }
      if (!q.targetField || !q.reason) {
        dropped.push({ question: q.question, reason: '缺少 targetField 或 reason，不允许无目的追问。' })
        return false
      }
      if (askedTexts.some((asked) => isSimilar(asked, normalized))) {
        dropped.push({ question: q.question, reason: '与已问过的问题重复。' })
        return false
      }
      if (seenThisTurn.has(normalized)) {
        dropped.push({ question: q.question, reason: '本轮内重复。' })
        return false
      }
      // 该字段已有值则不再机械补表
      if (fieldHasValue(state, q.targetField)) {
        dropped.push({ question: q.question, reason: `targetField ${q.targetField} 已有信息，属于机械补表。` })
        return false
      }
      seenThisTurn.add(normalized)
      return true
    })

    const remainingBudget = Math.max(
      0,
      AGENT_LIMITS.maxAskedQuestionsTotal - state.askedQuestions.length,
    )
    const limit = Math.min(AGENT_LIMITS.maxQuestionsPerTurn, remainingBudget)

    return {
      questions: planQuestions(valid).slice(0, limit),
      dropped,
    }
  },
}

function normalize(text: string): string {
  return text.replace(/[？?！!。，,\s]/g, '')
}

/** 简单相似度：一方包含另一方的 80% 字符视为重复 */
function isSimilar(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length === 0) return false
  if (long.includes(short)) return true
  let common = 0
  for (const ch of new Set(short)) {
    if (long.includes(ch)) common += 1
  }
  return common / new Set(short).size > 0.85 && Math.abs(a.length - b.length) < 6
}
