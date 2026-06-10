// 用药边界文本分析 — v3.0 设计文档 §25.4 / §29
// 检测越界用药表述：具体剂量、疗程、停药/加药指令、疗效承诺、处方化表述。

export interface MedicationViolation {
  type:
    | 'dosage'
    | 'course'
    | 'stop_medication'
    | 'increase_medication'
    | 'efficacy_promise'
    | 'prescription_style'
    | 'discourage_care'
  text: string
}

const DOSAGE_PATTERNS = [
  /\d+(\.\d+)?\s*(mg|毫克|g|克|ml|毫升|片|粒|滴|喷|袋|支|丸)/i,
  /每(天|日|次|晚|早)\s*[一二两三四五六七八九十\d]+\s*(次|片|粒|袋|滴|喷)/,
  /一天\s*[一二两三四五六七八九十\d]+\s*次/,
  /(每隔|间隔)\s*\d+\s*小时(用|服|吃)/,
]

const COURSE_PATTERNS = [
  /连(续|着)?(用|服|吃|涂|抹)\s*[一二两三四五六七八九十\d]+\s*(天|日|周|个月)/,
  /(用|服|吃)\s*满?\s*[一二两三四五六七八九十\d]+\s*(天|日|周|个疗程)/,
  /疗程\s*[一二两三四五六七八九十\d]+/,
]

const STOP_MED_PATTERNS = [/(停掉|停用|别再吃|不要再吃|自行停)(医生|处方|正在.{0,6}吃)?的?药/, /把.{0,10}药停了/]
const INCREASE_MED_PATTERNS = [/(加大|增加|翻倍).{0,6}(剂量|药量)/, /多吃(一|两|几)?(片|粒)/]
const EFFICACY_PATTERNS = [/(一定|肯定|保证|百分百|绝对)(有效|能好|治好|管用)/, /用了就好/]
const PRESCRIPTION_STYLE_PATTERNS = [/你就(买|用|吃)\s*\S+/, /比医生开的(更|还)?(好|合适)/]
const DISCOURAGE_CARE_PATTERNS = [/不用(去)?(看医生|去医院|就医)/, /没必要(去)?医院/]

export function findMedicationViolations(text: string): MedicationViolation[] {
  const violations: MedicationViolation[] = []

  const check = (patterns: RegExp[], type: MedicationViolation['type']) => {
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) violations.push({ type, text: match[0] })
    }
  }

  check(DOSAGE_PATTERNS, 'dosage')
  check(COURSE_PATTERNS, 'course')
  check(STOP_MED_PATTERNS, 'stop_medication')
  check(INCREASE_MED_PATTERNS, 'increase_medication')
  check(EFFICACY_PATTERNS, 'efficacy_promise')
  check(PRESCRIPTION_STYLE_PATTERNS, 'prescription_style')
  check(DISCOURAGE_CARE_PATTERNS, 'discourage_care')

  return violations
}

export function containsDosageInstruction(text: string): boolean {
  return [...DOSAGE_PATTERNS, ...COURSE_PATTERNS].some((pattern) => pattern.test(text))
}
