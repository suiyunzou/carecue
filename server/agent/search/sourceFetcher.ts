// 页面抓取 — v3.0 设计文档 §20
// 搜索结果已带 markdown 时直接使用，否则用 Firecrawl scrape 补抓。

import type { RatedSource } from './sourceFilter.ts'
import type { SearchClient } from './medicalSearchTool.ts'

export interface FetchedPage {
  source: RatedSource
  markdown: string
}

const MAX_PAGE_CHARS = 8000

export async function fetchSourcePage(
  source: RatedSource,
  search: SearchClient,
): Promise<FetchedPage | null> {
  let markdown = source.markdown

  if (!markdown || markdown.trim().length < 100) {
    markdown = await search.scrape(source.url)
  }

  if (!markdown || markdown.trim().length === 0) {
    if (source.description && source.description.length > 40) {
      markdown = source.description
    } else {
      return null
    }
  }

  return {
    source,
    markdown: markdown.slice(0, MAX_PAGE_CHARS),
  }
}
