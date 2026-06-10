// 症状域配置 — v3.0 设计文档 §9 / §36 / §37
// P0 完整支持域：咽喉呼吸道、胃肠道、眼部、皮肤轻症；
// 红旗拦截域：胸痛、头痛、肢体痛、发热、全身不适。

import type { FollowupQuestion } from '../case/CaseState.ts'
import type { SearchPurpose } from '../actionSchema.ts'
import type { SymptomDomain } from './symptomDomain.ts'

export interface SearchQueryTemplate {
  query: string
  purpose: SearchPurpose
  language: 'zh' | 'en'
  preferredSources: string[]
}

export interface SymptomDomainConfig {
  domain: SymptomDomain
  triggerTerms: string[]
  requiredCoreFields: string[]
  riskProbeQuestions: FollowupQuestion[]
  redFlagRuleIds: string[]
  /** 该域的红旗信号词典，用于确认 / 否认匹配 */
  redFlagSignals: string[]
  commonHypothesisSeeds: string[]
  searchQueryTemplates: SearchQueryTemplate[]
  supportedDepth: 'full' | 'red_flag_only'
}

function q(
  question: string,
  reason: string,
  targetField: string,
  priority: 'high' | 'medium' | 'low' = 'high',
): FollowupQuestion {
  return { question, reason, targetField, priority, type: 'risk_probe' }
}

