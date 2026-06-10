// 失败恢复 — v3.0 设计文档 §39
// 重试逻辑（重写 1 次、放宽 query 等）由 agentLoop 控制，
// 这里负责不可恢复时的兜底输出：阶段性报告。

import type { CaseState } from './case/CaseState.ts'
import type { AgentResponse } from './agentResponse.ts'
import { reportRenderer, buildPendingQuestions } from './report/reportRenderer.ts'
import type { TraceLogger } from './logs/traceLogger.ts'

export type AgentFailureCode =
  | 'INVALID_ACTION'
  | 'TOOL_INPUT_INVALID'
  | 'TOOL_OUTPUT_INVALID'
  | 'TOOL_RUNTIME_ERROR'
  | 'SEARCH_NO_RESULT'
  | 'ALL_SOURCES_REJECTED'
  | 'EVIDENCE_EMPTY'
  | 'EVIDENCE_CONFLICT'
  | 'CARE_PLAN_GUARD_FAILED'
  | 'FINAL_GUARD_FAILED'
  | 'MAX_STEP_REACHED'

const FAILURE_REASONS: Record<AgentFailureCode, string> = {
  INVALID_ACTION: '内部决策格式异常，已输出阶段性整理。',
  TOOL_INPUT_INVALID: '内部工具参数异常，已输出阶段性整理。',
  TOOL_OUTPUT_INVALID: '内部工具输出异常，已输出阶段性整理。',
  TOOL_RUNTIME_ERROR: '内部工具执行失败，已输出阶段性整理。',
  SEARCH_NO_RESULT: '本次未能检索到相关权威资料，以下判断未经联网核验，置信度较低。',
  ALL_SOURCES_REJECTED: '本次检索到的来源质量不可靠，已全部过滤，不会作为依据。',
  EVIDENCE_EMPTY: '本次未能获取可用医学证据，以下内容仅基于症状整理，置信度较低。',
  EVIDENCE_CONFLICT: '检索到的权威资料之间存在差异，无法给出确定结论。',
  CARE_PLAN_GUARD_FAILED: '处理建议未通过用药安全复核，已降级为生活建议和就医边界。',
  FINAL_GUARD_FAILED: '报告未通过安全复核，已输出降级的阶段性整理。',
  MAX_STEP_REACHED: '本轮分析步数已达上限，以下为阶段性判断。',
}

export interface FailureRecoveryInput {
  code: AgentFailureCode
  state: CaseState
  decision?: unknown
  guardIssues?: unknown
  debugPayload?: unknown
}

export class FailureRecovery {
  constructor(private traceLogger: TraceLogger) {}

  async handle(input: FailureRecoveryInput): Promise<AgentResponse> {
    this.traceLogger.log(input.state.caseId, 'failure_recovery', {
      input: { code: input.code, decision: input.decision, guardIssues: input.guardIssues },
      output: input.debugPayload,
      reason: FAILURE_REASONS[input.code],
    })

    const nextStepHints = this.buildNextStepHints(input)

    this.traceLogger.log(input.state.caseId, 'final_output', {
      reason: `stage_report (${input.code})`,
    })

    return reportRenderer.renderStageReport({
      state: input.state,
      reason: FAILURE_REASONS[input.code],
      failureCode: input.code,
      nextStepHints,
    })
  }

  private buildNextStepHints(input: FailureRecoveryInput): string[] {
    const { state, code } = input
    const hints: string[] = []

    // 只追问真正缺失的字段，用户已回答过的不再出现
    hints.push(...buildPendingQuestions(state).map((q) => `补充信息：${q}`))

    const stillUnresolved = state.riskProbe.unresolvedRedFlags
    if (stillUnresolved.length > 0 && hints.length === 0) {
      hints.push(`以下关键信息仍待确认：${stillUnresolved.join('、')}，出现相关症状时需尽快就医。`)
    }

    if (code === 'EVIDENCE_CONFLICT') {
      hints.push('不同权威资料对该情况说法不一致，建议线下就诊时请医生帮助判断。')
    }

    if (hints.length === 0) {
      hints.push('如症状持续、加重或出现新的不适，建议尽快线下就诊。')
    }
    return hints
  }
}

export { FAILURE_REASONS }
