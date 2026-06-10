// Agent 主循环 — v3.0 设计文档 §15
// 用户输入 -> 症状抽取 -> 症状域识别 -> 风险核查 -> 红旗评估
// -> AgentDecision -> 工具执行 -> 证据回写 -> 分析 -> 处理建议 -> 追问/报告/急症

import type { FollowupQuestion } from './case/CaseState.ts'
import type { CaseStateService } from './case/caseStateService.ts'
import type { MessageService } from './messages/messageService.ts'
import type { ToolExecutor } from './tools/ToolExecutor.ts'
import type { ToolContext } from './tools/Tool.ts'
import type { TraceLogger } from './logs/traceLogger.ts'
import type { LlmClient } from './llm/llmClient.ts'
import type { SearchClient } from './search/medicalSearchTool.ts'
import type { SearchPipeline } from './search/searchPipeline.ts'
import type { AgentResponse } from './agentResponse.ts'
import type { MedicalSearchTask } from './actionSchema.ts'
import { AGENT_LIMITS, agentLimitGuard } from './agentLimits.ts'
import { decideAction } from './decideAction.ts'
import { FailureRecovery } from './failureRecovery.ts'
import { EmergencyResponder } from './safety/emergencyOutputGuard.ts'
import { medicationBoundaryGuard } from './safety/medicationBoundaryGuard.ts'
import { finalAnswerGuard } from './safety/finalAnswerGuard.ts'
import { questionGuard } from './question/questionGuard.ts'
import { reportRenderer } from './report/reportRenderer.ts'
import { buildTemplateReport } from './report/reportGenerator.ts'
import { generateSearchTasks } from './search/searchTaskGenerator.ts'
import { isToolResultMessage } from './messages/AgentMessage.ts'
import type { FollowupOutput } from './question/followupGenerator.ts'
import type { CaseAnalyzeOutput } from './analysis/hypothesisSchema.ts'
import type { FinalReport } from './report/reportSchema.ts'
import type { CarePlan } from './case/CaseState.ts'
import type { AgentStreamEmitter } from './streamEvents.ts'
import { buildKnownFacts } from './case/stateFields.ts'

export interface AgentRuntimeDeps {
  caseStateService: CaseStateService
  messageService: MessageService
  toolExecutor: ToolExecutor
  searchPipeline: SearchPipeline
  traceLogger: TraceLogger
  llm: LlmClient
  search: SearchClient
}

export interface RunAgentInput {
  caseId?: string
  userId?: string
  userMessage: string
  /** 可选：流式过程事件（SSE）。只发"可审计过程"，不发原始思考链。 */
  onEvent?: AgentStreamEmitter
}