const throatRespiratoryDomain: SymptomDomainConfig = {
  domain: 'throat_respiratory',
  triggerTerms: ['嗓子疼', '喉咙痛', '喉咙不舒服', '咽喉', '咽痛', '咳嗽', '嗓子哑', '咽东西疼', '喉咙有异物感', '鼻塞', '流鼻涕'],
  requiredCoreFields: ['duration', 'severity', 'associatedSymptoms'],
  riskProbeQuestions: [
    q('这种不舒服持续几天了？', '病程长短会影响感染和慢性刺激方向的判断。', 'symptoms.duration'),
    q('有没有发烧？大概多少度？', '是否发热及热度会影响感染严重程度判断。', 'symptoms.associatedSymptoms'),
    q('现在有没有觉得呼吸费劲、咽东西很困难或者口水都难咽？', '呼吸困难和明显吞咽困难是需要尽快就医的危险信号。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: ['THROAT_WITH_DYSPNEA', 'THROAT_KEY_INFO_MISSING'],
  redFlagSignals: ['呼吸困难', '吞咽困难', '高热不退', '咳血', '意识异常', '口水难咽', '声音嘶哑加重'],
  commonHypothesisSeeds: ['普通感冒或上呼吸道感染', '咽炎', '扁桃体炎', '鼻后滴漏', '过敏性鼻炎相关', '胃食管反流相关咽喉不适'],
  searchQueryTemplates: [
    { query: '咽痛 鉴别 咽炎 扁桃体炎 红旗信号', purpose: 'red_flag', language: 'zh', preferredSources: ['msdmanuals.cn', 'dxy.cn'] },
    { query: 'sore throat self care when to see a doctor', purpose: 'self_care', language: 'en', preferredSources: ['nhs.uk'] },
  ],
  supportedDepth: 'full',
}

const gastrointestinalDomain: SymptomDomainConfig = {
  domain: 'gastrointestinal',
  triggerTerms: ['肚子疼', '腹痛', '胃疼', '胃痛', '腹泻', '拉肚子', '恶心', '呕吐', '便秘', '胀气', '反酸', '烧心', '消化不良'],
  requiredCoreFields: ['location', 'duration', 'associatedSymptoms'],
  riskProbeQuestions: [
    q('肚子疼主要在哪个位置？上腹、下腹、还是整个肚子？', '腹痛部位是判断方向的关键信息。', 'symptoms.location'),
    q('疼了多久了？是一阵一阵的还是持续越来越重？', '持续加重的剧烈腹痛需要优先排除急腹症。', 'symptoms.duration'),
    q('有没有发烧、拉黑便或血便、一直吐、口渴尿少这些情况？', '这些是胃肠道的危险信号，需要先确认。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: ['GI_SEVERE_ACUTE_ABDOMEN', 'GI_BLEEDING_OR_DEHYDRATION', 'GI_KEY_INFO_MISSING'],
  redFlagSignals: ['剧烈腹痛', '持续呕吐', '黑便', '血便', '明显脱水', '高热', '腹部板硬', '意识异常', '便血'],
  commonHypothesisSeeds: ['消化不良', '胃食管反流', '急性胃肠炎', '便秘', '肠易激样表现'],
  searchQueryTemplates: [
    { query: '急性胃肠炎 消化不良 鉴别 危险信号 何时就医', purpose: 'red_flag', language: 'zh', preferredSources: ['msdmanuals.cn'] },
    { query: 'stomach ache diarrhoea self care', purpose: 'self_care', language: 'en', preferredSources: ['nhs.uk'] },
  ],
  supportedDepth: 'full',
}

const eyeDiscomfortDomain: SymptomDomainConfig = {
  domain: 'eye_discomfort',
  triggerTerms: ['眼睛胀', '眼睛疼', '眼痛', '眼睛干', '眼睛痒', '眼红', '红眼', '眼睛磨', '视疲劳', '眼屎多', '眼部异物感', '眼睛不舒服'],
  requiredCoreFields: ['location', 'associatedSymptoms', 'duration'],
  riskProbeQuestions: [
    q('是一只眼睛还是两只眼睛不舒服？', '单眼剧烈症状更需要警惕眼科急症。', 'symptoms.location'),
    q('看东西有没有变模糊或视力下降？', '视力下降是眼科急症的关键红旗信号。', 'symptoms.associatedSymptoms'),
    q('有没有明显怕光、眼睛发红、恶心想吐或严重头痛？', '这些伴随症状会显著改变风险判断。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: ['EYE_PAIN_WITH_VISION_CHANGE', 'EYE_KEY_INFO_MISSING'],
  redFlagSignals: ['视力下降', '看东西模糊', '畏光', '红眼', '恶心', '呕吐', '单眼剧痛', '外伤', '化学物入眼'],
  commonHypothesisSeeds: ['干眼', '视疲劳', '结膜炎', '过敏性结膜炎', '麦粒肿或睑缘炎'],
  searchQueryTemplates: [
    { query: '眼痛 视力下降 急性闭角型青光眼 红旗', purpose: 'red_flag', language: 'zh', preferredSources: ['msdmanuals.cn'] },
    { query: 'dry eyes eye strain self care artificial tears', purpose: 'self_care', language: 'en', preferredSources: ['nhs.uk'] },
  ],
  supportedDepth: 'full',
}

const skinMildDomain: SymptomDomainConfig = {
  domain: 'skin_mild',
  triggerTerms: ['长痘', '痘痘', '痤疮', '皮疹', '湿疹', '荨麻疹', '红疹', '过敏', '皮肤痒', '起疹子', '粉刺', '毛囊炎', '脱皮'],
  requiredCoreFields: ['duration', 'location', 'associatedSymptoms'],
  riskProbeQuestions: [
    q('皮肤问题出现多久了？范围有没有快速扩大？', '快速扩散提示更高风险，需要先确认。', 'symptoms.duration'),
    q('主要长在什么部位？是粉刺、红疹、水疱、风团还是脓疱？', '皮损类型是区分方向的关键。', 'symptoms.location'),
    q('有没有觉得呼吸不舒服、脸或嘴唇肿、头晕？', '皮疹伴呼吸或面唇肿胀提示严重过敏反应，需要立即确认。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: ['RASH_WITH_ANAPHYLAXIS_SIGNS', 'RASH_RAPID_SPREAD_WITH_FEVER'],
  redFlagSignals: ['呼吸困难', '面部肿胀', '嘴唇肿', '喉咙紧', '头晕', '意识异常', '高热', '紫癜', '黏膜破溃', '大面积扩散', '流脓'],
  commonHypothesisSeeds: ['痤疮', '接触性皮炎', '湿疹样表现', '荨麻疹', '毛囊炎', '轻度过敏样皮疹'],
  searchQueryTemplates: [
    { query: '痤疮 接触性皮炎 荨麻疹 鉴别 何时就医', purpose: 'differential', language: 'zh', preferredSources: ['msdmanuals.cn', 'dxy.cn'] },
    { query: 'acne self care benzoyl peroxide salicylic acid', purpose: 'medication_boundary', language: 'en', preferredSources: ['nhs.uk'] },
  ],
  supportedDepth: 'full',
}

const chestPainDomain: SymptomDomainConfig = {
  domain: 'chest_pain',
  triggerTerms: ['胸痛', '胸口疼', '胸闷', '心口痛', '左胸痛', '胸口压', '心慌胸闷'],
  requiredCoreFields: ['duration', 'painQuality', 'severity', 'associatedSymptoms', 'relievingFactors'],
  riskProbeQuestions: [
    q('胸痛每次持续多久，是几秒、几分钟、十几分钟，还是一直不缓解？', '持续时间会影响心肺急症风险判断。', 'symptoms.duration'),
    q('胸口是压榨感、闷紧感，还是表面刺痛、针扎痛、烧灼感？', '疼痛性质有助于区分心源性、胸壁、反流等方向。', 'symptoms.painQuality'),
    q('有没有气短、冷汗、恶心、头晕、晕厥、明显心慌？', '这些伴随症状会显著提高急症风险。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: [
    'CHEST_PAIN_PERSISTENT_WITH_AUTONOMIC',
    'CHEST_PAIN_WITH_DYSPNEA',
    'CHEST_PAIN_WITH_SYNCOPE',
    'CHEST_PAIN_KEY_INFO_MISSING',
  ],
  redFlagSignals: ['气短', '呼吸困难', '冷汗', '恶心', '头晕', '晕厥', '明显心慌', '压榨感', '放射痛'],
  commonHypothesisSeeds: ['胸壁肌肉疼痛', '胃食管反流', '焦虑或过度换气相关不适', '心肌缺血或冠脉痉挛', '心肌炎或心律失常'],
  searchQueryTemplates: [
    { query: '胸痛 红旗信号 急诊 指征', purpose: 'red_flag', language: 'zh', preferredSources: ['msdmanuals.cn'] },
  ],
  supportedDepth: 'red_flag_only',
}

const headacheDomain: SymptomDomainConfig = {
  domain: 'headache',
  triggerTerms: ['头痛', '头疼', '偏头痛', '头胀', '脑袋疼'],
  requiredCoreFields: ['onsetPattern', 'severity', 'associatedSymptoms', 'duration'],
  riskProbeQuestions: [
    q('头痛是突然一下子达到最痛，还是慢慢加重的？', '突发剧烈头痛需要优先排除脑血管急症。', 'symptoms.onsetPattern'),
    q('有没有一侧手脚没力气、说话不清楚、看东西重影、抽搐？', '神经功能异常是必须立即确认的红旗信号。', 'symptoms.associatedSymptoms'),
    q('有没有发烧、脖子发硬、喷射样呕吐？', '这些伴随症状提示需要尽快线下评估。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: ['HEADACHE_SUDDEN_NEURO_DEFICIT', 'HEADACHE_THUNDERCLAP', 'HEADACHE_KEY_INFO_MISSING'],
  redFlagSignals: ['一侧无力', '单侧肢体无力', '口齿不清', '言语异常', '意识异常', '抽搐', '视物异常', '喷射样呕吐', '脖子发硬', '爆炸样'],
  commonHypothesisSeeds: ['紧张型头痛', '偏头痛', '睡眠不足相关头部不适', '鼻窦炎相关头痛'],
  searchQueryTemplates: [
    { query: '头痛 红旗 急诊指征 蛛网膜下腔出血', purpose: 'red_flag', language: 'zh', preferredSources: ['msdmanuals.cn'] },
  ],
  supportedDepth: 'red_flag_only',
}

const limbPainDomain: SymptomDomainConfig = {
  domain: 'limb_pain',
  triggerTerms: ['胳膊疼', '腿疼', '手臂痛', '关节疼', '肌肉酸痛', '腿肿', '手麻', '脚麻'],
  requiredCoreFields: ['location', 'duration', 'associatedSymptoms'],
  riskProbeQuestions: [
    q('疼的地方有没有红肿发热，或者单侧小腿明显肿胀？', '单侧肿胀疼痛需要排除血栓和感染。', 'symptoms.associatedSymptoms'),
    q('是活动后疼，还是休息时也疼？有没有越来越重？', '进展情况影响风险判断。', 'symptoms.progression'),
    q('有没有外伤、扭伤、摔倒？', '外伤史会改变判断方向。', 'symptoms.triggers'),
  ],
  redFlagRuleIds: ['LIMB_PAIN_WITH_SWELLING', 'LIMB_PAIN_KEY_INFO_MISSING'],
  redFlagSignals: ['单侧肿胀', '红肿发热', '无法活动', '麻木加重', '外伤', '畸形', '剧烈疼痛'],
  commonHypothesisSeeds: ['肌肉劳损', '颈椎或腰椎相关放射症状', '关节炎样表现'],
  searchQueryTemplates: [
    { query: '肢体疼痛 红旗 深静脉血栓 信号', purpose: 'red_flag', language: 'zh', preferredSources: ['msdmanuals.cn'] },
  ],
  supportedDepth: 'red_flag_only',
}

const feverDomain: SymptomDomainConfig = {
  domain: 'fever',
  triggerTerms: ['发烧', '发热', '低烧', '高烧', '体温高'],
  requiredCoreFields: ['duration', 'severity', 'associatedSymptoms'],
  riskProbeQuestions: [
    q('烧到多少度？烧了几天了？', '热度和持续时间是判断严重程度的关键。', 'symptoms.severity'),
    q('精神状态怎么样？有没有嗜睡、叫不醒、说胡话？', '精神状态明显异常是高危信号。', 'symptoms.associatedSymptoms'),
    q('有没有皮疹、脖子发硬、抽搐、呼吸急促？', '这些伴随症状需要优先确认。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: ['FEVER_WITH_ALTERED_MENTAL', 'FEVER_KEY_INFO_MISSING'],
  redFlagSignals: ['高热不退', '意识异常', '嗜睡', '抽搐', '脖子发硬', '呼吸急促', '皮疹', '说胡话'],
  commonHypothesisSeeds: ['病毒性上呼吸道感染', '流感样疾病', '胃肠型感染'],
  searchQueryTemplates: [
    { query: '发热 危险信号 何时就医 成人', purpose: 'red_flag', language: 'zh', preferredSources: ['msdmanuals.cn'] },
  ],
  supportedDepth: 'red_flag_only',
}

const generalDiscomfortDomain: SymptomDomainConfig = {
  domain: 'general_discomfort',
  triggerTerms: ['没力气', '乏力', '疲劳', '不舒服', '难受', '没精神', '头晕'],
  requiredCoreFields: ['duration', 'associatedSymptoms'],
  riskProbeQuestions: [
    q('这种感觉持续多久了？是突然出现还是慢慢出现的？', '起病方式影响方向判断。', 'symptoms.onsetPattern'),
    q('有没有伴随胸闷、心慌、发烧、明显体重下降？', '需要先排除提示全身性疾病的信号。', 'symptoms.associatedSymptoms'),
  ],
  redFlagRuleIds: ['GENERAL_KEY_INFO_MISSING'],
  redFlagSignals: ['晕厥', '意识异常', '胸闷', '呼吸困难', '明显体重下降'],
  commonHypothesisSeeds: ['睡眠不足或疲劳相关不适', '亚急性病毒感染恢复期', '贫血或甲状腺相关待排'],
  searchQueryTemplates: [],
  supportedDepth: 'red_flag_only',
}

export const SYMPTOM_DOMAIN_CONFIGS: SymptomDomainConfig[] = [
  chestPainDomain,
  headacheDomain,
  eyeDiscomfortDomain,
  skinMildDomain,
  throatRespiratoryDomain,
  gastrointestinalDomain,
  feverDomain,
  limbPainDomain,
  generalDiscomfortDomain,
]

export function getDomainConfig(domain: string): SymptomDomainConfig | undefined {
  return SYMPTOM_DOMAIN_CONFIGS.find((config) => config.domain === domain)
}
