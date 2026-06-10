// CaseState 病例工作区 — v3.0 设计文档 §13
// LLM 不允许直接写状态，所有更新通过 caseStateService 串行合并。

import type { SymptomDomain } from '../symptoms/symptomDomain.ts'
import type { RiskLevel } from '../risk/riskLevel.ts'
import type { AgentDecision, MedicalSearchTask } from '../actionSchema.ts'
import type { MedicalEvidence } from '../evidence/evidenceSchema.ts'

export type SpecialGroup =
  | 'child'
  | 'elderly'
  | 'pregnant'
  | 'immunocompromised'
  | 'chronic_disease'

export interface UserProfile {
  age?: number
  sex?: 'male' | 'female' | 'unknown'
  pregnancy?: boolean
  chronicDiseases?: string[]
  currentMedications?: string[]
  allergies?: string[]
  specialGroups?: SpecialGroup[]
}

export interface SymptomState {
  chiefComplaint: string
  onsetTime?: string
  duration?: string
  location?: string
  severity?: string
  frequency?: string
  painQuality?: string
  onsetPattern?: string
  triggers?: string[]
  relievingFactors?: string[]
  associatedSymptoms?: string[]
  negativeSymptoms?: string[]
  progression?: 'improving' | 'stable' | 'worsening' | 'unknown'
  userOriginalText: string[]
}

export interface SymptomDomainState {
  primaryDomain: SymptomDomain
  secondaryDomains: SymptomDomain[]
  triggerTerms: string[]
  supportedDepth: 'full' | 'red_flag_only'
  reason: string
}

export interface FollowupQuestion {
  question: string
  reason: string
  targetField: string
  priority: 'high' | 'medium' | 'low'
  relatedHypothesis?: string
  relatedRiskRule?: string
  type: 'risk_probe' | 'differential' | 'care_plan'
}

export interface RiskProbeState {
  symptomDomain: SymptomDomain
  triggerTerms: string[]
  requiredQuestions: FollowupQuestion[]
  redFlagConfirmed: string[]
  redFlagDenied: string[]
  unresolvedRedFlags: string[]
  probeStatus: 'not_started' | 'in_progress' | 'completed'
  canProceedToAnalysis: boolean
  reason: string
}

export interface RiskState {
  level: RiskLevel
  redFlags: string[]
  matchedRules: string[]
  reason: string
  shouldStopOnlineConsultation: boolean
  assessedAt: string
  unresolvedCriticalQuestions: string[]
}

export interface Hypothesis {
  name: string
  likelihood: 'more_likely' | 'possible' | 'less_likely' | 'must_rule_out'
  supportEvidence: string[]
  againstEvidence: string[]
  missingInfo: string[]
  riskLevel: 'low' | 'medium' | 'high'
  doctorCheckQuestion: string
  explanationForUser: string
  evidenceRefs: string[]
}

export interface CarePlan {
  selfCareAdvice: string[]
  lifestyleAdvice: string[]
  otcIngredientOptions: Array<{
    ingredientCategory: string
    suitableFor: string
    caution: string
    evidenceRefs: string[]
  }>
  avoidActions: string[]
  seekCareWhen: string[]
  departmentSuggestion?: string
  followupWindow?: string
  uncertaintyNote: string
}

/** 检索过程记录：展示给用户"搜了什么、找到了什么"（§search trace） */
export interface SearchTraceEntry {
  query: string
  purpose: string
  status: 'ok' | 'no_result' | 'rejected' | 'error'
  sourceCount: number
  at: string
}

export interface MissingInfo {
  field: string
  question: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  relatedHypothesis?: string
  relatedRiskRule?: string
}

export interface CaseMeta {
  createdAt: string
  updatedAt: string
  lastUserMessageAt: string
  searchRounds: number
  followupRounds: number
  agentSteps: number
  language: 'zh' | 'en' | 'mixed'
}

export interface CaseState {
  caseId: string
  userId?: string
  status: 'active' | 'waiting_user' | 'finalized' | 'emergency'
  userProfile: UserProfile
  symptoms: SymptomState
  symptomDomain: SymptomDomainState
  riskProbe: RiskProbeState
  risk: RiskState
  hypotheses: Hypothesis[]
  carePlan?: CarePlan
  evidence: MedicalEvidence[]
  searchTrace: SearchTraceEntry[]
  missingInfo: MissingInfo[]
  askedQuestions: FollowupQuestion[]
  decisionHistory: AgentDecision[]
  meta: CaseMeta
}

export interface CaseStateUpdateInput {
  caseId: string
  patch: Partial<CaseState>
  updateReason: string
  source: 'user' | 'llm' | 'tool' | 'system'
}

export interface CaseStateUpdateOutput {
  caseId: string
  updatedState: CaseState
  changedFields: string[]
  version: number
}

export type { MedicalSearchTask }

export function createInitialCaseState(caseId: string, userId?: string): CaseState {
  const now = new Date().toISOString()
  return {
    caseId,
    userId,
    status: 'active',
    userProfile: {},
    symptoms: {
      chiefComplaint: '',
      userOriginalText: [],
    },
    symptomDomain: {
      primaryDomain: 'unknown',
      secondaryDomains: [],
      triggerTerms: [],
      supportedDepth: 'red_flag_only',
      reason: '尚未识别症状域。',
    },
    riskProbe: {
      symptomDomain: 'unknown',
      triggerTerms: [],
      requiredQuestions: [],
      redFlagConfirmed: [],
      redFlagDenied: [],
      unresolvedRedFlags: [],
      probeStatus: 'not_started',
      canProceedToAnalysis: false,
      reason: '尚未进行风险核查。',
    },
    risk: {
      level: 'R0',
      redFlags: [],
      matchedRules: [],
      reason: '尚未评估。',
      shouldStopOnlineConsultation: false,
      assessedAt: now,
      unresolvedCriticalQuestions: [],
    },
    hypotheses: [],
    carePlan: undefined,
    evidence: [],
    searchTrace: [],
    missingInfo: [],
    askedQuestions: [],
    decisionHistory: [],
    meta: {
      createdAt: now,
      updatedAt: now,
      lastUserMessageAt: now,
      searchRounds: 0,
      followupRounds: 0,
      agentSteps: 0,
      language: 'zh',
    },
  }
}
