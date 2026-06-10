// 症状域定义 — v3.0 设计文档 §9.1

export type SymptomDomain =
  | 'throat_respiratory'
  | 'gastrointestinal'
  | 'eye_discomfort'
  | 'skin_mild'
  | 'chest_pain'
  | 'headache'
  | 'limb_pain'
  | 'fever'
  | 'general_discomfort'
  | 'unknown'

export const SYMPTOM_DOMAINS = [
  'throat_respiratory',
  'gastrointestinal',
  'eye_discomfort',
  'skin_mild',
  'chest_pain',
  'headache',
  'limb_pain',
  'fever',
  'general_discomfort',
  'unknown',
] as const satisfies readonly SymptomDomain[]
