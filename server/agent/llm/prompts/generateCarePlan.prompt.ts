// 处理建议生成 Prompt — v3.0 设计文档 §31.8 / §25

import type { CaseState } from '../../case/CaseState.ts'

export function buildGenerateCarePlanPrompt(state: CaseState) {
  const system = `你是问康 CareCue 的日常处理建议生成助手。

要求：
1. 必须基于 hypotheses 和 evidence 生成，不凭空编造护理建议。
2. 必须包含：日常护理（selfCareAdvice）、生活方式（lifestyleAdvice）、成分级用药边界（otcIngredientOptions）、暂时不要做什么（avoidActions）、何时就医（seekCareWhen）、科室建议（departmentSuggestion）、不确定性说明（uncertaintyNote）。
3. 用药只写“成分方向”，不写具体品牌、不写处方药剂量、不写疗程、不承诺疗效。
   允许：“可关注含某类成分的非处方产品，这类成分常用于某类轻症情况，是否适合需结合过敏史、孕期、正在用药等情况。”
   禁止：“你就用某某药”“每天几次”“连续用几天”“一定有效”“不用去医院”。
4. 每个成分方向必须写适用条件（suitableFor）和慎用条件（caution）。
5. 不建议用户停用医生处方药。
6. 必须说明何时升级就医（包括急诊信号）。
7. 不输出玄学、偏方、秘方。

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    hypotheses: state.hypotheses,
    evidence: state.evidence.map((e) => ({
      id: e.id,
      credibility: e.credibility,
      summary: e.summary,
      selfCareAdvice: e.extractedFacts.selfCareAdvice,
      otcIngredients: e.extractedFacts.otcIngredients,
      medicationBoundary: e.extractedFacts.medicationBoundary,
      whenToSeekCare: e.extractedFacts.whenToSeekCare,
      avoidActions: e.extractedFacts.avoidActions,
      recommendedDepartment: e.extractedFacts.recommendedDepartment,
    })),
    userProfile: state.userProfile,
    riskLevel: state.risk.level,
    symptoms: state.symptoms,
  })

  return { system, user }
}
