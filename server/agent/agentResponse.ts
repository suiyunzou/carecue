// Agent 对外响应类型 — 追问 / 阶段性报告 / 最终报告 / 急症提醒

import type { CaseState, FollowupQuestion } from './case/CaseState.ts'
import type { RiskLevel } from './risk/riskLevel.ts'
import type { FinalReport } from './report/reportSchema.ts'
import { buildKnownFacts, fieldHasValue } from './case/stateFields.ts'

export type Citation = {
  index: number
  title: string
  url: string
  credibility: string
}

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
    citations: Citation[]
    searchQueries: string[]
    missingInfo: string[]
  }
  /** 本条回复引用的来源（用于对话下方脚注） */
  citations: Citation[]
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

export function buildCitations(state: CaseState): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []
  for (const e of state.evidence) {
    if (seen.has(e.sourceUrl)) continue
    seen.add(e.sourceUrl)
    citations.push({
      index: citations.length + 1,
      title: e.sourceTitle,
      url: e.sourceUrl,
      credibility: e.credibility,
    })
  }
  return citations
}

export function buildStateSnapshot(state: CaseState): AgentResponseBase['stateSnapshot'] {
  const citations = buildCitations(state)
  return {
    chiefComplaint: state.symptoms.chiefComplaint,
    primaryDomain: state.symptomDomain.primaryDomain,
    riskLevel: state.risk.level,
    riskReason: state.risk.reason,
    inRiskProbe: state.riskProbe.probeStatus === 'in_progress',
    knownFacts: buildKnownFacts(state),
    hypotheses: state.hypotheses.map((h) => ({ name: h.name, likelihood: h.likelihood })),
    evidenceSources: citations.map((c) => ({ title: c.title, url: c.url, credibility: c.credibility })),
    citations,
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
