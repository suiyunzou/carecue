// 用药边界守卫 — v3.0 设计文档 §29
// 拦截：具体剂量/疗程、自行停药加药、处方化推荐、疗效承诺、缺慎用条件、缺就医升级条件。

import type { CarePlan, CaseState } from '../case/CaseState.ts'
import { findMedicationViolations } from '../analysis/medicationBoundaryAnalyzer.ts'

export interface SafetyIssue {
  code: string
  message: string
  location: string
}

export interface MedicationBoundaryGuardResult {
  passed: boolean
  issues: SafetyIssue[]
  fixedCarePlan?: CarePlan
}

export const medicationBoundaryGuard = {
  async validate(input: { state: CaseState; carePlan: CarePlan }): Promise<MedicationBoundaryGuardResult> {
    const { carePlan, state } = input
    const issues: SafetyIssue[] = []
    const fixed: CarePlan = structuredClone(carePlan)
    let modified = false

    // 1-6. 文本级越界检查（剂量/疗程/停药/加药/承诺/处方化/劝阻就医）
    const textSections: Array<[string, string[]]> = [
      ['selfCareAdvice', fixed.selfCareAdvice],
      ['lifestyleAdvice', fixed.lifestyleAdvice],
      ['avoidActions', fixed.avoidActions],
      ['seekCareWhen', fixed.seekCareWhen],
    ]

    for (const [location, lines] of textSections) {
      const keep: string[] = []
      for (const line of lines) {
        const violations = findMedicationViolations(line)
        if (violations.length > 0) {
          issues.push({
            code: 'MEDICATION_TEXT_VIOLATION',
            message: `检测到越界表述：${violations.map((v) => `${v.type}(${v.text})`).join('、')}`,
            location: `${location}: ${line.slice(0, 50)}`,
          })
          modified = true
          continue
        }
        keep.push(line)
      }
      if (location === 'selfCareAdvice') fixed.selfCareAdvice = keep
      if (location === 'lifestyleAdvice') fixed.lifestyleAdvice = keep
      if (location === 'avoidActions') fixed.avoidActions = keep
      if (location === 'seekCareWhen') fixed.seekCareWhen = keep
    }

    // 成分方向检查
    const keptOptions: CarePlan['otcIngredientOptions'] = []
    for (const option of fixed.otcIngredientOptions) {
      const combined = `${option.ingredientCategory} ${option.suitableFor} ${option.caution}`
      const violations = findMedicationViolations(combined)

      if (violations.length > 0) {
        issues.push({
          code: 'OTC_OPTION_VIOLATION',
          message: `成分方向包含越界表述：${violations.map((v) => v.text).join('、')}`,
          location: `otcIngredientOptions: ${option.ingredientCategory}`,
        })
        modified = true
        continue
      }

      // 8. 必须写慎用条件
      if (!option.caution || option.caution.trim().length < 4) {
        issues.push({
          code: 'OTC_MISSING_CAUTION',
          message: '成分方向缺少慎用条件。',
          location: `otcIngredientOptions: ${option.ingredientCategory}`,
        })
        option.caution = '是否适合需结合过敏史、孕期、儿童/老人、慢病和正在使用的药物判断；症状严重、反复或不缓解时应就医。'
        modified = true
      }
      keptOptions.push(option)
    }
    fixed.otcIngredientOptions = keptOptions

    // 7. 特殊人群提示
    const profile = state.userProfile
    const isSpecial =
      profile.pregnancy ||
      (profile.age !== undefined && (profile.age < 12 || profile.age >= 65)) ||
      (profile.chronicDiseases?.length ?? 0) > 0 ||
      (profile.currentMedications?.length ?? 0) > 0

    if (isSpecial && fixed.otcIngredientOptions.length > 0) {
      const mentionsSpecial = fixed.otcIngredientOptions.some((o) =>
        /孕|儿童|老人|老年|慢病|正在用药|医生|药师/.test(o.caution),
      )
      if (!mentionsSpecial) {
        issues.push({
          code: 'OTC_SPECIAL_GROUP_IGNORED',
          message: '用户属于特殊人群，但成分方向未提示先咨询医生或药师。',
          location: 'otcIngredientOptions',
        })
        fixed.otcIngredientOptions = fixed.otcIngredientOptions.map((o) => ({
          ...o,
          caution: `${o.caution} 你属于需要额外谨慎的人群，使用前建议先咨询医生或药师。`,
        }))
        modified = true
      }
    }

    // 9. 必须写就医升级条件
    if (fixed.seekCareWhen.length === 0) {
      issues.push({
        code: 'MISSING_SEEK_CARE',
        message: 'carePlan 缺少何时升级就医的条件。',
        location: 'seekCareWhen',
      })
      fixed.seekCareWhen = ['症状加重、持续不缓解、范围扩大或出现新的明显不适时，应尽快就医。']
      modified = true
    }

    // 10. 用药依据来源可信度：carePlan 引用的证据若是 C 级，必须降级处理
    for (const option of fixed.otcIngredientOptions) {
      const refs = option.evidenceRefs ?? []
      if (refs.length > 0) {
        const allLowCredibility = refs.every((ref) => {
          const evidence = state.evidence.find((e) => e.id === ref)
          return evidence ? evidence.credibility === 'C' : true
        })
        if (allLowCredibility) {
          issues.push({
            code: 'OTC_LOW_CREDIBILITY_SOURCE',
            message: '成分方向仅由 C 级来源支撑，不能单独作为依据。',
            location: `otcIngredientOptions: ${option.ingredientCategory}`,
          })
        }
      }
    }

    // 可修复问题已修复 -> passed；只有不可修复的强违规（剂量类被整条剔除后内容为空）才 fail
    const fatal = fixed.selfCareAdvice.length === 0 && carePlan.selfCareAdvice.length > 0

    return {
      passed: !fatal,
      issues,
      fixedCarePlan: modified ? fixed : undefined,
    }
  },
}
