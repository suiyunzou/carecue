// 症状口语归一 + 否认检测 — v3.0 设计文档 §31.1 注意事项

const SYNONYM_MAP: Array<[RegExp, string]> = [
  [/喘不上气|上不来气|呼吸费劲|憋气/g, '呼吸困难'],
  [/快晕了|眼前发黑|差点晕倒/g, '接近晕厥'],
  [/半边没力气|一边没劲|半身无力/g, '单侧肢体无力'],
  [/说话含糊|说话不清楚|口齿不清/g, '言语异常'],
  [/眼睛磨得慌|眼睛里有东西/g, '眼部异物感'],
  [/脸上红疙瘩|起疙瘩/g, '皮疹'],
  [/心口痛|心口疼/g, '胸口疼'],
  [/出虚汗|一身冷汗/g, '冷汗'],
  [/想吐|犯恶心/g, '恶心'],
  [/拉肚子/g, '腹泻'],
  [/烧心|反酸水/g, '反酸'],
]

/** 程度填充词：去掉后便于触发词/红旗词匹配（如“胸口有点疼”→“胸口疼”） */
const FILLER_PATTERN = /有点儿|有点|有些|稍微/g

export function normalizeSymptomText(text: string): string {
  let result = text
  for (const [pattern, replacement] of SYNONYM_MAP) {
    result = result.replace(pattern, replacement)
  }
  return result.replace(FILLER_PATTERN, '')
}

/**
 * 检测某个症状词在文本中是否被否认（“没有X”“无X”“不X”“没X”）。
 * 返回 'confirmed' | 'denied' | 'absent'
 */
export function detectTermPresence(text: string, term: string): 'confirmed' | 'denied' | 'absent' {
  const normalized = normalizeSymptomText(text)
  const index = normalized.indexOf(term)
  if (index === -1) return 'absent'

  const prefix = normalized.slice(Math.max(0, index - 6), index)
  if (/(没有|没出现|无明显|不存在|否认|未见|未出现|没|无|不)\s*$/.test(prefix)) {
    return 'denied'
  }
  return 'confirmed'
}

/** 从文本中按词典提取确认/否认的症状词 */
export function extractTermsByDictionary(text: string, dictionary: string[]): {
  confirmed: string[]
  denied: string[]
} {
  const confirmed: string[] = []
  const denied: string[] = []
  for (const term of dictionary) {
    const presence = detectTermPresence(text, term)
    if (presence === 'confirmed') confirmed.push(term)
    if (presence === 'denied') denied.push(term)
  }
  return { confirmed, denied }
}

/** 粗提取持续时间表述 */
export function extractDurationText(text: string): string | undefined {
  const match = text.match(
    /((持续|大概|大约|已经)?\s*(\d+|[一两二三四五六七八九十几半]+)\s*(秒|分钟|小时|个小时|天|周|个月|月|年)[以上]*)|(一直不缓解|持续不缓解|一直疼|一直痛|不见好)/,
  )
  return match?.[0]
}
