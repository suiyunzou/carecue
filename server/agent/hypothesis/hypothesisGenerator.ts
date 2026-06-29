// 初始假设生成工具 hypothesis.initial_generate — v4.0
// 基于症状组合生成初步假设，不依赖搜索证据

import { z } from 'zod'
import { defineTool } from '../tools/Tool.ts'
import type { CaseState, Hypothesis, MissingInfo } from '../case/CaseState.ts'
import { caseAnalyzeOutputSchema, type CaseAnalyzeOutput } from '../analysis/hypothesisSchema.ts'
import { buildInitialHypothesisPrompt } from '../llm/prompts/initialHypothesis.prompt.ts'
import { isRecoverableLlmError } from '../llm/llmClient.ts'
import { getDomainConfig } from '../symptoms/symptomDomainConfig.ts'

const HYPOTHESIS_LLM_BUDGET_MS = Number(process.env.AGENT_HYPOTHESIS_LLM_BUDGET_MS ?? 22000)
const HYPOTHESIS_TOOL_TIMEOUT_MS = Number(process.env.AGENT_HYPOTHESIS_TOOL_TIMEOUT_MS ?? 30000)

export const initialHypothesisTool = defineTool({
  name: 'hypothesis.initial_generate',
  description: '基于症状组合生成初始疑似方向（不依赖搜索证据）。',
  inputSchema: z.object({}),
  outputSchema: caseAnalyzeOutputSchema,
  guardLevel: 'medical_reasoning',
  timeoutMs: HYPOTHESIS_TOOL_TIMEOUT_MS,

  async call(_input, ctx) {
    try {
      const prompt = buildInitialHypothesisPrompt(ctx.state)
      const result = await ctx.llm.structured({
        schema: caseAnalyzeOutputSchema,
        schemaName: 'initial_hypothesis',
        system: prompt.system,
        user: prompt.user,
        temperature: 0.3,
        maxDurationMs: HYPOTHESIS_LLM_BUDGET_MS,
        trace: { traceLogger: ctx.traceLogger, caseId: ctx.caseId, node: 'hypothesis.initial_generate' },
      })
      return sanitizeInitialHypotheses(result, ctx.state)
    } catch (error) {
      if (!isRecoverableLlmError(error)) throw error
      ctx.traceLogger.log(ctx.caseId, 'llm_fallback', { reason: 'hypothesis.initial_generate 使用症状域种子降级' })
      ctx.markFallback('hypothesis.initial_generate: LLM 不可用，使用症状域种子降级')
      return fallbackInitialHypotheses(ctx.state)
    }
  },

  toStatePatch(output): Partial<CaseState> {
    return {
      hypotheses: output.hypotheses as Hypothesis[],
      missingInfo: output.missingInfo.map((m) => ({
        ...m,
        relatedHypothesis: m.relatedHypothesis ?? undefined,
        relatedRiskRule: m.relatedRiskRule ?? undefined,
      })) as MissingInfo[],
    }
  },

  toTrace(output) {
    return {
      output: {
        hypotheses: output.hypotheses.map((h) => `${h.name}(${h.likelihood})`),
        stageConclusion: output.stageConclusion,
      },
    }
  },
})

/** 代码侧约束：最多 3 个主要方向 + must_rule_out */
function sanitizeInitialHypotheses(output: CaseAnalyzeOutput, _state: CaseState): CaseAnalyzeOutput {
  const mustRuleOut = output.hypotheses.filter((h) => h.likelihood === 'must_rule_out')
  const others = output.hypotheses.filter((h) => h.likelihood !== 'must_rule_out').slice(0, 3)

  const hypotheses = [...others, ...mustRuleOut].map((h) => {
    if (h.againstEvidence.length === 0 && h.missingInfo.length === 0) {
      return { ...h, missingInfo: ['当前信息不足以排除其他方向，需要医生面诊确认。'] }
    }
    return h
  })

  return { ...output, hypotheses }
}

/** LLM 不可用时：用症状域种子生成低置信方向 */
function fallbackInitialHypotheses(state: CaseState): CaseAnalyzeOutput {
  const config = getDomainConfig(state.symptomDomain.primaryDomain)
  const seeds = config?.commonHypothesisSeeds.slice(0, 3) ?? ['需线下评估的不适方向']

  return {
    hypotheses: seeds.map((name, index) => ({
      name,
      likelihood: index === 0 ? 'possible' : 'less_likely',
      supportEvidence: [`症状域 ${state.symptomDomain.primaryDomain} 的常见方向之一`],
      againstEvidence: [],
      missingInfo: ['AI 分析暂不可用，本方向仅为该症状域常见参考，不构成判断。'],
      riskLevel: 'medium',
      doctorCheckQuestion: `请医生评估是否为${name}。`,
      explanationForUser: `根据症状类型，${name}是该类不适的常见方向之一，需要医生进一步确认。`,
      evidenceRefs: [],
    })),
    missingInfo: [],
    stageConclusion: 'AI 分析暂不可用，仅提供该症状域常见方向作低置信参考，建议线下确认。',
    canFinalAnswer: false,
    shouldAskUser: true,
    shouldSearchMore: false,
    shouldGenerateCarePlan: false,
  }
}
