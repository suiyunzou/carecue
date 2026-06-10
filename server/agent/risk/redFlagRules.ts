// 红旗规则库 — v3.0 设计文档 §12.3-12.7
// 硬性要求：R3 规则必须至少包含 2 类条件；只有症状词、缺关键信息时最多 R2。

import type { RedFlagRule } from './redFlagRuleEngine.ts'
import type { SymptomDomain } from '../symptoms/symptomDomain.ts'

const chestPainRules: RedFlagRule[] = [
  {
    id: 'CHEST_PAIN_PERSISTENT_WITH_AUTONOMIC',
    symptomDomain: 'chest_pain',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['胸痛', '胸闷', '胸口疼', '胸口压'] },
      {
        field: 'symptoms.duration',
        semanticIncludesAny: ['持续', '不缓解', '一直', '十几分钟', '二十分钟', '20分钟', '半小时', '小时'],
      },
      {
        field: 'symptoms.associatedSymptoms',
        includesAny: ['气短', '呼吸困难', '冷汗', '恶心', '头晕', '晕厥', '明显心慌', '心慌'],
      },
    ],
    minConditionCount: 3,
    level: 'R3',
    reason: '胸痛持续不缓解并伴随自主神经或呼吸循环症状，存在严重心肺风险。',
    userMessage: '该组合存在急症风险，建议立即急诊或急救评估。',
    doctorSummaryHint: '胸痛持续不缓解，伴气短/冷汗/恶心/头晕/晕厥/心慌。',
    evidenceRequired: false,
  },
  {
    id: 'CHEST_PAIN_WITH_DYSPNEA',
    symptomDomain: 'chest_pain',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['胸痛', '胸闷', '胸口疼'] },
      { field: 'symptoms.associatedSymptoms', includesAny: ['呼吸困难'] },
      { field: 'symptoms.painQuality', semanticIncludesAny: ['压榨', '闷紧', '压迫'] },
    ],
    minConditionCount: 3,
    level: 'R3',
    reason: '压榨性胸痛伴呼吸困难，需要优先排除心肺急症。',
    userMessage: '该组合存在急症风险，建议立即急诊评估。',
    doctorSummaryHint: '压榨性胸痛伴呼吸困难。',
    evidenceRequired: false,
  },
  {
    id: 'CHEST_PAIN_WITH_SYNCOPE',
    symptomDomain: 'chest_pain',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['胸痛', '胸闷', '胸口疼'] },
      { field: 'symptoms.associatedSymptoms', includesAny: ['晕厥', '接近晕厥', '意识丧失'] },
    ],
    level: 'R3',
    reason: '胸痛伴晕厥提示循环系统急症风险。',
    userMessage: '该组合存在急症风险，建议立即急诊或急救评估。',
    doctorSummaryHint: '胸痛伴晕厥/接近晕厥。',
    evidenceRequired: false,
  },
  {
    id: 'CHEST_PAIN_KEY_INFO_MISSING',
    symptomDomain: 'chest_pain',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['胸痛', '胸闷', '胸口疼', '心口痛'] },
      { field: 'symptoms.duration', exists: false },
    ],
    level: 'R2',
    reason: '胸痛已触发高风险症状域，但持续时间等关键信息缺失，需要优先核查。',
    userMessage: '目前不能直接判断是否急症，需要先确认持续时间、疼痛性质和伴随症状。',
    doctorSummaryHint: '胸痛，持续时间和伴随症状未明确。',
    evidenceRequired: false,
  },
]

