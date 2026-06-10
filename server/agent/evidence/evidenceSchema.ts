// 医学证据结构 — v3.0 设计文档 §22

import { z } from 'zod'
import { SYMPTOM_DOMAINS } from '../symptoms/symptomDomain.ts'

export const CREDIBILITY_LEVELS = ['A', 'B', 'C'] as const
export type Credibility = (typeof CREDIBILITY_LEVELS)[number]

export const SOURCE_TYPES = [
  'official',
  'guideline',
  'medical_manual',
  'hospital',
  'drug_label',
  'professional_platform',
] as const

export type SourceType = (typeof SOURCE_TYPES)[number]

export const extractedFactsSchema = z.object({
  diseaseName: z.string().nullable().optional(),
  typicalSymptoms: z.array(z.string()).nullable().optional(),
  atypicalSymptoms: z.array(z.string()).nullable().optional(),
  redFlags: z.array(z.string()).nullable().optional(),
  commonCauses: z.array(z.string()).nullable().optional(),
  differentialDiagnosis: z.array(z.string()).nullable().optional(),
  recommendedDepartment: z.array(z.string()).nullable().optional(),
  suggestedExams: z.array(z.string()).nullable().optional(),
  medicationBoundary: z.array(z.string()).nullable().optional(),
  otcIngredients: z.array(z.string()).nullable().optional(),
  selfCareAdvice: z.array(z.string()).nullable().optional(),
  whenToSeekCare: z.array(z.string()).nullable().optional(),
  avoidActions: z.array(z.string()).nullable().optional(),
})

export const applicableToSchema = z.object({
  ageGroup: z.string().nullable().optional(),
  sex: z.string().nullable().optional(),
  pregnancy: z.boolean().nullable().optional(),
  acuteOrChronic: z.enum(['acute', 'chronic', 'unknown']).nullable().optional(),
  severity: z.enum(['mild', 'moderate', 'severe', 'unknown']).nullable().optional(),
})

export const medicalEvidenceSchema = z.object({
  id: z.string(),
  sourceTitle: z.string(),
  sourceUrl: z.string(),
  sourceDomain: z.string(),
  credibility: z.enum(CREDIBILITY_LEVELS),
  sourceType: z.enum(SOURCE_TYPES),
  relatedDomain: z.enum(SYMPTOM_DOMAINS),
  relatedHypotheses: z.array(z.string()),
  extractedFacts: extractedFactsSchema,
  applicableTo: applicableToSchema,
  summary: z.string(),
  extractedAt: z.string(),
  conflict: z.boolean().optional(),
})

export type MedicalEvidence = z.infer<typeof medicalEvidenceSchema>
export type ExtractedFacts = z.infer<typeof extractedFactsSchema>
