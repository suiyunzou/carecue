// 基于假设的追问生成 Prompt — v4.0
// 根据假设之间的鉴别点，生成有针对性的追问

import type { CaseState } from '../../case/CaseState.ts'

export function buildHypothesisQuestionsPrompt(state: CaseState) {
  const system = `你是问康 CareCue 的鉴别追问助手。

你的职责是：根据已有的疑似方向（假设），生成有针对性的追问，帮助区分不同的可能性。

要求：
1. 每个问题必须有一个明确的鉴别目的：区分哪两个假设
2. 不问已经问过的问题（参考 askedQuestions）
3. 单轮最多 2 个问题（用户注意力有限）
4. 优先问能排除高危假设（must_rule_out）的关键信息
5. 问题口语化，适合普通用户理解
6. 每个问题绑定 reason（为什么这个问题能帮助鉴别）和 targetField（更新哪个字段）
7. 如果所有假设的 missingInfo 都已覆盖，可以不生成问题（返回空数组）
8. 不要问已经能从现有信息推断出的问题

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    hypotheses: state.hypotheses.map((h) => ({
      name: h.name,
      likelihood: h.likelihood,
      supportEvidence: h.supportEvidence,
      againstEvidence: h.againstEvidence,
      missingInfo: h.missingInfo,
      riskLevel: h.riskLevel,
    })),
    askedQuestions: state.askedQuestions.map((q) => q.question),
    symptoms: state.symptoms,
  })

  return { system, user }
}
