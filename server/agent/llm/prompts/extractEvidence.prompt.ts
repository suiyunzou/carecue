// 证据抽取 Prompt — v3.0 设计文档 §31.6

import type { CaseState } from '../../case/CaseState.ts'

export function buildExtractEvidencePrompt(
  page: { title: string; url: string; markdown: string },
  state: CaseState,
) {
  const system = `你是问康 CareCue 的医学证据抽取助手。

要求：
1. 只从给定来源页面抽取，不补充来源之外的医学知识。
2. 不把广告内容作为依据，必须标注来源 URL。
3. 提取典型症状、鉴别点、红旗信号、就医建议、日常护理、用药边界。
4. 必须说明适用条件（年龄段、性别、孕期、急慢性、严重程度），不确定时填 unknown 或 null。
5. 不确定内容不能写成确定事实。
6. 药物相关内容必须区分“成分方向”和“处方建议”，不抽取具体剂量作为用户建议，不把处方药当成普通建议。
7. summary 控制在 200 字以内。

只返回符合 JSON Schema 的 JSON。`

  const user = JSON.stringify({
    source: {
      title: page.title,
      url: page.url,
      content: page.markdown,
    },
    caseContext: {
      symptomDomain: state.symptomDomain.primaryDomain,
      chiefComplaint: state.symptoms.chiefComplaint,
      hypotheses: state.hypotheses.map((h) => h.name),
    },
  })

  return { system, user }
}