const headacheRules: RedFlagRule[] = [
  {
    id: 'HEADACHE_SUDDEN_NEURO_DEFICIT',
    symptomDomain: 'headache',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['头痛', '头疼'] },
      { field: 'symptoms.onsetPattern', semanticIncludesAny: ['突然发生', '突然', '爆炸样', '瞬间最严重', '一下子'] },
      {
        field: 'symptoms.associatedSymptoms',
        includesAny: ['一侧无力', '单侧肢体无力', '口齿不清', '言语异常', '意识异常', '抽搐', '视物异常'],
      },
    ],
    level: 'R3',
    reason: '突发严重头痛伴神经功能异常，存在脑血管或神经系统急症风险。',
    userMessage: '该情况存在急症风险，建议立即急诊评估。',
    doctorSummaryHint: '突发严重头痛，伴神经功能异常。',
    evidenceRequired: false,
  },
  {
    id: 'HEADACHE_THUNDERCLAP',
    symptomDomain: 'headache',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['头痛', '头疼'] },
      { field: 'symptoms.onsetPattern', semanticIncludesAny: ['爆炸样', '瞬间最严重', '这辈子最痛', '突然最剧烈'] },
      { field: 'symptoms.severity', semanticIncludesAny: ['最严重', '剧烈', '重'] },
    ],
    minConditionCount: 3,
    level: 'R3',
    reason: '雷击样剧烈头痛，需要优先排除蛛网膜下腔出血等急症。',
    userMessage: '该情况存在急症风险，建议立即急诊评估。',
    doctorSummaryHint: '突发雷击样剧烈头痛。',
    evidenceRequired: false,
  },
  {
    id: 'HEADACHE_KEY_INFO_MISSING',
    symptomDomain: 'headache',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['头痛', '头疼'] },
      { field: 'symptoms.onsetPattern', exists: false },
      { field: 'symptoms.associatedSymptoms', exists: false },
    ],
    minConditionCount: 3,
    level: 'R2',
    reason: '头痛的起病方式和伴随症状缺失，无法排除神经系统急症，需要优先核查。',
    userMessage: '目前不能直接判断风险，需要先确认起病方式和伴随症状。',
    doctorSummaryHint: '头痛，起病方式与伴随症状未明确。',
    evidenceRequired: false,
  },
]

const eyeRules: RedFlagRule[] = [
  {
    id: 'EYE_PAIN_WITH_VISION_CHANGE',
    symptomDomain: 'eye_discomfort',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['眼痛', '眼睛胀痛', '眼睛疼', '眼睛痛'] },
      {
        field: 'symptoms.associatedSymptoms',
        includesAny: ['视力下降', '看东西模糊', '畏光', '红眼', '恶心', '呕吐'],
      },
    ],
    level: 'R3',
    reason: '眼痛伴视力变化或明显眼部急性表现，存在眼科急症风险。',
    userMessage: '该情况不建议继续观察，建议尽快眼科急诊或急诊评估。',
    doctorSummaryHint: '眼痛/眼胀痛，伴视力变化、红眼、畏光或恶心呕吐。',
    evidenceRequired: false,
  },
  {
    id: 'EYE_KEY_INFO_MISSING',
    symptomDomain: 'eye_discomfort',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['眼痛', '眼睛疼', '眼睛胀'] },
      { field: 'symptoms.associatedSymptoms', exists: false },
      { field: 'symptoms.negativeSymptoms', exists: false },
    ],
    minConditionCount: 3,
    level: 'R2',
    reason: '眼部不适但是否存在视力下降等红旗信息未确认。',
    userMessage: '需要先确认是否有视力下降、畏光、红眼等情况。',
    doctorSummaryHint: '眼部不适，视力情况未明确。',
    evidenceRequired: false,
  },
]

const skinRules: RedFlagRule[] = [
  {
    id: 'RASH_WITH_ANAPHYLAXIS_SIGNS',
    symptomDomain: 'skin_mild',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['皮疹', '过敏', '荨麻疹', '红疹', '风团'] },
      {
        field: 'symptoms.associatedSymptoms',
        includesAny: ['呼吸困难', '面部肿胀', '嘴唇肿', '喉咙紧', '头晕', '意识异常'],
      },
    ],
    level: 'R3',
    reason: '皮疹或过敏样表现伴呼吸或循环异常，存在严重过敏反应风险。',
    userMessage: '该情况存在急症风险，建议立即急诊或急救处理。',
    doctorSummaryHint: '皮疹/过敏样表现，伴呼吸困难、面唇肿胀或头晕。',
    evidenceRequired: false,
  },
  {
    id: 'RASH_RAPID_SPREAD_WITH_FEVER',
    symptomDomain: 'skin_mild',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['皮疹', '红疹', '疹子', '紫癜'] },
      { field: 'symptoms.progression', equals: 'worsening' },
      { field: 'symptoms.associatedSymptoms', includesAny: ['高热', '发烧', '发热', '黏膜破溃', '紫癜'] },
    ],
    minConditionCount: 3,
    level: 'R3',
    reason: '皮疹快速进展伴发热或紫癜样表现，需要尽快线下评估。',
    userMessage: '该情况建议尽快就医，不建议继续居家观察。',
    doctorSummaryHint: '皮疹快速扩散，伴发热/紫癜样表现。',
    evidenceRequired: false,
  },
]

