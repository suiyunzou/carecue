// ToolExecutor — v3.0 设计文档 §18
// 职责：输入校验 -> guard -> 超时执行 -> 输出校验 -> statePatch -> trace

import { randomUUID } from 'node:crypto'
import type { CaseState } from '../case/CaseState.ts'
import type { ToolResultMessage } from '../messages/AgentMessage.ts'
import type { TraceLogger } from '../logs/traceLogger.ts'
import type { AgentFailureCode } from '../failureRecovery.ts'
import type { ToolContext } from './Tool.ts'
import { withTimeout } from './Tool.ts'
import type { ToolRegistry } from './ToolRegistry.ts'

export type ToolExecutionResult<O> =
  | {
      status: 'success'
      output: O
      statePatch: Partial<CaseState>
      message: ToolResultMessage
    }
  | {
      status: 'error'
      output: undefined
      statePatch: Partial<CaseState>
      message: ToolResultMessage
    }

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private traceLogger: TraceLogger,
  ) {}

  async run<O = unknown>(toolName: string, input: unknown, ctx: ToolContext): Promise<ToolExecutionResult<O>> {
    const tool = this.registry.get(toolName)

    this.traceLogger.log(ctx.caseId, 'tool_use', { input: { toolName, input } })

    const parsedInput = tool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      return this.fail({
        caseId: ctx.caseId,
        toolName,
        code: 'TOOL_INPUT_INVALID',
        message: parsedInput.error.message,
        recoverable: true,
      })
    }

    const guardResult = tool.guard(parsedInput.data, ctx.state)
    if (!guardResult.allowed) {
      return this.fail({
        caseId: ctx.caseId,
        toolName,
        code: guardResult.failureCode,
        message: guardResult.reason,
        recoverable: true,
      })
    }

    try {
      const output = await withTimeout(tool.call(parsedInput.data, ctx), tool.timeoutMs)

      const parsedOutput = tool.outputSchema.safeParse(output)
      if (!parsedOutput.success) {
        return this.fail({
          caseId: ctx.caseId,
          toolName,
          code: 'TOOL_OUTPUT_INVALID',
          message: parsedOutput.error.message,
          recoverable: true,
        })
      }

      const statePatch = tool.toStatePatch(parsedOutput.data, ctx.state)

      const message: ToolResultMessage = {
        toolUseId: randomUUID(),
        toolName,
        status: 'success',
        output: parsedOutput.data,
        statePatch,
        createdAt: new Date().toISOString(),
      }

      this.traceLogger.logToolResult(ctx.caseId, {
        toolName,
        input: parsedInput.data,
        output: tool.toTrace(parsedOutput.data),
        statePatch,
      })

      return {
        status: 'success',
        output: parsedOutput.data as O,
        statePatch,
        message,
      }
    } catch (error) {
      return this.fail({
        caseId: ctx.caseId,
        toolName,
        code: 'TOOL_RUNTIME_ERROR',
        message: String(error),
        recoverable: true,
      })
    }
  }

  private fail(input: {
    caseId: string
    toolName: string
    code: AgentFailureCode
    message: string
    recoverable: boolean
  }): ToolExecutionResult<never> {
    const message: ToolResultMessage = {
      toolUseId: randomUUID(),
      toolName: input.toolName,
      status: 'error',
      error: {
        code: input.code,
        message: input.message,
        recoverable: input.recoverable,
      },
      createdAt: new Date().toISOString(),
    }

    this.traceLogger.log(input.caseId, 'tool_result', {
      input: { toolName: input.toolName },
      output: message.error,
      reason: `tool failed: ${input.code}`,
    })

    return {
      status: 'error',
      output: undefined,
      statePatch: {},
      message,
    }
  }
}
