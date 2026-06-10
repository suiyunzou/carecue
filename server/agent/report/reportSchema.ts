// 最终报告固定结构 — v3.0 设计文档 §27
// 一、当前结论 ... 十二、医生沟通摘要

import { z } from 'zod'

export const reportHypothesisSchema = z.object({
  name: z.string(),
  likelihood: z.enum(['more_likely', 'possible', 'less_likely', 'must_rule_out']),
  supportEvidence: z.array(z.string()),
  againstEvidence: z.array(z.string()),
  uncertainties: z.array(z.string()),
})

export const finalReportSchema = z.object({
  /** 一、当前结论：阶段判断，不确诊，不夸大，不淡化 */
  currentConclusion: z.string(),
  /** 二、风险分级与理由 */
  riskLevel: z.enum(['R0', 'R1', 'R2', 'R3']),
  riskReason: z.string(),
  deniedRedFlags: z.array(z.string()),
  unresolvedRedFlags: z.array(z.string()),
  /** 三、疑似疾病方向排序（含四、五：支持依据 / 反对依据和不确定点） */
  hypotheses: z.array(reportHypothesisSchema),
  /** 六、你现在可以先做什么 */
  selfCareAdvice: z.array(z.string()),
  /** 七、可以关注的非处方成分方向 */
  otcIngredientOptions: z.array(
    z.object({
      ingredientCategory: z.string(),
      suitableFor: z.string(),
      caution: z.string(),
    }),
  ),
  /** 八、暂时不要做什么 */
  avoidActions: z.array(z.string()),
  /** 九、什么情况需要就医或急诊 */
  seekCareWhen: z.array(z.string()),
  /** 十、建议就诊科室 */
  departmentSuggestion: z.string(),
  /** 十一、建议向医生确认的问题 */
  questionsForDoctor: z.array(z.string()),
  /** 十二、医生沟通摘要 */
  doctorSummary: z.string(),
  /** 不确定性说明 */
  uncertaintyNote: z.string(),
  /** 引用来源（标题 + URL），只允许来自 evidence */
  references: z.array(z.object({ title: z.string(), url: z.string() })),
})

export type FinalReport = z.infer<typeof finalReportSchema>

export type ReportGenerateOutput = FinalReport