const throatRules: RedFlagRule[] = [
  {
    id: 'THROAT_WITH_DYSPNEA',
    symptomDomain: 'throat_respiratory',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['嗓子', '咽喉', '喉咙', '咽痛', '咳嗽'] },
      { field: 'symptoms.associatedSymptoms', includesAny: ['呼吸困难', '口水难咽', '咳血', '意识异常'] },
    ],
    level: 'R3',
    reason: '咽喉症状伴呼吸困难、无法咽口水或咳血，存在气道急症风险。',
    userMessage: '该情况存在急症风险，建议立即急诊评估。',
    doctorSummaryHint: '咽喉症状伴呼吸困难/吞咽极度困难/咳血。',
    evidenceRequired: false,
  },
  {
    id: 'THROAT_KEY_INFO_MISSING',
    symptomDomain: 'throat_respiratory',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['嗓子', '咽喉', '喉咙', '咽痛'] },
      { field: 'symptoms.duration', exists: false },
      { field: 'symptoms.associatedSymptoms', exists: false },
    ],
    minConditionCount: 3,
    level: 'R2',
    reason: '咽喉不适但病程和伴随症状缺失，需要核查是否存在呼吸或吞咽困难。',
    userMessage: '需要先确认持续时间、是否发热、是否呼吸或吞咽困难。',
    doctorSummaryHint: '咽喉不适，病程与伴随症状未明确。',
    evidenceRequired: false,
  },
]

const giRules: RedFlagRule[] = [
  {
    id: 'GI_SEVERE_ACUTE_ABDOMEN',
    symptomDomain: 'gastrointestinal',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['肚子疼', '腹痛', '胃疼', '胃痛'] },
      { field: 'symptoms.severity', semanticIncludesAny: ['剧烈', '受不了', '最严重', '重'] },
      { field: 'symptoms.associatedSymptoms', includesAny: ['腹部板硬', '持续呕吐', '高热', '意识异常'] },
    ],
    minConditionCount: 3,
    level: 'R3',
    reason: '剧烈腹痛伴板状腹、持续呕吐或高热，存在急腹症风险。',
    userMessage: '该情况存在急症风险，建议立即急诊评估。',
    doctorSummaryHint: '剧烈腹痛，伴板状腹/持续呕吐/高热。',
    evidenceRequired: false,
  },
  {
    id: 'GI_BLEEDING_OR_DEHYDRATION',
    symptomDomain: 'gastrointestinal',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['肚子疼', '腹痛', '腹泻', '呕吐', '拉肚子', '胃疼'] },
      { field: 'symptoms.associatedSymptoms', includesAny: ['黑便', '血便', '便血', '呕血', '明显脱水', '尿少', '意识异常'] },
    ],
    level: 'R3',
    reason: '胃肠道症状伴消化道出血或明显脱水表现，存在急症风险。',
    userMessage: '该情况存在急症风险，建议尽快急诊评估。',
    doctorSummaryHint: '胃肠道症状伴黑便/血便/呕血/脱水表现。',
    evidenceRequired: false,
  },
  {
    id: 'GI_KEY_INFO_MISSING',
    symptomDomain: 'gastrointestinal',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['肚子疼', '腹痛', '胃疼', '胃痛'] },
      { field: 'symptoms.location', exists: false },
      { field: 'symptoms.duration', exists: false },
    ],
    minConditionCount: 3,
    level: 'R2',
    reason: '腹痛部位和持续时间缺失，无法排除急腹症，需要优先核查。',
    userMessage: '需要先确认疼痛部位、持续时间和伴随症状。',
    doctorSummaryHint: '腹痛，部位与病程未明确。',
    evidenceRequired: false,
  },
]

