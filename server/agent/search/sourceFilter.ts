// 来源过滤 — v3.0 设计文档 §21
// D 级来源不进入 evidence，只进 trace；C 级不能单独支撑最终判断。

import { rateSourceUrl } from '../../source-whitelist.ts'
import type { RawSearchHit } from './medicalSearchTool.ts'
import type { Credibility, SourceType } from '../evidence/evidenceSchema.ts'
import type { MedicalSearchTask } from '../actionSchema.ts'

export interface RatedSource {
  title: string
  url: string
  domain: string
  credibility: Credibility
  sourceType: SourceType
  reason: string
  markdown?: string
  description?: string
  task: MedicalSearchTask
}

export interface RejectedSource {
  title: string
  url: string
  domain: string
  rejectReason: string
}

export interface SourceFilterOutput {
  accepted: RatedSource[]
  rejected: RejectedSource[]
}

const SOURCE_TYPE_BY_DOMAIN: Array<[RegExp, SourceType]> = [
  [/nhc\.gov\.cn|chinacdc\.cn|who\.int|cdc\.gov/, 'official'],
  [/nmpa\.gov\.cn/, 'drug_label'],
  [/nhs\.uk/, 'guideline'],
  [/msdmanuals/, 'medical_manual'],
  [/mayoclinic|clevelandclinic|health\.harvard/, 'hospital'],
  [/dxy\.cn/, 'professional_platform'],
]

export function filterSources(hits: RawSearchHit[]): SourceFilterOutput {
  const accepted: RatedSource[] = []
  const rejected: RejectedSource[] = []
  const seenUrls = new Set<string>()

  for (const hit of hits) {
    const domain = extractDomain(hit.url)

    if (seenUrls.has(hit.url)) continue
    seenUrls.add(hit.url)

    const level = rateSourceUrl(hit.url)
    if (level === 'D') {
      rejected.push({
        title: hit.title,
        url: hit.url,
        domain,
        rejectReason: 'D 级来源（自媒体/问答站/营销内容），不允许进入证据。',
      })
      continue
    }

    accepted.push({
      title: hit.title,
      url: hit.url,
      domain,
      credibility: level,
      sourceType: classifySourceType(domain),
      reason: `来源等级 ${level}，命中白名单或非黑名单普通健康平台。`,
      markdown: hit.markdown,
      description: hit.description,
      task: hit.task,
    })
  }

  // 同域名相似内容去重：保留最高可信度（同域同任务目的只留一条）
  const byDomainPurpose = new Map<string, RatedSource>()
  for (const source of accepted) {
    const key = `${source.domain}:${source.task.purpose}`
    const existing = byDomainPurpose.get(key)
    if (!existing || credibilityRank(source.credibility) > credibilityRank(existing.credibility)) {
      byDomainPurpose.set(key, source)
    }
  }

  return {
    accepted: Array.from(byDomainPurpose.values()),
    rejected,
  }
}

function classifySourceType(domain: string): SourceType {
  for (const [pattern, type] of SOURCE_TYPE_BY_DOMAIN) {
    if (pattern.test(domain)) return type
  }
  return 'professional_platform'
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function credibilityRank(level: Credibility): number {
  return { A: 3, B: 2, C: 1 }[level]
}
