// 症状域识别 Prompt — v3.0 设计文档 §31.2

import type { CaseState } from '../../case/CaseState.ts'
import { SYMPTOM_DOMAINS } from '../../symptoms/symptomDomain.ts'

export function buildClassifySymptomDomainPrompt(state: CaseState) {
  const system = `你是问康 CareCue 的症状域识别助手。

可选症状域：${SYMPTOM_DOMAINS.join(', ')}

要求：
1. 只识别症状域，症状域只决定“下一步问什么、搜什么”。
2. 不输出风险等级，不输出疾病结论，不直接建议就医。
3. 如果无法识别，primaryDomain 输出 unknown。
4. reason 用一句话说明分类依据。

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    chiefComplaint: state.symptoms.chiefComplaint,
    userOriginalText: state.symptoms.userOriginalText.slice(-3),
    associatedSymptoms: state.symptoms.associatedSymptoms ?? [],
  })

  return { system, user }
}
