// MessageHistory 服务 — 记录用户 / 助手 / 工具消息（内存实现）

import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from './AgentMessage.ts'

export class MessageService {
  private messages = new Map<string, AgentMessage[]>()

  async appendUserMessage(input: { caseId: string; content: string }): Promise<UserMessage> {
    const message: UserMessage = {
      role: 'user',
      content: input.content,
      createdAt: new Date().toISOString(),
    }
    this.append(input.caseId, message)
    return message
  }

  async appendAssistantMessage(
    caseId: string,
    content: string,
    messageType: AssistantMessage['messageType'],
  ): Promise<AssistantMessage> {
    const message: AssistantMessage = {
      role: 'assistant',
      content,
      messageType,
      createdAt: new Date().toISOString(),
    }
    this.append(caseId, message)
    return message
  }

  async appendToolResult(caseId: string, message: ToolResultMessage): Promise<void> {
    this.append(caseId, { ...message, role: 'tool' })
  }

  async getContextMessages(caseId: string, limit = 20): Promise<AgentMessage[]> {
    return (this.messages.get(caseId) ?? []).slice(-limit)
  }

  async getAll(caseId: string): Promise<AgentMessage[]> {
    return this.messages.get(caseId) ?? []
  }

  private append(caseId: string, message: AgentMessage) {
    const list = this.messages.get(caseId) ?? []
    list.push(message)
    this.messages.set(caseId, list)
  }
}
