// 报告/追问/急症/阶段性输出渲染 — v3.0 设计文档 §27 / §30 / §34

import type { CaseState, FollowupQuestion } from '../case/CaseState.ts'
import type { FinalReport } from './reportSchema.ts'
import {
  buildCitations,
  buildStateSnapshot,
  type Citation,
  type EmergencyResponse,
  type FinalReportResponse,
  type FollowupResponse,
  type StageReportResponse,
} from '../agentResponse.ts'
import { buildKnownFacts, fieldHasValue } from '../case/stateFields.ts'

const LIKELIHOOD_LABELS: Record<string, string> = {
  more_likely: '更像',
  possible: '也可能',
  less_likely: '暂不太支持',
  must_rule_out: '需优先排除',
}

const CN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四']
const CIRCLED_NUMERALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

function numberSections(sections: string[]): string {
  return sections.map((s, i) => `${CN_NUMERALS[i] ?? i + 1}、${s}`).join('\n\n')
}

function citationMarker(index: number): string {
  return CIRCLED_NUMERALS[index - 1] ?? `[${index}]`
}

/** 为疑似方向匹配最相关的证据角标 */
function hypothesisCitation(state: CaseState, hypothesisName: string, urlToIndex: Map<string, number>): string {
  const match = state.evidence.find((e) =>
    e.relatedHypotheses.some((h) => hypothesisName.includes(h) || h.includes(hypothesisName)),
  )
  if (!match) return ''
  const idx = urlToIndex.get(match.sourceUrl)
  return idx ? citationMarker(idx) : ''
}

function buildUrlIndex(citations: Citation[]): Map<string, number> {
  return new Map(citations.map((c) => [c.url, c.index]))
}

function withResponseMeta<T extends { caseId: string; riskLevel: CaseState['risk']['level']; stateSnapshot: ReturnType<typeof buildStateSnapshot> }>(
  state: CaseState,
  response: T,
): T & { citations: Citation[] } {
  const citations = buildCitations(state)
  return { ...response, citations }
}

