// 知识库加载器：启动时把 knowledge/files/*.yaml 读入内存，按症状索引。
// 设计文档 2.5：本地 YAML，开发不直接动逻辑，知识由产品/医学顾问维护。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { RedFlagSeverity } from '../schemas/index.ts'

const filesDir = join(dirname(fileURLToPath(import.meta.url)), 'files')

function loadYaml<T>(name: string): T {
  return parseYaml(readFileSync(join(filesDir, name), 'utf8')) as T
}

interface RedFlagEntry {
  symptoms: string[]
  red_flags: Array<{
    name: string
    severity: RedFlagSeverity
    ask: string
    positive_signals?: string[]
  }>
}

interface CarePlanEntry {
  symptoms: string[]
  advice: string[]
}

interface ReferralRule {
  when: 'all_ruled_out' | 'red_flag_positive'
  urgency: string
  department: string
  advice: string
}

/** 加载后的红旗定义（loader 输出，尚无运行态 status）。 */
export interface RedFlagDef {
  name: string
  severity: RedFlagSeverity
  ask: string
  positiveSignals: string[]
}

export interface Knowledge {
  /** 知识库中出现过的全部症状词（M1 naive 种子用）。 */
  symptomVocabulary: string[]
  /** 按用户症状检索匹配的红旗定义（任一症状命中即匹配，保证召回）。 */
  lookupRedFlags(symptoms: string[]): RedFlagDef[]
  /** 按症状取护理建议，无匹配回退到「默认」。 */
  carePlan(symptoms: string[]): string[]
  /** 取就医规则。 */
  referral(when: ReferralRule['when']): ReferralRule
}

function overlaps(a: string[], b: string[]): boolean {
  return a.some((x) => b.includes(x))
}

export function loadKnowledge(): Knowledge {
  const redFlagEntries = loadYaml<RedFlagEntry[]>('red_flags.yaml')
  const carePlanEntries = loadYaml<CarePlanEntry[]>('care_plans.yaml')
  const referralRules = loadYaml<ReferralRule[]>('referral_rules.yaml')

  const vocab = new Set<string>()
  for (const entry of redFlagEntries) entry.symptoms.forEach((s) => vocab.add(s))

  return {
    symptomVocabulary: [...vocab],

    lookupRedFlags(symptoms) {
      const out: RedFlagDef[] = []
      const seen = new Set<string>()
      for (const entry of redFlagEntries) {
        if (!overlaps(entry.symptoms, symptoms)) continue
        for (const rf of entry.red_flags) {
          if (seen.has(rf.name)) continue
          seen.add(rf.name)
          out.push({
            name: rf.name,
            severity: rf.severity,
            ask: rf.ask,
            positiveSignals: rf.positive_signals ?? [],
          })
        }
      }
      return out
    },

    carePlan(symptoms) {
      const match = carePlanEntries.find((e) => overlaps(e.symptoms, symptoms))
      const fallback = carePlanEntries.find((e) => e.symptoms.includes('默认'))
      return match?.advice ?? fallback?.advice ?? []
    },

    referral(when) {
      const rule = referralRules.find((r) => r.when === when)
      if (!rule) throw new Error(`referral rule not found: ${when}`)
      return rule
    },
  }
}