const feverRules: RedFlagRule[] = [
  {
    id: 'FEVER_WITH_ALTERED_MENTAL',
    symptomDomain: 'fever',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['发烧', '发热', '高烧'] },
      { field: 'symptoms.associatedSymptoms', includesAny: ['意识异常', '嗜睡', '说胡话', '抽搐', '脖子发硬', '呼吸急促'] },
    ],
    level: 'R3',
    reason: '发热伴精神状态异常或脑膜刺激样表现，存在严重感染风险。',
    userMessage: '该情况存在急症风险，建议立即急诊评估。',
    doctorSummaryHint: '发热伴意识/精神状态异常。',
    evidenceRequired: false,
  },
  {
    id: 'FEVER_KEY_INFO_MISSING',
    symptomDomain: 'fever',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['发烧', '发热'] },
      { field: 'symptoms.severity', exists: false },
      { field: 'symptoms.duration', exists: false },
    ],
    minConditionCount: 3,
    level: 'R2',
    reason: '发热但热度和持续时间缺失，需要核查精神状态等红旗信息。',
    userMessage: '需要先确认体温、持续时间和精神状态。',
    doctorSummaryHint: '发热，热度与病程未明确。',
    evidenceRequired: false,
  },
]

const limbRules: RedFlagRule[] = [
  {
    id: 'LIMB_PAIN_WITH_SWELLING',
    symptomDomain: 'limb_pain',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['腿疼', '腿肿', '胳膊疼', '手臂痛', '小腿'] },
      { field: 'symptoms.associatedSymptoms', includesAny: ['单侧肿胀', '红肿发热', '无法活动', '畸形', '呼吸困难'] },
    ],
    level: 'R2',
    reason: '肢体疼痛伴单侧肿胀或红肿发热，需要尽快线下评估排除血栓或感染。',
    userMessage: '建议尽快线下评估，不建议长时间观察。',
    doctorSummaryHint: '肢体疼痛伴单侧肿胀/红肿发热。',
    evidenceRequired: false,
  },
  {
    id: 'LIMB_PAIN_KEY_INFO_MISSING',
    symptomDomain: 'limb_pain',
    conditions: [
      { field: 'symptoms.chiefComplaint', includesAny: ['胳膊疼', '腿疼', '手臂痛', '关节疼'] },
      { field: 'symptoms.duration', exists: false },
      { field: 'symptoms.associatedSymptoms', exists: false },
    ],
    minConditionCount: 3,
    level: 'R2',
    reason: '肢体疼痛但病程和伴随症状缺失，需要核查外伤、肿胀等信息。',
    userMessage: '需要先确认持续时间、是否外伤、是否红肿。',
    doctorSummaryHint: '肢体疼痛，病程与伴随情况未明确。',
    evidenceRequired: false,
  },
]

const generalRules: RedFlagRule[] = [
  {
    id: 'GENERAL_KEY_INFO_MISSING',
    symptomDomain: 'general_discomfort',
    conditions: [
      { field: 'symptoms.chiefComplaint', exists: true },
      { field: 'symptoms.duration', exists: false },
      { field: 'symptoms.associatedSymptoms', exists: false },
    ],
    minConditionCount: 3,
    level: 'R2',
    reason: '全身不适但缺少病程和伴随症状信息，需要先核查。',
    userMessage: '需要先确认持续时间和伴随症状。',
    doctorSummaryHint: '全身不适，关键信息未明确。',
    evidenceRequired: false,
  },
]

export const ALL_RED_FLAG_RULES: RedFlagRule[] = [
  ...chestPainRules,
  ...headacheRules,
  ...eyeRules,
  ...skinRules,
  ...throatRules,
  ...giRules,
  ...feverRules,
  ...limbRules,
  ...generalRules,
]

export function getRulesForDomain(domain: SymptomDomain): RedFlagRule[] {
  return ALL_RED_FLAG_RULES.filter((rule) => rule.symptomDomain === domain)
}

export function getRulesByIds(ids: string[]): RedFlagRule[] {
  return ALL_RED_FLAG_RULES.filter((rule) => ids.includes(rule.id))
}
