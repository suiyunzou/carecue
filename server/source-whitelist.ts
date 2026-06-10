// 来源白名单与证据评分 — agent.md §5.4 + §5.6 + PRD §9.2

/**
 * A 级：政府、疾控、WHO、NHS、默沙东、医学指南、三甲医院官网
 * B 级：正规医疗平台、医生审核科普
 * C 级：普通健康资讯，仅弱参考（不在白名单内但也不在黑名单）
 * D 级：论坛、自媒体、问答社区、营销医疗网站，默认不用
 */
const SOURCE_POOLS = {
  A: [
    'nhc.gov.cn',
    'nmpa.gov.cn',
    'who.int',
    'cdc.gov',
    'nhs.uk',
    'msdmanuals.cn',
    'chinacdc.cn',
  ],
  B: [
    'dxy.cn',
    'mayoclinic.org',
    'msdmanuals.com',
    'clevelandclinic.org',
    'webmd.com',
    'health.harvard.edu',
  ],
} as const

/** D 级域名关键词 — 匹配到则一律过滤 */
const BLOCKED_DOMAIN_PATTERNS = [
  /zhihu\.com/,
  /tieba\.baidu\.com/,
  /douyin\.com/,
  /xiaohongshu\.com/,
  /weibo\.com/,
  /bilibili\.com/,
  /quora\.com/,
  /reddit\.com/,
  /facebook\.com/,
  /twitter\.com/,
  /x\.com/,
  /youtube\.com/,
  /\.bbs\./,
  /forum\./,
  /\.tumblr\.com/,
  /medium\.com/,
  /baike\.so\.com/,
  /wenda\./,
  /ask\./,
  /zhidao\.baidu\.com/,
  /120ask\.com/,
  /39\.net/,
  /jkyd\.cn/,
  /xywy\.com/,
  /cnys\.com/,
  /haodf\.com/,
  /guahao\.com/,
  /familydoctor\./,
  /ys137\./,
  /dayi\./,
]

export type SourceLevel = 'A' | 'B' | 'C' | 'D'

/**
 * 根据 AI 推荐的来源等级（A/B/C）生成 Firecrawl 搜索用的 site: 限定词。
 * D 级不生成搜索词，返回空字符串。
 */
export function buildSiteFilter(recommendedLevel: string): string {
  const level = normalizeLevel(recommendedLevel)
  if (level === 'D') return ''

  const domains: string[] = []
  if (level === 'A' || level === 'B') {
    domains.push(...SOURCE_POOLS.A)
  }
  if (level === 'B') {
    domains.push(...SOURCE_POOLS.B)
  }

  if (domains.length === 0) return ''

  return ` (${domains.map((d) => `site:${d}`).join(' OR ')})`
}

/**
 * 根据搜索结果 URL 反查来源等级。
 * - 匹配 A 级池 → A
 * - 匹配 B 级池 → B
 * - 匹配黑名单 → D
 * - 其他 → C（普通健康资讯，仅弱参考）
 */
export function rateSourceUrl(url: string): SourceLevel {
  if (!url) return 'D'

  const host = extractHost(url)

  for (const domain of BLOCKED_DOMAIN_PATTERNS) {
    if (domain.test(host)) return 'D'
  }

  for (const domain of SOURCE_POOLS.A) {
    if (host.includes(domain)) return 'A'
  }

  for (const domain of SOURCE_POOLS.B) {
    if (host.includes(domain)) return 'B'
  }

  return 'C'
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function normalizeLevel(level: string): SourceLevel {
  const upper = level.toUpperCase()
  if (upper === 'A' || upper === 'B' || upper === 'C' || upper === 'D') {
    return upper
  }
  return 'C'
}
