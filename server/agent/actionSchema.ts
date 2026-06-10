// AgentAction / AgentDecision schema — v3.0 设计文档 §8
// 只允许固定的 6 种 Action，AgentDecision 必须通过 zod 校验，不允许模型乱造。

import { z } from 'zod'
import { SYMPTOM_DOMAINS } from './symptoms/symptomDomain.ts'

export const AGENT_ACTION_TYPES = [
  'search_medical',
  'analyze_case',
  'generate_care_plan',
  'ask_user',
  'final_answer',
  'emergency_stop',
] as const

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number]

export const SEARCH_PURPOSES = [
  'red_flag',
  'differential',
  'department',
  'exam',
  'medication_boundary',
  'self_care',
  'when_to_seek_care',
] as const

export type SearchPurpose = (typeof SEARCH_PURPOSES)[number]

export const medicalSearchTaskSchema = z.object({
  query: z.string().min(2),
  purpose: z.enum(SEARCH_PURPOSES),
  preferredSources: z.array(z.string()),
  language: z.enum(['zh', 'en', 'mixed']),
  relatedDomain: z.enum(SYMPTOM_DOMAINS),
  relatedHypothesis: z.string().nullable().optional(),
})

export type MedicalSearchTask = z.infer<typeof medicalSearchTaskSchema>

export const EXPECTED_STATE_FIELDS = [
  'symptoms',
  'symptomDomain',
  'risk',
  'riskProbe',
  'hypotheses',
  'evidence',
  'missingInfo',
  'carePlan',
  'report',
] as const

export const agentDecisionSchema = z.object({
  action: z.enum(AGENT_ACTION_TYPES),
  reason: z.string(),
  decisionGoal: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  priority: z.enum(['low', 'medium', 'high']),
  shouldReturnToUser: z.boolean(),
  searchTasks: z.array(medicalSearchTaskSchema).nullable().optional(),
  expectedStateUpdate: z.array(z.enum(EXPECTED_STATE_FIELDS)).nullable().optional(),
})

export type AgentDecision = z.infer<typeof agentDecisionSchema>
