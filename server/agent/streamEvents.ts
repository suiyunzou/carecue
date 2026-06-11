// 流式输出事件 — 展示"可审计分析过程"，不暴露模型原始思考链
// status: 当前在做什么；其余事件携带结构化的中间结果。

import type { RiskLevel } from './risk/riskLevel.ts'
import type { AgentResponse } from './agentResponse.ts'

export type AgentStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'extracted_facts'; facts: Array<{ label: string; value: string }> }
  | {
      type: 'risk_check'
      level: RiskLevel
      confirmed: string[]
      denied: string[]
      unresolved: string[]
      reason: string
    }
  | { type: 'search_query'; queries: string[] }
  | { type: 'search_result'; sources: Array<{ title: string; url: string; credibility: string }> }
  | {
      type: 'tool_step'
      phase: 'start' | 'done'
      toolName: string
      status?: 'success' | 'error'
      summary?: string
    }
  | { type: 'agent_decision'; action: string; reason: string }
  | { type: 'final'; response: AgentResponse }
  | { type: 'error'; message: string }

export type AgentStreamEmitter = (event: AgentStreamEvent) => void
