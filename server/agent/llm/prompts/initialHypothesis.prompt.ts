// 初始假设生成 Prompt — v4.0
// 基于症状组合进行推理，不依赖搜索证据

import type { CaseState } from '../../case/CaseState.ts'

export function buildInitialHypothesisPrompt(state: CaseState) {
  const system = `你是问康 CareCue 的初步分析助手。

你的职责是：根据用户描述的症状组合，生成初步的疑似方向（假设）。
这是初始分析，还没有搜索医学证据，所有假设都基于症状推理。

要求：
1. 分析用户的症状组合（不是单个症状），考虑可能的疾病方向
2. 生成 2-4 个假设，按可能性排序
3. 每个假设必须有支持依据（从症状描述中提取）和反对依据/不确定点
4. 可能性未必最高但风险较高、需要优先排除的方向，likelihood 标记 must_rule_out
5. 标注还需要什么信息来区分这些假设（missingInfo）
6. 给出整体评估（stageConclusion），用普通用户能懂的语言
7. shouldAskUser / shouldSearchMore / shouldGenerateCarePlan / canFinalAnswer 根据实际情况设定
8. 不允许将症状等同于诊断，不允许给出确定结论

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    chiefComplaint: state.symptoms.chiefComplaint,
    userOriginalText: state.symptoms.userOriginalText,
    duration: state.symptoms.duration,
    location: state.symptoms.location,
    severity: state.symptoms.severity,
    frequency: state.symptoms.frequency,
    triggers: state.symptoms.triggers,
    relievingFactors: state.symptoms.relievingFactors,
    associatedSymptoms: state.symptoms.associatedSymptoms,
    negativeSymptoms: state.symptoms.negativeSymptoms,
    progression: state.symptoms.progression,
    userProfile: state.userProfile,
    symptomDomain: state.symptomDomain,
  })

  return { system, user }
}
