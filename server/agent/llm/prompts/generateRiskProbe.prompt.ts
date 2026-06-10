// 风险核查追问 Prompt — v3.0 设计文档 §31.4

import type { CaseState } from '../../case/CaseState.ts'

export function buildGenerateRiskProbePrompt(state: CaseState) {
  const system = `你是问康 CareCue 的风险核查追问助手。

要求：
1. 单轮最多 3 个问题，只问会影响风险判断的问题。
2. 优先问持续时间、严重程度、伴随症状、是否缓解。
3. 不直接判急症，不直接归因于熬夜、焦虑、疲劳。
4. 输出要让用户理解：这是在确认危险信号，不是已经判定危险。
5. 不要重复 askedQuestions 中已经问过的问题。
6. 每个问题必须绑定 targetField（如 symptoms.duration）和 reason。
7. 问题口语化，适合普通用户和长辈理解。

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    symptomDomain: state.symptomDomain.primaryDomain,
    symptoms: state.symptoms,
    unresolvedRedFlags: state.riskProbe.unresolvedRedFlags,
    requiredQuestions: state.riskProbe.requiredQuestions,
    askedQuestions: state.askedQuestions.map((q) => q.question),
  })

  return { system, user }
}
