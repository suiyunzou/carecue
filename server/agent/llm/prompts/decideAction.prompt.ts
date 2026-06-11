// AgentDecision 决策 Prompt — v3.0 设计文档 §31.3

import type { CaseState } from '../../case/CaseState.ts'
import { AGENT_LIMITS } from '../../agentLimits.ts'

export function buildDecideActionPrompt(state: CaseState, contextSummary: string) {
  const system = `你是问康 CareCue 的 Agent 决策器。

你只能输出以下 action 之一：
search_medical / analyze_case / generate_care_plan / ask_user / final_answer / emergency_stop

决策规则：
1. 不能直接回答用户，只输出决策 JSON，且必须说明 decisionGoal。
2. 如果尚无疑似方向，优先 analyze_case；形成疑似方向后若缺医学证据，再 search_medical（每轮最多 ${AGENT_LIMITS.maxQueriesPerRound} 个检索词，不允许照抄用户原话）。
3. 如果缺失的用户信息会明显影响风险判断或方向排序，选择 ask_user。
4. 如果已有证据但没有形成疑似方向，选择 analyze_case。
5. 如果已有疑似方向但没有处理建议，选择 generate_care_plan。
6. 如果能形成安全的阶段判断（至少 1 个疑似方向 + 支持/反对依据 + 处理建议 + 用药边界 + 何时就医），选择 final_answer。
7. 如果命中明确急症，选择 emergency_stop。
8. 当前搜索轮次已达 ${state.meta.searchRounds}/${AGENT_LIMITS.maxSearchRounds}，达到上限后禁止 search_medical。
9. 累计追问 ${state.askedQuestions.length}/${AGENT_LIMITS.maxAskedQuestionsTotal}，达到上限后禁止 ask_user。

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    caseSummary: {
      riskLevel: state.risk.level,
      riskReason: state.risk.reason,
      primaryDomain: state.symptomDomain.primaryDomain,
      supportedDepth: state.symptomDomain.supportedDepth,
      symptoms: state.symptoms,
      riskProbe: {
        status: state.riskProbe.probeStatus,
        unresolvedRedFlags: state.riskProbe.unresolvedRedFlags,
        canProceedToAnalysis: state.riskProbe.canProceedToAnalysis,
      },
      hypothesesCount: state.hypotheses.length,
      hypotheses: state.hypotheses.map((h) => ({ name: h.name, likelihood: h.likelihood })),
      evidenceCount: state.evidence.length,
      hasCarePlan: Boolean(state.carePlan),
      missingInfo: state.missingInfo,
      meta: state.meta,
      recentDecisions: state.decisionHistory.slice(-3).map((d) => d.action),
    },
    contextSummary,
  })

  return { system, user }
}
