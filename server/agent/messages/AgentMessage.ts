// MessageHistory 消息类型 — v3.0 设计文档 §5 / §18

import type { CaseState } from '../case/CaseState.ts'
import type { AgentFailureCode } from '../failureRecovery.ts'

export type UserMessage = {
  role: 'user'
  content: string
  createdAt: string
}

export type AssistantMessage = {
  role: 'assistant'
  content: string
  messageType: 'followup' | 'final_report' | 'stage_report' | 'emergency'
  createdAt: string
}

export type ToolResultMessage = {
  role?: 'tool'
  toolUseId: string
  toolName: string
  status: 'success' | 'error'
  output?: unknown
  statePatch?: Partial<CaseState>
  error?: {
    code: AgentFailureCode
    message: string
    recoverable: boolean
  }
  createdAt: string
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage

export function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
  return 'toolName' in message
}
