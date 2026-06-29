// 假设精化 Prompt — v4.0
// 根据新信息（用户回答 / 搜索证据）更新已有假设

import type { CaseState } from '../../case/CaseState.ts'

export function buildRefineHypothesisPrompt(state: CaseState) {
  const system = `你是问康 CareCue 的病例精化助手。

你的职责是：根据用户补充的新信息（回答追问或搜索证据），更新已有的疑似方向（假设）。

要求：
1. 基于已有假设，结合新信息重新评估每个假设的可能性
2. 如果新信息足以排除某个假设，增加其反对依据（againstEvidence）
3. 如果新信息支持某个假设，增加其支持依据（supportEvidence）
4. 更新 missingInfo（已获得的信息移除，新的缺口添加）
5. 当某个假设的支持依据充分且无明显反对依据时，可以提升 likelihood
6. 当某个假设被新证据充分反驳时，可以降低 likelihood 或减少排序
7. 不要轻易排除 must_rule_out 假设，除非有确凿反对依据
8. 给出更新后的整体评估（stageConclusion）

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    existingHypotheses: state.hypotheses.map((h) => ({
      name: h.name,
      likelihood: h.likelihood,
      supportEvidence: h.supportEvidence,
      againstEvidence: h.againstEvidence,
      missingInfo: h.missingInfo,
      riskLevel: h.riskLevel,
    })),
    symptoms: state.symptoms,
    userProfile: state.userProfile,
    evidence: state.evidence.map((e) => ({
      id: e.id,
      credibility: e.credibility,
      summary: e.summary,
      facts: e.extractedFacts,
    })),
    askedQuestions: state.askedQuestions.map((q) => q.question),
    latestUserMessage: state.symptoms.userOriginalText[state.symptoms.userOriginalText.length - 1],
  })

  return { system, user }
}
