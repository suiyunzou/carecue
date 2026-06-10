// 确定性表述守卫 — v3.0 设计文档 §3.2 / §28.2
// 拦截确诊化、绝对化、淡化风险、未经验证归因等表述。

export interface CertaintyIssue {
  type: 'diagnosis' | 'absolute' | 'dismissive' | 'unverified_attribution'
  text: string
  suggestion: string
}

const DIAGNOSIS_PATTERNS: Array<[RegExp, string]> = [
  [/你(就|肯定|一定)是\S{1,12}(病|炎|癌|梗|中风)/, '改为“更像/可能是某方向，需要医生确认”'],
  // 否定语境（“还不能确诊”“无法确诊”）是合规表述，不拦截
  [/(?<!不能|无法|难以|未能|不可|并非)确诊/, '不允许使用“确诊”表述'],
  [/诊断为/, '不允许使用“诊断为”表述'],
  [/就是\S{0,8}(心梗|脑梗|中风|癌症|阑尾炎|青光眼)/, '不允许直接断言重病'],
]

const ABSOLUTE_PATTERNS: Array<[RegExp, string]> = [
  [/一定(是|没事|没问题|能好|有效)/, '不允许绝对化表述'],
  [/肯定(是|没事|没问题|能好)/, '不允许绝对化表述'],
  [/百分之?百|100%/, '不允许绝对化表述'],
  [/绝对(是|安全|没事|有效)/, '不允许绝对化表述'],
  [/保证(没事|有效|能好|治好)/, '不允许承诺疗效或安全'],
]

const DISMISSIVE_PATTERNS: Array<[RegExp, string]> = [
  [/不用(去)?(看医生|医院|就医)/, '不允许劝阻就医'],
  [/没必要(去)?(看医生|医院)/, '不允许劝阻就医'],
  [/(可以|完全)?放心(观察)?[，。]?(不用|无需)/, '不允许淡化风险'],
  [/排除了?\S{0,6}(严重|重大)疾病/, '线上信息不能排除严重疾病'],
]

const ATTRIBUTION_PATTERNS: Array<[RegExp, string]> = [
  [/(就|肯定|一定)是熬夜(导致|引起|造成)/, '熬夜不能作为未经验证的最终归因'],
  [/(就|肯定|一定)是焦虑(导致|引起|造成)/, '焦虑不能作为未经验证的最终归因'],
  [/(就|肯定|一定)是(累的|疲劳)/, '疲劳不能作为未经验证的最终归因'],
]

export function findCertaintyIssues(text: string): CertaintyIssue[] {
  const issues: CertaintyIssue[] = []

  const check = (
    patterns: Array<[RegExp, string]>,
    type: CertaintyIssue['type'],
  ) => {
    for (const [pattern, suggestion] of patterns) {
      const match = text.match(pattern)
      if (match) issues.push({ type, text: match[0], suggestion })
    }
  }

  check(DIAGNOSIS_PATTERNS, 'diagnosis')
  check(ABSOLUTE_PATTERNS, 'absolute')
  check(DISMISSIVE_PATTERNS, 'dismissive')
  check(ATTRIBUTION_PATTERNS, 'unverified_attribution')

  return issues
}
