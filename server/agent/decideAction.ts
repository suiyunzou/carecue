// AgentDecision 决策 — v3.0 设计文档 §8 / §31.3
// LLM 决策 + 代码硬性约束修正；LLM 不可用或输出非法时使用确定性策略。

import type { CaseState } from './case/CaseState.ts'
import { agentDecisionSchema, type AgentDecision } from './actionSchema.ts'
import { AGENT_LIMITS } from './agentLimits.ts'
import type { LlmClient } from './llm/llmClient.ts'
import { LlmUnavailableError } from './llm/llmClient.ts'
import { buildDecideActionPrompt } from './llm/prompts/decideAction.prompt.ts'
import type { TraceLogger } from './logs/traceLogger.ts'

export async function decideAction(input: {
  state: CaseState
  contextSummary: string
  llm: LlmClient
  traceLogger: TraceLogger
}): Promise<AgentDecision> {
  const { state, llm, traceLogger } = input

  // 代码硬性前置：R3 直接 emergency_stop（不交给 LLM）
  if (state.risk.level === 'R3') {
    return forcedDecision('emergency_stop', '代码红旗规则已确认 R3，停止普通分析。')
  }

  let decision: AgentDecision
  try {
    const prompt = buildDecideActionPrompt(state, input.contextSummary)
    decision = await llm.structured({
      schema: agentDecisionSchema,
      schemaName: 'agent_decision',
      system: prompt.system,
      user: prompt.user,
      temperature: 0.1,
    })
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      traceLogger.log(state.caseId, 'llm_fallback', { reason: 'decideAction 使用确定性策略' })
    } else {
      traceLogger.log(state.caseId, 'llm_fallback', {
        reason: `decideAction LLM 输出异常，使用确定性策略：${String(error).slice(0, 200)}`,
      })
    }
    decision = deterministicDecision(state)
  }

  return enforceConstraints(decision, state)
}

/** 代码侧约束修正：违反选择规则的决策被改写为合法决策（§8.3） */
export function enforceConstraints(decision: AgentDecision, state: CaseState): AgentDecision {
  // 搜索超限 -> 改为分析或最终回答
  if (decision.action === 'search_medical' && state.meta.searchRounds >= AGENT_LIMITS.maxSearchRounds) {
    return deterministicDecision(state, '搜索轮次已达上限，决策被修正。')
  }

  // 追问超限 -> 不再追问
  if (decision.action === 'ask_user' && state.askedQuestions.length >= AGENT_LIMITS.maxAskedQuestionsTotal) {
    return deterministicDecision(state, '追问总数已达上限，决策被修正。')
  }

  // 没有症状信息时不允许 analyze_case
  if (decision.action === 'analyze_case' && !state.symptoms.chiefComplaint) {
    return forcedDecision('ask_user', '没有症状信息，必须先向用户了解情况。')
  }

  // 没有疑似方向或没有证据时不允许 generate_care_plan
  if (decision.action === 'generate_care_plan' && (state.hypotheses.length === 0 || state.evidence.length === 0)) {
    return deterministicDecision(state, '缺少疑似方向或证据，不能生成处理建议，决策被修正。')
  }

  // final_answer 前置条件：至少 1 个疑似方向
  if (decision.action === 'final_answer' && state.hypotheses.length === 0) {
    return deterministicDecision(state, '尚无疑似方向，不能 final_answer，决策被修正。')
  }

  return decision
}

/** 确定性决策策略（LLM 不可用 / 决策被修正时） */
export function deterministicDecision(state: CaseState, note?: string): AgentDecision {
  const prefix = note ? `${note} ` : ''

  // 1. 证据不足且还能搜索 -> search_medical
  if (
    state.evidence.length === 0 &&
    state.meta.searchRounds < AGENT_LIMITS.maxSearchRounds &&
    state.symptomDomain.primaryDomain !== 'unknown'
  ) {
    return forcedDecision('search_medical', `${prefix}当前没有医学证据，需要先联网检索权威资料。`)
  }

  // 2. 没有疑似方向 -> analyze_case
  if (state.hypotheses.length === 0) {
    return forcedDecision('analyze_case', `${prefix}已有症状/证据但没有疑似方向，需要分析。`)
  }

  // 3. 完整支持域且没有 carePlan 且有证据 -> generate_care_plan
  if (
    state.symptomDomain.supportedDepth === 'full' &&
    !state.carePlan &&
    state.evidence.length > 0
  ) {
    return forcedDecision('generate_care_plan', `${prefix}已有疑似方向但没有处理建议。`)
  }

  // 4. 其他 -> final_answer
  return forcedDecision('final_answer', `${prefix}信息已足够形成阶段性判断，输出最终报告。`)
}

function forcedDecision(action: AgentDecision['action'], reason: string): AgentDecision {
  return {
    action,
    reason,
    decisionGoal: reason,
    confidence: 'medium',
    priority: 'high',
    shouldReturnToUser: action === 'ask_user' || action === 'final_answer' || action === 'emergency_stop',
  }
}
