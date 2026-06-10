// 医学搜索客户端 — Firecrawl 封装 — v3.0 设计文档 §19
// AI 只生成检索意图和关键词，site 白名单限定由这里统一拼接。

import FirecrawlApp from '@mendable/firecrawl-js'
import type { MedicalSearchTask } from '../actionSchema.ts'
import { buildSiteFilter } from '../../source-whitelist.ts'
import { AGENT_LIMITS } from '../agentLimits.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RawSearchHit {
  title: string
  url: string
  description?: string
  markdown?: string
  task: MedicalSearchTask
}

export interface SearchClient {
  search(task: MedicalSearchTask): Promise<RawSearchHit[]>
  scrape(url: string): Promise<string | undefined>
}

export function createFirecrawlSearchClient(): SearchClient {
  const firecrawl = new FirecrawlApp({
    apiKey: process.env.FIRECRAWL_API_KEY || 'dummy',
  })

  return {
    async search(task: MedicalSearchTask): Promise<RawSearchHit[]> {
      // 用药边界优先 A 级来源（药监、官方医学机构），其余 A+B
      const level = task.purpose === 'medication_boundary' ? 'A' : 'B'
      const siteFilter = buildSiteFilter(level)
      const query = `${task.query}${siteFilter}`

      const response: any = await firecrawl.search(query, {
        limit: AGENT_LIMITS.maxSourcesPerQuery,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
      })

      // 兼容 v4（results.web）与 v1（results.data）两种返回结构
      const items: any[] = response?.web ?? response?.data ?? response?.results ?? []
      return items
        .map((item: any): RawSearchHit | null => {
          const url = item?.url ?? item?.metadata?.sourceURL
          if (!url) return null
          return {
            title: item?.title ?? item?.metadata?.title ?? url,
            url,
            description: item?.description ?? item?.snippet,
            markdown: item?.markdown,
            task,
          }
        })
        .filter((item: RawSearchHit | null): item is RawSearchHit => item !== null)
    },

    async scrape(url: string): Promise<string | undefined> {
      try {
        const page: any = await firecrawl.scrape(url, { formats: ['markdown'] } as any)
        return page?.markdown ?? page?.data?.markdown
      } catch {
        return undefined
      }
    },
  }
}
