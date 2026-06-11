// 聊天会话持久化 — 参考 Claude Code 的追加式会话存储（append-only session storage）
//
// 两层数据：
// 1. ChatSession.caseState：Agent 工作区（CaseState）快照 —— 服务重启后可继续推理；
// 2. ChatMessage：展示层消息（用户输入 / 助手回复 + 追问/引用/过程事件 payload）——
//    页面刷新或从历史进入时还原完整对话，且不重新消耗 LLM token。

import type { PrismaClient, Prisma } from './generated/prisma/client.ts'
import type { CaseState } from './agent/index.ts'
import type { CaseStore } from './agent/case/caseStateService.ts'
import type { AgentResponse, AgentStreamEvent } from './agent/index.ts'

/** CaseState 的 Prisma 持久化实现；无 userId（理论上不会发生）时退回内存存储 */
export class PrismaCaseStore implements CaseStore {
  private memoryFallback = new Map<string, { state: CaseState; version: number }>()

  constructor(private prisma: PrismaClient) {}

  async get(caseId: string): Promise<{ state: CaseState; version: number } | undefined> {
    const row = await this.prisma.chatSession.findUnique({
      where: { id: caseId },
      select: { caseState: true, stateVersion: true },
    })
    if (row?.caseState) {
      return { state: row.caseState as unknown as CaseState, version: row.stateVersion }
    }
    return this.memoryFallback.get(caseId)
  }

  async save(caseId: string, state: CaseState, version: number): Promise<void> {
    if (!state.userId) {
      this.memoryFallback.set(caseId, { state, version })
      return
    }

    const title = (state.symptoms.chiefComplaint || '').slice(0, 60)
    const caseState = toJson(state)
    await this.prisma.chatSession.upsert({
      where: { id: caseId },
      create: {
        id: caseId,
        userId: state.userId,
        title: title || '新咨询',
        status: state.status,
        riskLevel: state.risk.level,
        caseState,
        stateVersion: version,
      },
      update: {
        status: state.status,
        riskLevel: state.risk.level,
        caseState,
        stateVersion: version,
        ...(title ? { title } : {}),
      },
    })
  }
}

/** 助手回复的主展示文本（与前端渲染保持一致的来源字段） */
function responseMainText(response: AgentResponse): string {
  switch (response.type) {
    case 'followup':
      return response.intro
    case 'emergency':
      return response.content
    case 'final_report':
      return response.rendered
    case 'stage_report':
      return response.content
  }
}

/** 助手回复的结构化 payload：还原追问列表、引用脚注、分析过程所需的全部数据 */
function responsePayload(response: AgentResponse, events: AgentStreamEvent[]): Prisma.InputJsonValue {
  const base: Record<string, unknown> = {
    citations: response.citations,
    events,
  }
  if (response.type === 'followup') {
    base.mode = response.mode
    base.questions = response.questions
  }
  if (response.type === 'emergency') {
    base.doctorSummary = response.doctorSummary
    base.triggeredCombination = response.triggeredCombination
  }
  return toJson(base)
}

/** 一轮对话落库：用户消息 + 助手回复（含过程事件），并刷新会话标题/状态 */
export async function persistChatTurn(
  prisma: PrismaClient,
  input: {
    userId: string
    userMessage: string
    response: AgentResponse
    events?: AgentStreamEvent[]
  },
): Promise<void> {
  const caseId = input.response.caseId
  const title = (input.response.stateSnapshot.chiefComplaint || input.userMessage).slice(0, 60)

  // PrismaCaseStore 在 Agent 运行期间已创建会话行；这里兜底 upsert 防止竞态
  await prisma.chatSession.upsert({
    where: { id: caseId },
    create: {
      id: caseId,
      userId: input.userId,
      title,
      status: 'active',
      riskLevel: input.response.riskLevel,
    },
    update: { title, riskLevel: input.response.riskLevel },
  })

  await prisma.chatMessage.create({
    data: { sessionId: caseId, role: 'user', content: input.userMessage },
  })
  await prisma.chatMessage.create({
    data: {
      sessionId: caseId,
      role: 'assistant',
      kind: input.response.type,
      content: responseMainText(input.response),
      payload: responsePayload(input.response, input.events ?? []),
    },
  })
}

/** 可持久化的过程事件（排除 final/error，体积可控） */
export function isPersistableEvent(event: AgentStreamEvent): boolean {
  return event.type !== 'final' && event.type !== 'error'
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
