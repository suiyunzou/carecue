// Agent 对外响应类型 — 追问 / 阶段性报告 / 最终报告 / 急症提醒

import type { CaseState, FollowupQuestion } from './case/CaseState.ts'
import type { RiskLevel } from './risk/riskLevel.ts'
import type { FinalReport } from './report/reportSchema.ts'
import { buildKnownFacts, fieldHasValue } from './case/stateFields.ts'

export type AgentResponseBase = {
  caseId: string
  riskLevel: RiskLevel
  /** 当前已知信息 / 风险层级等 UI 展示所需的状态快照（§34） */
  stateSnapshot: {
    chiefComplaint: string
    primaryDomain: string
    riskLevel: RiskLevel
    riskReason: string
    inRiskProbe: boolean
    knownFacts: Array<{ label: string; value: string }>
    hypotheses: Array<{ name: string; likelihood: string }>
    evidenceSources: Array<{ title: string; url: string; credibility: string }>
    searchQueries: string[]
    missingInfo: string[]
  }
}

export type FollowupResponse = AgentResponseBase & {
  type: 'followup'
  mode: 'risk_probe' | 'differential' | 'care_plan'
  intro: string
  questions: FollowupQuestion[]
}

export type EmergencyResponse = AgentResponseBase & {
  type: 'emergency'
  content: string
  triggeredCombination: string[]
  doctorSummary: string
}

export type FinalReportResponse = AgentResponseBase & {
  type: 'final_report'
  report: FinalReport
  rendered: string
}

export type StageReportResponse = AgentResponseBase & {
  type: 'stage_report'
  content: string
  reason: string
  failureCode?: string
  nextStepHints: string[]
}

export type AgentResponse =
  | FollowupResponse
  | EmergencyResponse
  | FinalReportResponse
  | StageReportResponse

export function buildStateSnapshot(state: CaseState): AgentResponseBase['stateSnapshot'] {
  return {
    chiefComplaint: state.symptoms.chiefComplaint,
    primaryDomain: state.symptomDomain.primaryDomain,
    riskLevel: state.risk.level,
    riskReason: state.risk.reason,
    inRiskProbe: state.riskProbe.probeStatus === 'in_progress',
    knownFacts: buildKnownFacts(state),
    hypotheses: state.hypotheses.map((h) => ({ name: h.name, likelihood: h.likelihood })),
    evidenceSources: state.evidence.map((e) => ({
      title: e.sourceTitle,
      url: e.sourceUrl,
      credibility: e.credibility,
    })),
    searchQueries: Array.from(new Set(state.searchTrace.map((t) => t.query))),
    missingInfo: buildPendingMissingQuestions(state),
  }
}

function buildPendingMissingQuestions(state: CaseState): string[] {
  return state.missingInfo
    .filter((m) => {
      const paths = m.field.includes('.')
        ? [m.field]
        : [`symptoms.${m.field}`, `userProfile.${m.field}`]
      return !paths.some((path) => fieldHasValue(state, path))
    })
    .map((m) => m.question)
}
