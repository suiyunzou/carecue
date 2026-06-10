// Hypothesis / 分析输出 schema — v3.0 设计文档 §13.5 / §24

import { z } from 'zod'

export const hypothesisSchema = z.object({
  name: z.string(),
  likelihood: z.enum(['more_likely', 'possible', 'less_likely', 'must_rule_out']),
  supportEvidence: z.array(z.string()),
  againstEvidence: z.array(z.string()),
  missingInfo: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high']),
  doctorCheckQuestion: z.string(),
  explanationForUser: z.string(),
  evidenceRefs: z.array(z.string()),
})

export const missingInfoSchema = z.object({
  field: z.string(),
  question: z.string(),
  reason: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  relatedHypothesis: z.string().nullable().optional(),
  relatedRiskRule: z.string().nullable().optional(),
})

export const caseAnalyzeOutputSchema = z.object({
  hypotheses: z.array(hypothesisSchema).min(1).max(5),
  missingInfo: z.array(missingInfoSchema),
  stageConclusion: z.string(),
  canFinalAnswer: z.boolean(),
  shouldAskUser: z.boolean(),
  shouldSearchMore: z.boolean(),
  shouldGenerateCarePlan: z.boolean(),
})

export type CaseAnalyzeOutput = z.infer<typeof caseAnalyzeOutputSchema>
