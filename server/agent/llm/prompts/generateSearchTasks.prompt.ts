// 检索任务生成 Prompt — v3.0 设计文档 §31.5

import type { CaseState } from '../../case/CaseState.ts'
import { AGENT_LIMITS } from '../../agentLimits.ts'

export function buildGenerateSearchTasksPrompt(state: CaseState, decisionGoal: string) {
  const system = `你是问康 CareCue 的医学检索任务生成助手。

要求：
1. query 必须包含症状关键词或疾病方向，不直接搜索用户原话。
2. 优先检索红旗症状（red_flag），再疾病鉴别（differential），再日常护理（self_care），再用药边界（medication_boundary）。
3. 每轮最多 ${AGENT_LIMITS.maxQueriesPerRound} 个 query，必须说明检索目的（purpose）。
4. 检索必须服务于风险判断、疑似方向、处理建议或用药边界。
5. 不生成确诊类、处方药推荐类、偏方类、“能不能不去医院”类搜索。
6. 中英文可以混合搜索（如 NHS/MSD 用英文关键词）。
7. preferredSources 只填域名（如 nhs.uk、msdmanuals.cn），不要自己拼 site: 限定词，由系统统一拼接白名单。

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    decisionGoal,
    symptomDomain: state.symptomDomain.primaryDomain,
    symptoms: state.symptoms,
    hypotheses: state.hypotheses.map((h) => ({ name: h.name, likelihood: h.likelihood })),
    existingEvidenceTopics: state.evidence.map((e) => e.extractedFacts.diseaseName ?? e.sourceTitle),
    userProfile: state.userProfile,
  })

  return { system, user }
}
