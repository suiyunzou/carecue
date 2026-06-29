// 假设精化工具 hypothesis.refine — v4.0
// 根据新信息（用户回答 / 搜索证据）更新已有假设

import { z } from 'zod'
import { defineTool } from '../tools/Tool.ts'
import type { CaseState, Hypothesis, MissingInfo } from '../case/CaseState.ts'
import { caseAnalyzeOutputSchema, type CaseAnalyzeOutput } from '../analysis/hypothesisSchema.ts'
import { buildRefineHypothesisPrompt } from '../llm/prompts/refineHypothesis.prompt.ts'
import { isRecoverableLlmError } from '../llm/llmClient.ts'

const HYPOTHESIS_LLM_BUDGET_MS = Number(process.env.AGENT_HYPOTHESIS_LLM_BUDGET_MS ?? 22000)
const HYPOTHESIS_TOOL_TIMEOUT_MS = Number(process.env.AGENT_HYPOTHESIS_TOOL_TIMEOUT_MS ?? 30000)

export const hypothesisRefineTool = defineTool({
  name: 'hypothesis.refine',
  description: '根据新信息（用户回答或搜索证据）更新已有假设的可能性排序。',
  inputSchema: z.object({}),
  outputSchema: caseAnalyzeOutputSchema,
  guardLevel: 'medical_reasoning',
  timeoutMs: HYPOTHESIS_TOOL_TIMEOUT_MS,

  async call(_input, ctx) {
    try {
      const prompt = buildRefineHypothesisPrompt(ctx.state)
      const result = await ctx.llm.structured({
        schema: caseAnalyzeOutputSchema,
        schemaName: 'refine_hypothesis',
        system: prompt.system,
        user: prompt.user,
        temperature: 0.2,
        maxDurationMs: HYPOTHESIS_LLM_BUDGET_MS,
        trace: { traceLogger: ctx.traceLogger, caseId: ctx.caseId, node: 'hypothesis.refine' },
      })
      return sanitizeRefinedHypotheses(result, ctx.state)
    } catch (error) {
      if (!isRecoverableLlmError(error)) throw error
      ctx.traceLogger.log(ctx.caseId, 'llm_fallback', { reason: 'hypothesis.refine 无法使用，保留现有假设' })
      ctx.markFallback('hypothesis.refine: LLM 不可用，保留现有假设')
      // 保留现有假设，只更新 missingInfo
      return preserveExistingHypotheses(ctx.state)
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
function sanitizeRefinedHypotheses(output: CaseAnalyzeOutput, _state: CaseState): CaseAnalyzeOutput {
  const mustRuleOut = output.hypotheses.filter((h) => h.likelihood === 'must_rule_out')
  const others = output.hypotheses.filter((h) => h.likelihood !== 'must_rule_out').slice(0, 3)
  return { ...output, hypotheses: [...others, ...mustRuleOut] }
}

/** LLM 不可用时保留现有假设 */
function preserveExistingHypotheses(state: CaseState): CaseAnalyzeOutput {
  return {
    hypotheses: state.hypotheses as Hypothesis[],
    missingInfo: state.missingInfo as MissingInfo[],
    stageConclusion: '假设精化暂不可用，保留上次分析结果。',
    canFinalAnswer: state.hypotheses.length > 0 && state.evidence.length > 0,
    shouldAskUser: state.missingInfo.length > 0,
    shouldSearchMore: state.evidence.length === 0,
    shouldGenerateCarePlan: state.hypotheses.length > 0 && state.evidence.length > 0,
  }
}
