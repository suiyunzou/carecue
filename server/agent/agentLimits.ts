// 上下文预算与步数限制 — v3.0 设计文档 §38

import type { CaseState } from './case/CaseState.ts'
import type { AgentDecision } from './actionSchema.ts'
import type { AgentFailureCode } from './failureRecovery.ts'

export const AGENT_LIMITS = {
  maxAgentSteps: 7,
  maxSearchRounds: 1,
  maxQueriesPerRound: 2,
  maxSourcesPerQuery: 3,
  maxAcceptedSources: 4,
  maxEvidenceItems: 6,
  maxEvidenceCharsForLLM: 4000,
  maxAskedQuestionsTotal: 8,
  maxQuestionsPerTurn: 3,
  maxFinalReportChars: 3000,
} as const

export type AgentLimits = typeof AGENT_LIMITS

export type LimitCheckResult =
  | { allowed: true }
  | { allowed: false; failureCode: AgentFailureCode; reason: string }

/**
 * 决策级限制检查。
 * 注意：decideAction 已做前置修正（如搜索超限会改选其他 action），
 * 这里是最后一道兜底，违规直接进入失败恢复输出阶段性报告。
 */
export const agentLimitGuard = {
  check(state: CaseState, decision: AgentDecision): LimitCheckResult {
    if (state.meta.agentSteps >= AGENT_LIMITS.maxAgentSteps) {
      return {
        allowed: false,
        failureCode: 'MAX_STEP_REACHED',
        reason: `已达到最大 Agent 步数 ${AGENT_LIMITS.maxAgentSteps}。`,
      }
    }

    if (decision.action === 'search_medical' && state.meta.searchRounds >= AGENT_LIMITS.maxSearchRounds) {
      return {
        allowed: false,
        failureCode: 'MAX_STEP_REACHED',
        reason: `搜索轮次已达上限 ${AGENT_LIMITS.maxSearchRounds}，不允许继续搜索。`,
      }
    }

    if (decision.action === 'ask_user' && state.askedQuestions.length >= AGENT_LIMITS.maxAskedQuestionsTotal) {
      return {
        allowed: false,
        failureCode: 'MAX_STEP_REACHED',
        reason: `累计追问已达上限 ${AGENT_LIMITS.maxAskedQuestionsTotal}，不允许继续追问。`,
      }
    }

    return { allowed: true }
  },
}
