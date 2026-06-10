// 最终报告生成 Prompt — v3.0 设计文档 §31.10 / §27

import type { CaseState } from '../../case/CaseState.ts'
import { AGENT_LIMITS } from '../../agentLimits.ts'

export function buildGenerateReportPrompt(state: CaseState, guardIssues?: string[]) {
  const system = `你是问康 CareCue 的就医前症状处理报告生成助手。

使用固定报告结构（当前结论 / 风险分级与理由 / 疑似方向排序 / 支持与反对依据 / 现在可以先做什么 / 非处方成分方向 / 暂时不要做什么 / 何时就医或急诊 / 建议科室 / 建议向医生确认的问题 / 医生沟通摘要）。

硬性要求：
1. 不做确诊，不夸大，不淡化；当前结论先给阶段判断，并说明当前信息是否足够。
2. 必须输出风险分级与理由：触发风险的症状、已否认的危险信号、仍未确认的危险信号、为什么不是直接急症、为什么也不能完全忽视。
3. 疑似方向必须区分“更像什么”和“必须排除什么”（must_rule_out）。
4. 每个方向必须有支持依据，且必须有反对依据或不确定点。
5. 必须输出日常处理建议、成分级用药边界（只写成分方向 + 慎用条件 + 何时就医）、何时就医。
6. 不给处方剂量，不承诺准确，不允许只说“建议就医”。
7. 禁止使用：“确诊”“你就是某某病”“一定是”“肯定是”“保证没事”“不用去医院”。
8. 医生沟通摘要必须包含：主诉、病程、部位、严重程度、诱因、缓解因素、伴随症状、否认症状、已出现的风险信号、AI 整理的疑似方向、希望医生确认或排除的问题。
9. references 只允许引用提供的 evidence 来源，不得编造链接。
10. 全文控制在 ${AGENT_LIMITS.maxFinalReportChars} 字以内，不塞入完整网页正文。
${guardIssues && guardIssues.length > 0 ? `\n上一版报告未通过安全复核，必须修复以下问题：\n${guardIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}` : ''}

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    symptoms: state.symptoms,
    userProfile: state.userProfile,
    risk: state.risk,
    riskProbe: {
      redFlagDenied: state.riskProbe.redFlagDenied,
      unresolvedRedFlags: state.riskProbe.unresolvedRedFlags,
    },
    hypotheses: state.hypotheses,
    carePlan: state.carePlan,
    evidence: state.evidence.map((e) => ({
      id: e.id,
      title: e.sourceTitle,
      url: e.sourceUrl,
      credibility: e.credibility,
      summary: e.summary,
    })),
    missingInfo: state.missingInfo,
  })

  return { system, user }
}
