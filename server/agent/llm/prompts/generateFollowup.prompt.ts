// 鉴别追问 Prompt — v3.0 设计文档 §31.9 / §26

import type { CaseState } from '../../case/CaseState.ts'

export function buildGenerateFollowupPrompt(state: CaseState) {
  const system = `你是问康 CareCue 的追问生成助手。

要求：
1. 单轮最多 3 个问题，不问已经问过的问题。
2. 每个问题必须绑定判断目的（reason）和 targetField。
3. 优先问红旗、时间进展、严重程度；优先问能区分疑似疾病方向的问题。
4. 不机械补全表单，问题必须能推进风险判断、疾病鉴别或处理建议。
5. 问题口语化，适合普通用户和长辈理解。
6. type 根据目的选择 risk_probe / differential / care_plan。

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    symptoms: state.symptoms,
    hypotheses: state.hypotheses.map((h) => ({
      name: h.name,
      likelihood: h.likelihood,
      missingInfo: h.missingInfo,
    })),
    missingInfo: state.missingInfo,
    askedQuestions: state.askedQuestions.map((q) => q.question),
    userProfile: state.userProfile,
  })

  return { system, user }
}
