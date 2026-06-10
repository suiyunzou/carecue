// 病例分析 Prompt — v3.0 设计文档 §31.7

import type { CaseState } from '../../case/CaseState.ts'
import { AGENT_LIMITS } from '../../agentLimits.ts'

export function buildAnalyzeCasePrompt(state: CaseState) {
  const system = `你是问康 CareCue 的病例分析助手。

要求：
1. 输出疑似疾病方向（hypotheses），不输出确诊；至少 1 个、最多 3 个主要方向。
2. 每个 hypothesis 必须有支持依据（supportEvidence），且必须有反对依据（againstEvidence）或不确定点（missingInfo）。
3. 可能性未必最高但风险较高、需要优先排除的方向，likelihood 必须标记 must_rule_out。
4. 排序依据：症状匹配度、病程匹配度、伴随症状、否认症状的排除力度、年龄/特殊人群相关性、风险严重程度、证据可信度。
5. 支持依据应尽量引用 evidence（写明 evidenceRefs 为证据 id）。
6. 必须判断：是否需要继续追问（shouldAskUser）、是否需要继续搜索（shouldSearchMore）、是否可以生成处理建议（shouldGenerateCarePlan）、是否可以最终回答（canFinalAnswer）。
7. 不允许只输出泛化建议，不允许把症状词直接当成急症结论。
8. explanationForUser 用普通用户能懂的话解释。

只返回符合 JSON Schema 的 JSON。`

  const evidenceForLlm = state.evidence.map((e) => ({
    id: e.id,
    credibility: e.credibility,
    summary: e.summary,
    facts: e.extractedFacts,
    url: e.sourceUrl,
  }))

  const user = JSON.stringify({
    symptoms: state.symptoms,
    userProfile: state.userProfile,
    symptomDomain: state.symptomDomain,
    risk: { level: state.risk.level, reason: state.risk.reason, redFlags: state.risk.redFlags },
    riskProbe: {
      redFlagDenied: state.riskProbe.redFlagDenied,
      unresolvedRedFlags: state.riskProbe.unresolvedRedFlags,
    },
    evidence: clipJson(evidenceForLlm, AGENT_LIMITS.maxEvidenceCharsForLLM),
    hypothesisSeeds: state.symptomDomain.primaryDomain,
    previousHypotheses: state.hypotheses.map((h) => h.name),
    askedQuestions: state.askedQuestions.map((q) => q.question),
  })

  return { system, user }
}

function clipJson(value: unknown, maxChars: number): unknown {
  const raw = JSON.stringify(value)
  if (raw.length <= maxChars) return value
  return JSON.parse(raw.slice(0, maxChars).replace(/[^\]}]*$/, '') || '[]')
}
