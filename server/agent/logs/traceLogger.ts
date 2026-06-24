// 全链路 Trace 日志 — v3.0 设计文档 §33
// 目标：白盒调试，能定位“是症状抽错了 / 红旗太敏感 / 搜索源污染 / 复核没拦住”等问题。

export type TraceEventType =
  | 'user_input'
  | 'symptom_extracted'
  | 'symptom_domain_classified'
  | 'state_merged'
  | 'risk_probe'
  | 'risk_assessed'
  | 'agent_decision'
  | 'tool_use'
  | 'tool_result'
  | 'search_queries'
  | 'sources_accepted'
  | 'sources_rejected'
  | 'evidence_extracted'
  | 'hypotheses_updated'
  | 'care_plan_generated'
  | 'question_guard'
  | 'final_guard'
  | 'medication_boundary_guard'
  | 'emergency_guard'
  | 'failure_recovery'
  | 'final_output'
  | 'llm_fallback'

/** 关键事件始终输出到控制台，便于对照 case-flow HTML 排查耗时 */
const KEY_EVENTS = new Set<TraceEventType>([
  'user_input',
  'agent_decision',
  'tool_use',
  'tool_result',
  'search_queries',
  'sources_accepted',
  'sources_rejected',
  'evidence_extracted',
  'failure_recovery',
  'final_output',
])

export interface TraceEvent {
  caseId: string
  stepIndex: number
  eventType: TraceEventType
  input?: unknown
  output?: unknown
  reason?: string
  createdAt: string
}

export type TracePayload = {
  input?: unknown
  output?: unknown
  reason?: string
}

export class TraceLogger {
  private traces = new Map<string, TraceEvent[]>()
  private verbose: boolean
  private caseStartTimes = new Map<string, number>()

  constructor(options?: { verbose?: boolean }) {
    this.verbose = options?.verbose ?? process.env.AGENT_TRACE_VERBOSE === 'true'
  }

  log(caseId: string, eventType: TraceEventType, payload: TracePayload = {}): TraceEvent {
    const events = this.traces.get(caseId) ?? []
    if (events.length === 0) {
      this.caseStartTimes.set(caseId, Date.now())
    }
    const event: TraceEvent = {
      caseId,
      stepIndex: events.length,
      eventType,
      input: payload.input,
      output: payload.output,
      reason: payload.reason,
      createdAt: new Date().toISOString(),
    }
    events.push(event)
    this.traces.set(caseId, events)

    if (this.verbose || KEY_EVENTS.has(eventType)) {
      this.printEvent(event, payload)
    }
    return event
  }

  private printEvent(event: TraceEvent, payload: TracePayload) {
    const prefix = caseIdShort(event.caseId)
    const elapsed = this.elapsedMs(event.caseId)
    const tag = `[Trace][${prefix}][#${event.stepIndex}][+${elapsed}ms]`

    switch (event.eventType) {
      case 'tool_use': {
        const toolName = (payload.input as { toolName?: string })?.toolName ?? 'unknown'
        console.log(`${tag} tool_use → ${toolName}`)
        break
      }
      case 'tool_result': {
        const toolName = (payload.input as { toolName?: string })?.toolName ?? 'unknown'
        const err = payload.reason?.includes('failed')
        console.log(`${tag} tool_result ← ${toolName}${err ? ' ✗' : ' ✓'}`, payload.reason ?? summarizeOutput(payload.output))
        break
      }
      case 'search_queries':
        console.log(`${tag} search`, summarizeOutput(payload.output))
        break
      case 'sources_accepted':
        console.log(`${tag} sources_accepted`, summarizeOutput(payload.output))
        break
      case 'evidence_extracted':
        console.log(`${tag} evidence_extracted`, payload.reason ?? summarizeOutput(payload.output))
        break
      case 'agent_decision': {
        const action = (payload.output as { action?: string })?.action ?? '?'
        console.log(`${tag} agent_decision → ${action}`, payload.reason ?? '')
        break
      }
      case 'failure_recovery':
        console.log(`${tag} failure_recovery`, payload.reason ?? '')
        break
      case 'final_output':
        console.log(`${tag} final_output`, payload.reason ?? '')
        break
      default:
        console.log(`${tag} ${event.eventType}`, payload.reason ?? '')
    }
  }

  private elapsedMs(caseId: string): number {
    const start = this.caseStartTimes.get(caseId) ?? Date.now()
    return Date.now() - start
  }

  logDecision(caseId: string, decision: unknown) {
    const d = decision as { action?: string; reason?: string }
    this.log(caseId, 'agent_decision', { output: decision, reason: d.reason })
  }

  logToolResult(caseId: string, payload: { toolName: string; input?: unknown; output?: unknown; statePatch?: unknown }) {
    // 工具的 toTrace 通常返回 { output, reason }，把 reason 提到顶层用于简洁的控制台输出
    const trace = payload.output as { reason?: unknown } | undefined
    const reason = typeof trace?.reason === 'string' ? trace.reason : undefined
    this.log(caseId, 'tool_result', {
      input: { toolName: payload.toolName, input: payload.input },
      output: { output: payload.output, statePatch: payload.statePatch },
      reason,
    })
  }

  getTrace(caseId: string): TraceEvent[] {
    return this.traces.get(caseId) ?? []
  }

  clear(caseId: string) {
    this.traces.delete(caseId)
    this.caseStartTimes.delete(caseId)
  }
}

function caseIdShort(caseId: string) {
  return caseId.slice(0, 8)
}

function summarizeOutput(output: unknown): string {
  if (output == null) return ''
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}
