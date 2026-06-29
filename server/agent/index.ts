// CareCue Agent 模块入口 — 运行时装配
// 用法：
//   const runtime = createCareCueAgentRuntime()
//   const response = await runtime.run({ caseId, userId, userMessage })

import { TraceLogger } from './logs/traceLogger.ts'
import { CaseStateService, InMemoryCaseStore, type CaseStore } from './case/caseStateService.ts'
import { MessageService } from './messages/messageService.ts'
import { ToolRegistry } from './tools/ToolRegistry.ts'
import { ToolExecutor } from './tools/ToolExecutor.ts'
import { SearchPipeline } from './search/searchPipeline.ts'
import { createCareCueLlmClient, type LlmClient } from './llm/llmClient.ts'
import { createFirecrawlSearchClient, type SearchClient } from './search/medicalSearchTool.ts'
import { runCareCueAgent, type AgentRuntimeDeps, type RunAgentInput } from './agentLoop.ts'
import type { AgentResponse } from './agentResponse.ts'

import { symptomExtractTool } from './symptoms/symptomExtractor.ts'
import { symptomDomainClassifyTool } from './symptoms/symptomDomainClassifier.ts'
import { riskProbeTool } from './risk/riskProbe.ts'
import { riskAssessTool } from './risk/riskAssessor.ts'
import { caseAnalyzeTool } from './analysis/caseAnalyzer.ts'
import { carePlanGenerateTool } from './analysis/carePlanGenerator.ts'
import { riskProbeQuestionTool, followupQuestionTool, hypothesisQuestionTool } from './question/followupGenerator.ts'
import { reportGenerateTool } from './report/reportGenerator.ts'
import { initialHypothesisTool } from './hypothesis/hypothesisGenerator.ts'
import { hypothesisRefineTool } from './hypothesis/hypothesisRefiner.ts'

export type { AgentResponse } from './agentResponse.ts'
export type { CaseState } from './case/CaseState.ts'
export type { RunAgentInput } from './agentLoop.ts'
export type { AgentStreamEvent, AgentStreamEmitter } from './streamEvents.ts'

export interface CareCueAgentRuntime {
  run(input: RunAgentInput): Promise<AgentResponse>
  getDebugInfo(caseId: string): Promise<{
    state: unknown
    trace: unknown[]
    messages: unknown[]
  }>
}

export interface CreateRuntimeOptions {
  llm?: LlmClient
  search?: SearchClient
  caseStore?: CaseStore
  traceLogger?: TraceLogger
}

export function createCareCueAgentRuntime(options: CreateRuntimeOptions = {}): CareCueAgentRuntime {
  const traceLogger = options.traceLogger ?? new TraceLogger()
  const llm = options.llm ?? createCareCueLlmClient()
  const search = options.search ?? createFirecrawlSearchClient()

  const caseStateService = new CaseStateService(options.caseStore ?? new InMemoryCaseStore(), traceLogger)
  const messageService = new MessageService()

  const registry = new ToolRegistry()
  registry.register(symptomExtractTool)
  registry.register(symptomDomainClassifyTool)
  registry.register(riskProbeTool)
  registry.register(riskAssessTool)
  registry.register(caseAnalyzeTool)
  registry.register(carePlanGenerateTool)
  registry.register(riskProbeQuestionTool)
  registry.register(followupQuestionTool)
  registry.register(reportGenerateTool)
  registry.register(initialHypothesisTool)
  registry.register(hypothesisRefineTool)
  registry.register(hypothesisQuestionTool)

  const toolExecutor = new ToolExecutor(registry, traceLogger)
  const searchPipeline = new SearchPipeline(search, llm, traceLogger)

  const deps: AgentRuntimeDeps = {
    caseStateService,
    messageService,
    toolExecutor,
    searchPipeline,
    traceLogger,
    llm,
    search,
  }

  // 同一 case 的连续重复输入只处理一次（幂等）：双击发送/超时重发不会重复跑整条链路
  const lastTurns = new Map<string, { message: string; response: AgentResponse }>()

  return {
    async run(input: RunAgentInput): Promise<AgentResponse> {
      const normalizedMessage = input.userMessage.trim()
      if (input.caseId) {
        const last = lastTurns.get(input.caseId)
        if (last && last.message === normalizedMessage) {
          traceLogger.log(input.caseId, 'user_input', {
            reason: 'duplicate_user_message_deduped',
            input: { message: normalizedMessage },
          })
          input.onEvent?.({ type: 'status', message: '检测到与上一条相同的消息，直接返回上一次的分析结果。' })
          return last.response
        }
      }

      const response = await runCareCueAgent(input, deps)
      lastTurns.set(response.caseId, { message: normalizedMessage, response })
      return response
    },

    async getDebugInfo(caseId: string) {
      return {
        state: await caseStateService.get(caseId),
        trace: traceLogger.getTrace(caseId),
        messages: await messageService.getAll(caseId),
      }
    },
  }
}
