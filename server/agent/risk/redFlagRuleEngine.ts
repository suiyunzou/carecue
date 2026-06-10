// 红旗规则引擎 — v3.0 设计文档 §12
// 红旗规则必须由代码执行，不依赖 LLM 自由判断。
// 核心原则：红旗词只触发核查，红旗组合才触发高风险分级。

import type { CaseState } from '../case/CaseState.ts'
import type { SymptomDomain } from '../symptoms/symptomDomain.ts'
import { detectTermPresence, normalizeSymptomText } from '../symptoms/symptomNormalizer.ts'

export interface RuleCondition {
  field: string
  includesAny?: string[]
  excludesAny?: string[]
  equals?: string | number | boolean
  greaterThan?: number
  lessThan?: number
  exists?: boolean
  /** 语义包含：宽松匹配（双向子串），用于持续时间、起病方式等表述 */
  semanticIncludesAny?: string[]
}

export interface RedFlagRule {
  id: string
  symptomDomain: SymptomDomain
  conditions: RuleCondition[]
  level: 'R2' | 'R3'
  /** 至少满足的条件数，默认为全部条件 */
  minConditionCount?: number
  reason: string
  userMessage: string
  doctorSummaryHint: string
  evidenceRequired: boolean
}

export interface RuleMatchResult {
  rule: RedFlagRule
  matched: boolean
  satisfiedConditions: number
  requiredConditions: number
  details: string[]
}

export function evaluateRule(rule: RedFlagRule, state: CaseState): RuleMatchResult {
  const required = rule.minConditionCount ?? rule.conditions.length
  const details: string[] = []
  let satisfied = 0

  for (const condition of rule.conditions) {
    const ok = evaluateCondition(condition, state)
    if (ok) satisfied += 1
    details.push(`${condition.field}: ${ok ? 'hit' : 'miss'}`)
  }

  return {
    rule,
    matched: satisfied >= required,
    satisfiedConditions: satisfied,
    requiredConditions: required,
    details,
  }
}

export function evaluateRules(rules: RedFlagRule[], state: CaseState): RuleMatchResult[] {
  return rules.map((rule) => evaluateRule(rule, state))
}

// ---------------------------------------------------------------------------

function evaluateCondition(condition: RuleCondition, state: CaseState): boolean {
  const value = resolveField(condition.field, state)

  if (condition.exists !== undefined) {
    const present = isPresent(value)
    if (present !== condition.exists) return false
  }

  if (condition.equals !== undefined && value !== condition.equals) {
    return false
  }

  if (condition.greaterThan !== undefined) {
    if (typeof value !== 'number' || value <= condition.greaterThan) return false
  }

  if (condition.lessThan !== undefined) {
    if (typeof value !== 'number' || value >= condition.lessThan) return false
  }

  if (condition.includesAny) {
    if (!matchesAny(value, condition.includesAny, state, condition.field, false)) return false
  }

  if (condition.semanticIncludesAny) {
    if (!matchesAny(value, condition.semanticIncludesAny, state, condition.field, true)) return false
  }

  if (condition.excludesAny) {
    if (matchesAny(value, condition.excludesAny, state, condition.field, false)) return false
  }

  return true
}

function resolveField(path: string, state: CaseState): unknown {
  let current: unknown = state
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

/**
 * 关键词匹配。
 * - 字符串字段：使用否认感知匹配（“没有冷汗”不会命中“冷汗”）
 * - 数组字段：元素与关键词双向包含
 * - chiefComplaint 特殊处理：同时检查用户原始表达
 */
function matchesAny(
  value: unknown,
  keywords: string[],
  state: CaseState,
  field: string,
  semantic: boolean,
): boolean {
  const texts: string[] = []

  if (typeof value === 'string') texts.push(value)
  if (Array.isArray(value)) texts.push(...value.filter((v): v is string => typeof v === 'string'))

  if (field === 'symptoms.chiefComplaint') {
    texts.push(...state.symptoms.userOriginalText)
  }

  if (texts.length === 0) return false

  for (const keyword of keywords) {
    for (const text of texts) {
      const normalizedText = normalizeSymptomText(text)
      const normalizedKeyword = normalizeSymptomText(keyword)

      if (semantic) {
        if (normalizedText.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedText)) {
          // 语义匹配也要避开否认表述
          if (detectTermPresence(normalizedText, normalizedKeyword) !== 'denied') return true
        }
        continue
      }

      if (Array.isArray(value)) {
        // 数组元素本身就是确认的症状，双向包含即可
        if (normalizedText.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedText)) return true
      } else if (detectTermPresence(normalizedText, normalizedKeyword) === 'confirmed') {
        return true
      }
    }
  }

  return false
}
