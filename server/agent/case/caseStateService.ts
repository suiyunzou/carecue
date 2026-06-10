// CaseState 服务 — 串行合并 + 版本管理
// 存储抽象：默认内存实现（P0），后续可替换为 Prisma/PostgreSQL（见 db/schema.sql）。

import { randomUUID } from 'node:crypto'
import type { CaseState, CaseStateUpdateOutput, FollowupQuestion } from './CaseState.ts'
import { createInitialCaseState } from './CaseState.ts'
import { mergeCaseState } from './caseStateMerger.ts'
import type { TraceLogger } from '../logs/traceLogger.ts'

export interface CaseStore {
  get(caseId: string): Promise<{ state: CaseState; version: number } | undefined>
  save(caseId: string, state: CaseState, version: number): Promise<void>
}

export class InMemoryCaseStore implements CaseStore {
  private cases = new Map<string, { state: CaseState; version: number }>()

  async get(caseId: string) {
    return this.cases.get(caseId)
  }

  async save(caseId: string, state: CaseState, version: number) {
    this.cases.set(caseId, { state, version })
  }
}

export class CaseStateService {
  /** 同一 case 的合并必须串行（§20.1），用 promise 链做轻量队列 */
  private mergeQueues = new Map<string, Promise<unknown>>()

  constructor(
    private store: CaseStore,
    private traceLogger: TraceLogger,
  ) {}

  async loadOrCreate(caseId: string | undefined, userId?: string): Promise<CaseState> {
    if (caseId) {
      const existing = await this.store.get(caseId)
      if (existing) return existing.state
    }
    const id = caseId ?? randomUUID()
    const state = createInitialCaseState(id, userId)
    await this.store.save(id, state, 1)
    return state
  }

  async get(caseId: string): Promise<CaseState | undefined> {
    return (await this.store.get(caseId))?.state
  }

  async merge(
    caseId: string,
    input: {
      patch: Partial<CaseState>
      updateReason: string
      source: 'user' | 'llm' | 'tool' | 'system'
    },
  ): Promise<CaseState> {
    const result = await this.enqueue(caseId, async () => {
      const record = await this.store.get(caseId)
      if (!record) {
        throw new Error(`Case not found: ${caseId}`)
      }

      const { state, changedFields } = mergeCaseState(record.state, input.patch, input.source)
      const version = record.version + 1
      await this.store.save(caseId, state, version)

      this.traceLogger.log(caseId, 'state_merged', {
        input: { updateReason: input.updateReason, source: input.source },
        output: { changedFields, version },
        reason: input.updateReason,
      })

      const output: CaseStateUpdateOutput = {
        caseId,
        updatedState: state,
        changedFields,
        version,
      }
      return output
    })

    return result.updatedState
  }

  async recordAskedQuestions(caseId: string, questions: FollowupQuestion[]): Promise<CaseState> {
    return this.merge(caseId, {
      patch: {
        askedQuestions: questions,
        status: 'waiting_user',
        meta: { followupRounds: ((await this.get(caseId))?.meta.followupRounds ?? 0) + 1 } as CaseState['meta'],
      },
      updateReason: 'asked_questions_recorded',
      source: 'system',
    })
  }

  private enqueue<T>(caseId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.mergeQueues.get(caseId) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.mergeQueues.set(caseId, next.catch(() => undefined))
    return next
  }
}
