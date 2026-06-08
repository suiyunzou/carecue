import { getScenario, type ConsultationAnswer, type ScenarioKey, type RuleResult } from './rules.ts'

export type AiChatMessage = {
  role: 'assistant' | 'user'
  content: string
}

export function buildAiMessages(input: {
  answers: ConsultationAnswer[]
  chatMessages?: AiChatMessage[]
  chiefComplaint: string
  ruleResult: RuleResult
  scenario: ScenarioKey
}) {
  return [
    {
      role: 'system' as const,
      content: [
        '你是问康 CareCue 的就医前信息整理助手。',
        '你的职责是整理信息、解释可能方向、指出缺失信息和下一步行动，不做确诊。',
        '必须使用清楚、克制、易懂、可信的中文。',
        '不要使用“确诊”“一定是”“肯定是”等确定诊断措辞。',
        '不要给出药物剂量、处方、停药或换药建议。',
        '红旗规则优先于普通分析。如果规则结果为 A 级，不允许弱化为居家观察。',
        '如果提供了聊天记录，必须把用户后续补充也纳入最终报告。',
        '如果启用了联网搜索，只能把搜索结果作为背景核查依据，不能把搜索摘要当作确诊结论。',
        '只返回符合 JSON Schema 的 JSON，不要返回 Markdown 或额外说明。',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        task: '基于结构化症状信息生成阶段 3 AI 综合分析结果。',
        userInput: {
          chiefComplaint: input.chiefComplaint,
          scenario: getScenario(input.scenario)?.name ?? input.scenario,
          answers: input.answers.map((answer) => ({
            questionKey: answer.questionKey,
            questionText: answer.questionText,
            answerText: answer.answerText || '未说明',
          })),
          chatMessages: input.chatMessages ?? [],
        },
        ruleResult: input.ruleResult,
        outputRules: [
          'aiStatus 必须为 success。',
          'possibleDirections 返回 2-4 项，每项包含 title、support、caution、suggestedAction。',
          'missingInformation 没有明显缺失时返回空数组。',
          'departmentSuggestion 可以优化规则科室，但 A 级风险不得覆盖急诊优先。',
          'dailyAdvice 不得包含药物剂量、处方、停药、换药建议。',
          'doctorSummary 要适合复制给医生，必须客观、克制，不写确诊结论。',
          'safetyFlags 必须包含红旗风险或线上信息限制。',
          'sourceReferences 只填写真实联网搜索返回或你确信来自上下文的来源；没有来源时返回空数组。',
        ],
      }),
    },
  ]
}

export function buildChatMessages(input: {
  answers: ConsultationAnswer[]
  chatMessages: AiChatMessage[]
  chiefComplaint: string
  ruleResult: RuleResult
  scenario: ScenarioKey
}) {
  return [
    {
      role: 'system' as const,
      content: [
        '你是问康 CareCue 的就医前 AI 追问与核查助手。',
        '用户已经完成结构化问卷，现在进入聊天补充阶段。',
        '你的任务是：基于已有信息继续澄清关键缺口、解释风险边界、提醒红旗症状，并为最终报告收集信息。',
        '不要输出“确诊”“一定是”“肯定是”等确定诊断表达。',
        '不要给出药物剂量、处方、停药或换药建议。',
        '如果用户问“我到底是什么病”，回答为“目前只能整理可能方向和需要排查项，不能线上确诊”。',
        '回复要短，优先 2-5 句；一次最多追问 2 个关键问题。',
        '如果信息已经足够，可以建议用户点击“生成分析报告”。',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        task: '开始聊天前的结构化病情资料。',
        chiefComplaint: input.chiefComplaint,
        scenario: getScenario(input.scenario)?.name ?? input.scenario,
        answers: input.answers.map((answer) => ({
          questionText: answer.questionText,
          answerText: answer.answerText || '未说明',
        })),
        ruleResult: input.ruleResult,
      }),
    },
    ...input.chatMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ]
}
