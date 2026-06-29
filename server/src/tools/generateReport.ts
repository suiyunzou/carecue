// generate_report：从 Workspace 读出结论，生成急症提示或非确诊护理报告。

import { GenerateReportInput, type FinalReport } from '../schemas/index.ts'
import type { Workspace } from '../agent/workspace.ts'
import type { Tool, ToolResult } from './types.ts'

const DISCLAIMER =
  '以上为基于你描述的护理参考，并非诊断或处方。若症状加重、反复或出现新的不适，请及时到医院由医生评估。'

function buildWatchFor(ws: Workspace): string[] {
  return ws.redFlags
    .filter((r) => r.severity !== 'low' && r.positiveSignals.length > 0)
    .map((r) => `${r.name}相关：${r.positiveSignals.slice(0, 3).join('、')}`)
}

function buildDoctorSummary(ws: Workspace, positiveName: string): string {
  const parts = [
    `主诉：${ws.symptoms.join('、') || '未明确'}`,
    `命中危险信号：${positiveName}`,
  ]
  const evidence = ws.redFlags.find((r) => r.name === positiveName)?.evidence
  if (evidence) parts.push(`患者描述：${evidence}`)
  return parts.join('；')
}

function render(report: FinalReport): string {
  const lines: string[] = []
  lines.push(`## 关于「${report.chiefComplaint}」的护理参考`)
  if (report.checked.length) lines.push(`\n已初步排查的危险方向：${report.checked.join('、')}。`)
  lines.push('\n### 日常护理建议')
  report.careAdvice.forEach((a) => lines.push(`- ${a}`))
  if (report.watchFor.length) {
    lines.push('\n### 出现以下情况请及时就医')
    report.watchFor.forEach((w) => lines.push(`- ${w}`))
  }
  lines.push('\n### 就医建议')
  lines.push(`- 紧迫程度：${report.referral.urgency}`)
  lines.push(`- 建议科室：${report.referral.department}`)
  lines.push(`- ${report.referral.advice}`)
  lines.push(`\n> ${report.disclaimer}`)
  return lines.join('\n')
}

export const generateReportTool: Tool<Record<string, never>> = {
  name: 'generate_report',
  description: '排查完成后从工作区生成最终报告：非确诊护理建议 + 就医提示；命中高危红旗时生成急症提示。',
  inputSchema: GenerateReportInput,
  spec: {
    name: 'generate_report',
    description: '排查完成后生成最终报告或急症提示。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  run(_input, ctx): ToolResult {
    const ws = ctx.workspace

    const positive = ws.positiveHighRiskRedFlag()
    if (positive) {
      const ref = ctx.knowledge.referral('red_flag_positive')
      return {
        ok: true,
        summary: `急症提示（${positive.name}）`,
        emergency: {
          content: `你描述的情况提示「${positive.name}」相关的危险信号。${ref.advice}`,
          doctorSummary: buildDoctorSummary(ws, positive.name),
          triggeredCombination: [positive.name, ...ws.symptoms],
        },
      }
    }

    const ref = ctx.knowledge.referral('all_ruled_out')
    const report: FinalReport = {
      chiefComplaint: ws.symptoms.join('、') || '不适',
      checked: ws.redFlags.filter((r) => r.status === 'ruled_out').map((r) => r.name),
      careAdvice: ctx.knowledge.carePlan(ws.symptoms),
      watchFor: buildWatchFor(ws),
      referral: { urgency: ref.urgency, advice: ref.advice, department: ref.department },
      disclaimer: DISCLAIMER,
    }
    return { ok: true, summary: '生成最终报告', report, rendered: render(report) }
  },
}