export const reportRenderer = {
  renderFinalReport(state: CaseState, report: FinalReport): FinalReportResponse {
    const citations = buildCitations(state)
    const urlToIndex = buildUrlIndex(citations)

    const likelyHypotheses = report.hypotheses.filter((h) => h.likelihood !== 'must_rule_out')
    const mustRuleOut = report.hypotheses.filter((h) => h.likelihood === 'must_rule_out')

    const renderHypothesis = (h: FinalReport['hypotheses'][number], i: number) => {
      const marker = hypothesisCitation(state, h.name, urlToIndex)
      return `${i + 1}. ${h.name}${marker}（${LIKELIHOOD_LABELS[h.likelihood] ?? h.likelihood}）\n   支持：${h.supportEvidence.join('；') || '—'}\n   反对/不确定：${[...h.againstEvidence, ...h.uncertainties].join('；') || '—'}`
    }

    const sections: string[] = [
      `当前结论\n${report.currentConclusion}`,
      `风险分级与理由\n当前风险等级：${report.riskLevel}\n${report.riskReason}${
        report.deniedRedFlags.length > 0 ? `\n已否认的危险信号：${report.deniedRedFlags.join('、')}` : ''
      }${report.unresolvedRedFlags.length > 0 ? `\n仍待确认：${report.unresolvedRedFlags.join('、')}` : ''}`,
    ]

    if (likelyHypotheses.length > 0) {
      sections.push(`当前更倾向的方向\n${likelyHypotheses.map(renderHypothesis).join('\n')}`)
    }
    if (mustRuleOut.length > 0) {
      sections.push(
        `需要优先排除的情况（概率不高但风险高，不能忽略）\n${mustRuleOut.map(renderHypothesis).join('\n')}`,
      )
    }

    sections.push(`你现在可以先做什么\n${report.selfCareAdvice.map((a) => `- ${a}`).join('\n')}`)

    if (report.otcIngredientOptions.length > 0) {
      sections.push(
        `可以关注的非处方成分方向\n${report.otcIngredientOptions
          .map((o) => `- ${o.ingredientCategory}：适用于${o.suitableFor}。注意：${o.caution}`)
          .join('\n')}`,
      )
    }
    if (report.avoidActions.length > 0) {
      sections.push(`暂时不要做什么\n${report.avoidActions.map((a) => `- ${a}`).join('\n')}`)
    }
    sections.push(
      `什么情况需要就医或急诊\n${report.seekCareWhen.map((a) => `- ${a}`).join('\n')}`,
      `建议就诊科室\n${report.departmentSuggestion}`,
    )
    if (report.questionsForDoctor.length > 0) {
      sections.push(`建议向医生确认的问题\n${report.questionsForDoctor.map((qq) => `- ${qq}`).join('\n')}`)
    }
    sections.push(`医生沟通摘要（可直接出示给医生）\n${report.doctorSummary}`)

    const rendered = [
      numberSections(sections),
      citations.length > 0
        ? `参考依据\n${citations.map((c) => `${citationMarker(c.index)} ${c.title}`).join('\n')}`
        : `参考依据\n${renderSearchTraceNote(state)}`,
      `说明\n${report.uncertaintyNote}`,
    ].join('\n\n')

    return withResponseMeta(state, {
      type: 'final_report',
      caseId: state.caseId,
      riskLevel: state.risk.level,
      report,
      rendered,
      stateSnapshot: buildStateSnapshot(state),
    })
  },

  renderFollowup(input: {
    state: CaseState
    questions: FollowupQuestion[]
    mode: 'risk_probe' | 'differential' | 'care_plan'
    intro?: string
  }): FollowupResponse {
    const defaultIntro =
      input.mode === 'risk_probe'
        ? '你提到的症状需要先确认是否存在危险信号。目前信息还不足，不能直接判断为急症，也不能直接归因于疲劳或熬夜。请先确认：'
        : input.mode === 'differential'
          ? '为了区分几个可能方向，需要确认：'
          : '为了判断哪些日常处理建议更适合你，需要确认：'

    return withResponseMeta(input.state, {
      type: 'followup',
      caseId: input.state.caseId,
      riskLevel: input.state.risk.level,
      mode: input.mode,
      intro: input.intro || defaultIntro,
      questions: input.questions,
      stateSnapshot: buildStateSnapshot(input.state),
    })
  },

  renderEmergency(state: CaseState, content: string, doctorSummary: string): EmergencyResponse {
    return withResponseMeta(state, {
      type: 'emergency',
      caseId: state.caseId,
      riskLevel: 'R3',
      content,
      triggeredCombination: state.risk.redFlags,
      doctorSummary,
      stateSnapshot: buildStateSnapshot(state),
    })
  },

  renderStageReport(input: {
    state: CaseState
    reason: string
    failureCode?: string
    nextStepHints?: string[]
  }): StageReportResponse {
    const { state } = input
    const citations = buildCitations(state)
    const urlToIndex = buildUrlIndex(citations)
    const parts: string[] = ['【阶段性整理】（当前信息还不足以给出完整判断）']

    const facts = buildKnownFacts(state)
    if (facts.length > 0) {
      parts.push(`目前了解到：\n${facts.map((f) => `- ${f.label}：${f.value}`).join('\n')}`)
    }

    const riskLines = [`当前风险评估：${state.risk.level}。${state.risk.reason}`]
    if (state.riskProbe.redFlagConfirmed.length > 0) {
      riskLines.push(`需要警惕的信号：${state.riskProbe.redFlagConfirmed.join('、')}`)
    }
    if (state.riskProbe.redFlagDenied.length > 0) {
      riskLines.push(`已确认没有：${state.riskProbe.redFlagDenied.join('、')}`)
    }
    parts.push(riskLines.join('\n'))

    const likely = state.hypotheses.filter((h) => h.likelihood !== 'must_rule_out')
    const mustRuleOut = state.hypotheses.filter((h) => h.likelihood === 'must_rule_out')
    if (likely.length > 0) {
      parts.push(
        `当前更倾向的方向（低置信，仅供参考）：${likely
          .map((h) => {
            const marker = hypothesisCitation(state, h.name, urlToIndex)
            return `${h.name}${marker}（${LIKELIHOOD_LABELS[h.likelihood] ?? h.likelihood}）`
          })
          .join('、')}`,
      )
    }
    if (mustRuleOut.length > 0) {
      parts.push(
        `需要优先排除的情况（概率不高但风险高）：${mustRuleOut
          .map((h) => {
            const marker = hypothesisCitation(state, h.name, urlToIndex)
            return `${h.name}${marker}`
          })
          .join('、')}`,
      )
    }

    if (citations.length > 0) {
      parts.push(`资料核验：已检索并引用 ${citations.length} 条权威来源（见下方链接）`)
    } else {
      parts.push(`资料核验：${renderSearchTraceNote(state)}`)
    }

    const hints = (input.nextStepHints ?? buildPendingQuestions(state)).slice(0, 4)
    parts.push(`下一步建议：\n${(hints.length > 0 ? hints : ['如症状持续或加重，建议线下就诊确认。']).map((h) => `- ${h}`).join('\n')}`)
    parts.push('说明：以上是阶段性整理，不是诊断结论。如出现明显加重或新的危险信号，请尽快就医。')

    return withResponseMeta(state, {
      type: 'stage_report',
      caseId: state.caseId,
      riskLevel: state.risk.level,
      content: parts.join('\n\n'),
      reason: input.reason,
      failureCode: input.failureCode,
      nextStepHints: hints,
      stateSnapshot: buildStateSnapshot(state),
    })
  },
}

/** 还需要补充的问题：过滤掉实际已有信息的字段，避免重复追问 */
export function buildPendingQuestions(state: CaseState): string[] {
  return state.missingInfo
    .filter((m) => {
      const paths = m.field.includes('.')
        ? [m.field]
        : [`symptoms.${m.field}`, `userProfile.${m.field}`]
      return !paths.some((path) => fieldHasValue(state, path))
    })
    .slice(0, 3)
    .map((m) => m.question)
}

/** 检索情况说明：搜了什么、结果如何 */
export function renderSearchTraceNote(state: CaseState): string {
  if (state.evidence.length > 0) {
    return `已检索并引用 ${state.evidence.length} 条权威来源（${Array.from(
      new Set(state.evidence.map((e) => e.credibility)),
    ).join('/')} 级）。`
  }
  const attempted = state.searchTrace.filter((t) => t.status !== 'ok')
  if (attempted.length > 0) {
    const queries = Array.from(new Set(state.searchTrace.map((t) => t.query))).slice(0, 3)
    return `已尝试检索（${queries.join('；')}），本次未获取到可用权威资料，以下内容未经联网核验，如症状持续请以线下医生意见为准。`
  }
  return '本次未进行联网检索，以下内容基于症状整理，未经权威资料核验。'
}