export async function runCareCueAgent(
  input: RunAgentInput,
  deps: AgentRuntimeDeps,
): Promise<AgentResponse> {
  const { caseStateService, messageService, toolExecutor, searchPipeline, traceLogger, llm, search } = deps
  const failureRecovery = new FailureRecovery(traceLogger)
  const emergencyResponder = new EmergencyResponder(traceLogger)
  const emit = input.onEvent ?? (() => undefined)

  let state = await caseStateService.loadOrCreate(input.caseId, input.userId)
  const caseId = state.caseId

  traceLogger.log(caseId, 'user_input', { input: input.userMessage })
  await messageService.appendUserMessage({ caseId, content: input.userMessage })
  state = await caseStateService.merge(caseId, {
    patch: { status: 'active', meta: { ...state.meta, lastUserMessageAt: new Date().toISOString() } },
    updateReason: 'user_message_received',
    source: 'user',
  })

  const buildCtx = (): ToolContext => ({
    caseId,
    userId: input.userId,
    state,
    traceLogger,
    llm,
    search,
  })

  // ---- 阶段 1：症状抽取 ----
  emit({ type: 'status', message: '正在提取症状信息...' })
  const extracted = await toolExecutor.run('symptom.extract', { userMessage: input.userMessage }, buildCtx())
  if (extracted.status === 'success') {
    await messageService.appendToolResult(caseId, extracted.message)
    state = await caseStateService.merge(caseId, {
      patch: extracted.statePatch,
      updateReason: 'symptom_extracted',
      source: 'llm',
    })
    traceLogger.log(caseId, 'symptom_extracted', { output: extracted.output })
    emit({ type: 'extracted_facts', facts: buildKnownFacts(state) })
  }

  // ---- 阶段 2：症状域识别 ----
  const domainResult = await toolExecutor.run('symptom.domain_classify', {}, buildCtx())
  if (domainResult.status === 'success') {
    state = await caseStateService.merge(caseId, {
      patch: domainResult.statePatch,
      updateReason: 'symptom_domain_classified',
      source: 'llm',
    })
    traceLogger.log(caseId, 'symptom_domain_classified', { output: domainResult.output })
  }

  // ---- 阶段 3：风险核查 ----
  emit({ type: 'status', message: '正在检查危险信号...' })
  const riskProbeResult = await toolExecutor.run('risk.probe', {}, buildCtx())
  if (riskProbeResult.status === 'success') {
    state = await caseStateService.merge(caseId, {
      patch: riskProbeResult.statePatch,
      updateReason: 'risk_probe_completed',
      source: 'system',
    })
    traceLogger.log(caseId, 'risk_probe', { output: riskProbeResult.output })
  }

  // ---- 阶段 4：红旗规则评估 ----
  const riskResult = await toolExecutor.run('risk.red_flag_assess', {}, buildCtx())
  if (riskResult.status === 'success') {
    state = await caseStateService.merge(caseId, {
      patch: riskResult.statePatch,
      updateReason: 'risk_assessed',
      source: 'system',
    })
    traceLogger.log(caseId, 'risk_assessed', { output: riskResult.output })
    emit({
      type: 'risk_check',
      level: state.risk.level,
      confirmed: state.riskProbe.redFlagConfirmed,
      denied: state.riskProbe.redFlagDenied,
      unresolved: state.riskProbe.unresolvedRedFlags,
      reason: state.risk.reason,
    })
  }

  // ---- R3：急症直接输出 ----
  if (state.risk.level === 'R3') {
    state = await caseStateService.merge(caseId, {
      patch: { status: 'emergency' },
      updateReason: 'emergency_confirmed',
      source: 'system',
    })
    const response = await emergencyResponder.respond(state)
    await messageService.appendAssistantMessage(caseId, response.content, 'emergency')
    return response
  }

  // ---- R2 且关键红旗未确认：优先风险核查追问 ----
  if (state.risk.level === 'R2' && state.riskProbe.unresolvedRedFlags.length > 0 && state.riskProbe.probeStatus === 'in_progress') {
    const questionsResult = await toolExecutor.run<FollowupOutput>('question.generate_risk_probe', {}, buildCtx())

    if (questionsResult.status === 'success') {
      const checked = questionGuard.validate(toFollowups(questionsResult.output.questions, 'risk_probe'), state)
      traceLogger.log(caseId, 'question_guard', {
        output: { kept: checked.questions.map((q) => q.question), dropped: checked.dropped },
      })

      if (checked.questions.length > 0) {
        state = await caseStateService.recordAskedQuestions(caseId, checked.questions)
        const response = reportRenderer.renderFollowup({
          state,
          questions: checked.questions,
          mode: 'risk_probe',
          intro: questionsResult.output.intro,
        })
        await messageService.appendAssistantMessage(caseId, JSON.stringify(response.questions.map((q) => q.question)), 'followup')
        traceLogger.log(caseId, 'final_output', { reason: 'followup(risk_probe)' })
        return response
      }
    }
    // 追问生成失败 / 问题全部被去重：继续主循环，按现有信息分析并说明不确定性
  }

  // ---- 阶段 5：Agent 决策主循环 ----
  let searchRelaxRetryUsed = false
  let reportRewriteUsed = false
  let carePlanRewriteUsed = false

  for (let step = 0; step < AGENT_LIMITS.maxAgentSteps; step++) {
    const contextSummary = await buildContextSummary(messageService, caseId)
    const decision = await decideAction({ state, contextSummary, llm, traceLogger })

    traceLogger.logDecision(caseId, decision)
    state = await caseStateService.merge(caseId, {
      patch: {
        decisionHistory: [decision],
        meta: { ...state.meta, agentSteps: state.meta.agentSteps + 1 },
      },
      updateReason: `decision_${decision.action}`,
      source: 'system',
    })

    const limitCheck = agentLimitGuard.check(state, decision)
    if (!limitCheck.allowed) {
      return finish(await failureRecovery.handle({ code: limitCheck.failureCode, state, decision }))
    }

    switch (decision.action) {
      case 'search_medical': {
        let tasks: MedicalSearchTask[] = decision.searchTasks ?? []
        if (tasks.length === 0) {
          tasks = await generateSearchTasks(state, decision.decisionGoal, llm)
        }

        emit({ type: 'status', message: '正在检索权威医学资料...' })
        emit({ type: 'search_query', queries: tasks.map((t) => t.query) })

        let result = await searchPipeline.run({ tasks, state })

        // SEARCH_NO_RESULT：放宽 query 重试 1 次（去掉来源限定）
        if (result.status === 'error' && result.failureCode === 'SEARCH_NO_RESULT' && !searchRelaxRetryUsed && tasks.length > 0) {
          searchRelaxRetryUsed = true
          const relaxedTasks = tasks.map((t) => ({ ...t, preferredSources: [], language: 'mixed' as const }))
          result = await searchPipeline.run({ tasks: relaxedTasks, state })
        }

        await messageService.appendToolResult(caseId, result.message)

        if (result.status === 'error') {
          // 检索失败不终止本轮分析：记录失败 + 推进搜索轮次，继续按现有信息分析/追问/输出，
          // 最终输出中由 composer 标注"未经联网核验"。
          emit({ type: 'status', message: '本轮未检索到可用权威资料，继续基于现有信息分析...' })
          state = await caseStateService.merge(caseId, {
            patch: {
              ...result.statePatch,
              meta: { ...state.meta, searchRounds: state.meta.searchRounds + 1 },
            },
            updateReason: `search_failed_${result.failureCode}`,
            source: 'system',
          })
          continue
        }

        state = await caseStateService.merge(caseId, {
          patch: result.statePatch,
          updateReason: 'search_pipeline_completed',
          source: 'tool',
        })
        emit({
          type: 'search_result',
          sources: state.evidence.map((e) => ({
            title: e.sourceTitle,
            url: e.sourceUrl,
            credibility: e.credibility,
          })),
        })
        continue
      }

      case 'analyze_case': {
        emit({ type: 'status', message: '正在分析可能的疾病方向...' })
        const result = await toolExecutor.run<CaseAnalyzeOutput>('case.analyze', {}, buildCtx())
        if (result.status === 'error') {
          return finish(await failureRecovery.handle({ code: result.message.error!.code, state }))
        }
        await messageService.appendToolResult(caseId, result.message)
        state = await caseStateService.merge(caseId, {
          patch: result.statePatch,
          updateReason: 'case_analyzed',
          source: 'tool',
        })
        traceLogger.log(caseId, 'hypotheses_updated', {
          output: state.hypotheses.map((h) => `${h.name}(${h.likelihood})`),
        })
        continue
      }

      case 'generate_care_plan': {
        emit({ type: 'status', message: '正在整理日常处理建议...' })
        const result = await toolExecutor.run<CarePlan>('care_plan.generate', {}, buildCtx())
        if (result.status === 'error') {
          // carePlan 失败不致命：继续走 final_answer（报告中将缺少成分边界，由模板兜底）
          traceLogger.log(caseId, 'failure_recovery', {
            reason: `care_plan 生成失败（${result.message.error?.code}），降级为不含成分边界的输出`,
          })
          state = await caseStateService.merge(caseId, {
            patch: {
              carePlan: {
                selfCareAdvice: ['保持休息和观察，记录症状变化，为就诊做准备。'],
                lifestyleAdvice: [],
                otcIngredientOptions: [],
                avoidActions: [],
                seekCareWhen: ['症状加重、持续不缓解或出现新的明显不适时，应尽快就医。'],
                uncertaintyNote: '处理建议生成受限，请以医生意见为准。',
              },
            },
            updateReason: 'care_plan_degraded',
            source: 'system',
          })
          continue
        }

        const rawPlan = (result.statePatch.carePlan ?? result.output) as CarePlan
        const checked = await medicationBoundaryGuard.validate({ state, carePlan: rawPlan })
        traceLogger.log(caseId, 'medication_boundary_guard', {
          output: { passed: checked.passed, issues: checked.issues },
        })

        if (!checked.passed) {
          if (!carePlanRewriteUsed) {
            // §39.2：移除越界用药内容，降级为生活建议 + 就医边界，最多重写 1 次
            carePlanRewriteUsed = true
            const degraded: CarePlan = {
              ...(checked.fixedCarePlan ?? rawPlan),
              otcIngredientOptions: [],
            }
            state = await caseStateService.merge(caseId, {
              patch: { carePlan: degraded },
              updateReason: 'care_plan_degraded_after_guard',
              source: 'system',
            })
            continue
          }
          return finish(
            await failureRecovery.handle({ code: 'CARE_PLAN_GUARD_FAILED', state, guardIssues: checked.issues }),
          )
        }

        state = await caseStateService.merge(caseId, {
          patch: { carePlan: checked.fixedCarePlan ?? rawPlan },
          updateReason: 'care_plan_generated',
          source: 'tool',
        })
        traceLogger.log(caseId, 'care_plan_generated', {
          output: { otcIngredients: (checked.fixedCarePlan ?? rawPlan).otcIngredientOptions.length },
        })
        continue
      }

      case 'ask_user': {
        emit({ type: 'status', message: '还需要补充关键信息，正在生成追问...' })
        const result = await toolExecutor.run<FollowupOutput>('question.generate', {}, buildCtx())
        if (result.status === 'error') {
          // 无法生成追问 -> 按现有信息输出阶段性判断
          return finish(await failureRecovery.handle({ code: result.message.error!.code, state }))
        }

        const checked = questionGuard.validate(toFollowups(result.output.questions, 'differential'), state)
        traceLogger.log(caseId, 'question_guard', {
          output: { kept: checked.questions.map((q) => q.question), dropped: checked.dropped },
        })

        if (checked.questions.length === 0) {
          // 问题全部被去重/拦截 -> 不再追问，继续推进分析
          continue
        }

        // 自适应追问：第一轮可以问到 3 个，之后每轮只追问剩下最关键的 1 个
        const maxQuestions = state.meta.followupRounds >= 1 ? 1 : AGENT_LIMITS.maxQuestionsPerTurn
        const selectedQuestions = checked.questions.slice(0, maxQuestions)

        state = await caseStateService.recordAskedQuestions(caseId, selectedQuestions)
        const response = reportRenderer.renderFollowup({
          state,
          questions: selectedQuestions,
          mode: 'differential',
          intro: result.output.intro,
        })
        await messageService.appendAssistantMessage(caseId, JSON.stringify(selectedQuestions.map((q) => q.question)), 'followup')
        traceLogger.log(caseId, 'final_output', { reason: 'followup(differential)' })
        return response
      }

      case 'final_answer': {
        emit({ type: 'status', message: '正在生成分析报告...' })
        let draft = await toolExecutor.run<FinalReport>(
          'report.generate',
          { reportType: 'final' },
          buildCtx(),
        )
        if (draft.status === 'error') {
          return finish(await failureRecovery.handle({ code: 'FINAL_GUARD_FAILED', state }))
        }

        let checked = await finalAnswerGuard.validate({ state, draftReport: draft.output })
        traceLogger.log(caseId, 'final_guard', {
          output: { passed: checked.passed, issues: checked.issues.map((i) => i.code) },
        })

        if (!checked.passed && !reportRewriteUsed) {
          // §39.2：带 issues 重写报告，最多 1 次
          reportRewriteUsed = true
          draft = await toolExecutor.run<FinalReport>(
            'report.generate',
            { reportType: 'final', guardIssues: checked.issues.map((i) => i.message) },
            buildCtx(),
          )
          if (draft.status === 'success') {
            checked = await finalAnswerGuard.validate({ state, draftReport: draft.output })
            traceLogger.log(caseId, 'final_guard', {
              output: { passed: checked.passed, issues: checked.issues.map((i) => i.code), rewrite: true },
            })
          }
        }

        if (draft.status !== 'success' || !checked.passed) {
          // 模板降级输出（不经 LLM 的安全模板）
          const templateReport = buildTemplateReport(state)
          const templateChecked = await finalAnswerGuard.validate({ state, draftReport: templateReport })
          if (templateChecked.passed) {
            state = await caseStateService.merge(caseId, {
              patch: { status: 'finalized' },
              updateReason: 'final_report_template_degraded',
              source: 'system',
            })
            const response = reportRenderer.renderFinalReport(state, templateChecked.fixedReport ?? templateReport)
            await messageService.appendAssistantMessage(caseId, response.rendered, 'final_report')
            traceLogger.log(caseId, 'final_output', { reason: 'final_report(template_degraded)' })
            return response
          }
          return finish(
            await failureRecovery.handle({ code: 'FINAL_GUARD_FAILED', state, guardIssues: checked.issues }),
          )
        }

        state = await caseStateService.merge(caseId, {
          patch: { status: 'finalized' },
          updateReason: 'final_report_generated',
          source: 'system',
        })
        const finalReport = checked.fixedReport ?? draft.output
        const response = reportRenderer.renderFinalReport(state, finalReport)
        await messageService.appendAssistantMessage(caseId, response.rendered, 'final_report')
        traceLogger.log(caseId, 'final_output', { reason: 'final_report' })
        return response
      }

      case 'emergency_stop': {
        state = await caseStateService.merge(caseId, {
          patch: { status: 'emergency' },
          updateReason: 'emergency_stop_decided',
          source: 'system',
        })
        const response = await emergencyResponder.respond(state)
        await messageService.appendAssistantMessage(caseId, response.content, 'emergency')
        return response
      }
    }
  }

  return finish(await failureRecovery.handle({ code: 'MAX_STEP_REACHED', state }))

  async function finish(response: AgentResponse): Promise<AgentResponse> {
    if (response.type === 'stage_report') {
      await messageService.appendAssistantMessage(caseId, response.content, 'stage_report')
    }
    return response
  }
}

function toFollowups(
  questions: Array<FollowupQuestion | (Omit<FollowupQuestion, 'relatedHypothesis' | 'relatedRiskRule'> & { relatedHypothesis?: string | null; relatedRiskRule?: string | null })>,
  defaultType: FollowupQuestion['type'],
): FollowupQuestion[] {
  return questions.map((q) => ({
    ...q,
    type: q.type ?? defaultType,
    relatedHypothesis: q.relatedHypothesis ?? undefined,
    relatedRiskRule: q.relatedRiskRule ?? undefined,
  }))
}

async function buildContextSummary(messageService: MessageService, caseId: string): Promise<string> {
  const messages = await messageService.getContextMessages(caseId, 10)
  return messages
    .map((m) => {
      if (isToolResultMessage(m)) {
        return `[tool:${m.toolName}] ${m.status}`
      }
      return `[${m.role}] ${typeof m.content === 'string' ? m.content.slice(0, 120) : ''}`
    })
    .join('\n')
}
