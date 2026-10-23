# CareCue Agent 流设计文档 — 基于 Fable 5 设计理念

## 1. 设计灵感来源

### 1.1 Fable 5 核心设计理念

Fable 5 在 72 小时内展现的能力，标志着 AI Agent 从"一次性代码生成"向"持续迭代开发"的范式转移：

1. **从 Prompt 到 Loop**：不再是"提问→回答"的单次交互，而是进入"理解→修改→运行→检查→下一轮"的连续循环
2. **模糊反馈处理**：能把"Make it better"这类开放评价翻译成具体的工程动作
3. **长链条状态管理**：在复杂任务中保持数十步的上下文一致性
4. **多能力串联**：把不同能力（代码生成、测试、调试、优化）串成工作链
5. **增量修改而非重写**：在已有系统上持续迭代，而非每轮重新生成
6. **自我评估与修正**：能判断当前版本的问题类型，选择合适的改进策略

### 1.2 对 CareCue 的启示

当前 CareCue Agent 是线性流程：
```
用户输入 → 症状抽取 → 域识别 → 风险核查 → 红旗评估 → 决策 → 工具执行 → 报告生成
```

基于 Fable 5 理念，需要升级为：
```
用户输入 → 理解当前状态 → 评估输出质量 → 选择改进策略 → 执行改进 → 检查结果 → 循环迭代
```

核心转变：
- **从"完成一次咨询"到"持续优化咨询质量"**
- **从"执行预设流程"到"根据反馈动态调整"**
- **从"一次性输出"到"可迭代的中间产物"**

---

## 2. 新 Agent 流架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    CareCue Agent Loop                        │
│                                                              │
│  ┌──────────┐                                                │
│  │ 用户输入  │                                                │
│  └────┬─────┘                                                │
│       ↓                                                      │
│  ┌──────────────────┐                                        │
│  │ 1. 状态感知       │ ← 理解当前 CaseState + 历史对话        │
│  └────┬─────────────┘                                        │
│       ↓                                                      │
│  ┌──────────────────┐                                        │
│  │ 2. 质量评估       │ ← 评估当前输出的完整性、一致性、安全性  │
│  └────┬─────────────┘                                        │
│       ↓                                                      │
│  ┌──────────────────┐                                        │
│  │ 3. 策略选择       │ ← 根据评估结果选择下一步动作            │
│  │    - 追问澄清     │                                        │
│  │    - 补充证据     │                                        │
│  │    - 修正假设     │                                        │
│  │    - 生成报告     │                                        │
│  │    - 响应用户反馈 │                                        │
│  └────┬─────────────┘                                        │
│       ↓                                                      │
│  ┌──────────────────┐                                        │
│  │ 4. 执行动作       │ ← 调用工具链执行选定策略                │
│  └────┬─────────────┘                                        │
│       ↓                                                      │
│  ┌──────────────────┐                                        │
│  │ 5. 结果验证       │ ← 检查执行结果是否改善输出质量          │
│  └────┬─────────────┘                                        │
│       ↓                                                      │
│  ┌──────────────────┐                                        │
│  │ 6. 循环决策       │ ← 是否继续迭代？还是输出最终结果？      │
│  └────┬─────────────┘                                        │
│       ↓                                                      │
│  ┌──────────┐                                                │
│  │ 输出结果  │                                                │
│  └──────────┘                                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

1. **Loop-First**：每个动作都在循环中执行，支持多轮迭代
2. **State-Centric**：CaseState 是核心，所有动作都是对状态的增量修改
3. **Quality-Driven**：每轮迭代都有明确的质量目标
4. **Feedback-Aware**：能理解并响应用户的模糊反馈
5. **Incremental**：在已有分析基础上迭代，而非推倒重来

---

## 3. 核心模块设计

### 3.1 AgentLoopController — 循环控制器

负责管理整个迭代循环的生命周期。

```typescript
// server/agent/loop/AgentLoopController.ts

export interface LoopConfig {
  maxIterations: number          // 最大迭代次数（防止无限循环）
  qualityThreshold: number       // 质量阈值（达到后停止迭代）
  enableSelfReflection: boolean  // 是否启用自我反思
}

export interface IterationContext {
  iteration: number              // 当前迭代轮次
  caseState: CaseState           // 当前状态
  qualityScore: QualityScore     // 当前质量评分
  lastAction: AgentAction        // 上一轮执行的动作
  userFeedback?: string          // 用户反馈（如果有）
}

export interface LoopDecision {
  shouldContinue: boolean        // 是否继续迭代
  nextAction: AgentAction        // 下一步动作
  reason: string                 // 决策理由
}

export class AgentLoopController {
  constructor(
    private config: LoopConfig,
    private qualityAssessor: QualityAssessor,
    private strategySelector: StrategySelector,
    private traceLogger: TraceLogger
  ) {}

  /**
   * 执行一轮迭代
   */
  async runIteration(context: IterationContext): Promise<LoopDecision> {
    this.traceLogger.log(context.caseState.caseId, 'loop_iteration', {
      iteration: context.iteration,
      qualityScore: context.qualityScore,
      lastAction: context.lastAction,
    })

    // 1. 检查是否达到终止条件
    if (this.shouldTerminate(context)) {
      return {
        shouldContinue: false,
        nextAction: 'generate_report',
        reason: '达到终止条件',
      }
    }

    // 2. 评估当前质量
    const quality = await this.qualityAssessor.assess(context)

    // 3. 选择下一步策略
    const strategy = await this.strategySelector.select({
      ...context,
      quality,
    })

    return {
      shouldContinue: true,
      nextAction: strategy.action,
      reason: strategy.reason,
    }
  }

  private shouldTerminate(context: IterationContext): boolean {
    // 达到最大迭代次数
    if (context.iteration >= this.config.maxIterations) {
      return true
    }

    // 质量达到阈值
    if (context.qualityScore.overall >= this.config.qualityThreshold) {
      return true
    }

    // 连续多轮质量无提升
    if (this.isQualityPlateau(context)) {
      return true
    }

    return false
  }

  private isQualityPlateau(context: IterationContext): boolean {
    // 检查最近 3 轮质量是否无显著提升
    // 实现略
    return false
  }
}
```

### 3.2 QualityAssessor — 质量评估器

评估当前输出的质量，包括完整性、一致性、安全性等维度。

```typescript
// server/agent/loop/QualityAssessor.ts

export interface QualityScore {
  overall: number                // 综合评分 0-1
  completeness: number           // 完整性：是否收集到足够信息
  consistency: number            // 一致性：症状、假设、证据是否一致
  safety: number                 // 安全性：是否遗漏红旗、风险
  evidenceStrength: number       // 证据强度：联网证据的质量和数量
  userUnderstanding: number      // 用户理解：是否充分理解用户意图
}

export interface QualityAssessmentInput {
  caseState: CaseState
  iteration: number
  lastAction: AgentAction
}

export class QualityAssessor {
  constructor(
    private llm: LlmClient,
    private traceLogger: TraceLogger
  ) {}

  async assess(input: QualityAssessmentInput): Promise<QualityScore> {
    const { caseState } = input

    // 1. 完整性评估
    const completeness = this.assessCompleteness(caseState)

    // 2. 一致性评估
    const consistency = this.assessConsistency(caseState)

    // 3. 安全性评估
    const safety = this.assessSafety(caseState)

    // 4. 证据强度评估
    const evidenceStrength = this.assessEvidenceStrength(caseState)

    // 5. 用户理解评估
    const userUnderstanding = this.assessUserUnderstanding(caseState)

    // 6. 综合评分
    const overall = this.calculateOverallScore({
      completeness,
      consistency,
      safety,
      evidenceStrength,
      userUnderstanding,
    })

    this.traceLogger.log(caseState.caseId, 'quality_assessment', {
      scores: {
        overall,
        completeness,
        consistency,
        safety,
        evidenceStrength,
        userUnderstanding,
      },
    })

    return {
      overall,
      completeness,
      consistency,
      safety,
      evidenceStrength,
      userUnderstanding,
    }
  }

  private assessCompleteness(state: CaseState): number {
    let score = 0
    let total = 0

    // 症状信息完整性
    total += 3
    if (state.symptoms.primary.length > 0) score += 1
    if (state.symptoms.onset) score += 1
    if (state.symptoms.severity) score += 1

    // 病史信息完整性
    total += 2
    if (state.medicalHistory.pastDiseases.length > 0) score += 1
    if (state.medicalHistory.medications.length > 0) score += 1

    // 假设完整性
    total += 2
    if (state.hypotheses.initial.length > 0) score += 1
    if (state.hypotheses.refined.length > 0) score += 1

    // 证据完整性
    total += 2
    if (state.evidence.searchResults.length > 0) score += 1
    if (state.evidence.extracted.length > 0) score += 1

    return score / total
  }

  private assessConsistency(state: CaseState): number {
    // 检查症状、假设、证据之间的一致性
    // 实现略：可以通过 LLM 评估，也可以通过规则检查
    return 0.8
  }

  private assessSafety(state: CaseState): number {
    // 检查是否遗漏红旗、风险评估是否充分
    let score = 1.0

    // 如果有红旗但未触发紧急处理，扣分
    if (state.risk.redFlags.triggered.length > 0 && !state.risk.emergencyDetected) {
      score -= 0.3
    }

    // 如果风险等级为 high 但未建议急诊，扣分
    if (state.risk.overallLevel === 'high' && !state.risk.emergencyDetected) {
      score -= 0.5
    }

    return Math.max(0, score)
  }

  private assessEvidenceStrength(state: CaseState): number {
    const results = state.evidence.searchResults
    const extracted = state.evidence.extracted

    if (results.length === 0) return 0

    // 证据数量
    const quantityScore = Math.min(results.length / 5, 1)

    // 证据质量（基于来源可信度）
    const qualityScore = extracted.length > 0
      ? extracted.reduce((sum, e) => sum + (e.sourceCredibility || 0.5), 0) / extracted.length
      : 0.5

    return (quantityScore + qualityScore) / 2
  }

  private assessUserUnderstanding(state: CaseState): number {
    // 检查是否充分理解用户意图
    // 可以通过追问次数、用户反馈等评估
    return 0.7
  }

  private calculateOverallScore(scores: Omit<QualityScore, 'overall'>): number {
    // 加权平均
    const weights = {
      completeness: 0.25,
      consistency: 0.20,
      safety: 0.30,        // 安全性权重最高
      evidenceStrength: 0.15,
      userUnderstanding: 0.10,
    }

    return (
      scores.completeness * weights.completeness +
      scores.consistency * weights.consistency +
      scores.safety * weights.safety +
      scores.evidenceStrength * weights.evidenceStrength +
      scores.userUnderstanding * weights.userUnderstanding
    )
  }
}
```

### 3.3 StrategySelector — 策略选择器

根据当前状态和质量评估结果，选择下一步动作策略。

```typescript
// server/agent/loop/StrategySelector.ts

export type AgentAction =
  | 'ask_clarification'      // 追问澄清
  | 'search_evidence'        // 搜索证据
  | 'refine_hypothesis'      // 细化假设
  | 'assess_risk'            // 风险评估
  | 'generate_care_plan'     // 生成处理建议
  | 'generate_report'        // 生成报告
  | 'respond_feedback'       // 响应用户反馈

export interface StrategySelectionInput extends IterationContext {
  quality: QualityScore
}

export interface StrategySelectionResult {
  action: AgentAction
  reason: string
  priority: number           // 优先级 0-1
}

export class StrategySelector {
  constructor(
    private llm: LlmClient,
    private traceLogger: TraceLogger
  ) {}

  async select(input: StrategySelectionInput): Promise<StrategySelectionResult> {
    const { caseState, quality, userFeedback } = input

    // 1. 如果有用户反馈，优先响应
    if (userFeedback) {
      return {
        action: 'respond_feedback',
        reason: '响应用户反馈',
        priority: 1.0,
      }
    }

    // 2. 安全检查优先
    if (quality.safety < 0.7) {
      return {
        action: 'assess_risk',
        reason: '安全性不足，需要补充风险评估',
        priority: 0.95,
      }
    }

    // 3. 完整性检查
    if (quality.completeness < 0.6) {
      return {
        action: 'ask_clarification',
        reason: '信息不完整，需要追问澄清',
        priority: 0.9,
      }
    }

    // 4. 证据强度检查
    if (quality.evidenceStrength < 0.5) {
      return {
        action: 'search_evidence',
        reason: '证据不足，需要联网搜索',
        priority: 0.85,
      }
    }

    // 5. 假设细化
    if (quality.consistency < 0.7 && caseState.hypotheses.initial.length > 0) {
      return {
        action: 'refine_hypothesis',
        reason: '假设一致性不足，需要细化',
        priority: 0.8,
      }
    }

    // 6. 生成处理建议
    if (quality.overall >= 0.7 && !caseState.carePlan) {
      return {
        action: 'generate_care_plan',
        reason: '质量达标，生成处理建议',
        priority: 0.75,
      }
    }

    // 7. 生成报告
    if (quality.overall >= 0.8) {
      return {
        action: 'generate_report',
        reason: '质量达标，生成最终报告',
        priority: 0.7,
      }
    }

    // 默认：继续追问
    return {
      action: 'ask_clarification',
      reason: '默认策略：继续收集信息',
      priority: 0.5,
    }
  }
}
```

### 3.4 FeedbackInterpreter — 模糊反馈解释器

将用户的模糊反馈（如"再详细点"、"换个角度"）翻译成具体的工程动作。

```typescript
// server/agent/loop/FeedbackInterpreter.ts

export interface FeedbackInterpretation {
  feedbackType: 'clarification' | 'expansion' | 'correction' | 'perspective_change'
  targetAspect: 'symptoms' | 'hypotheses' | 'evidence' | 'care_plan' | 'report'
  action: AgentAction
  specificInstructions: string
}

export class FeedbackInterpreter {
  constructor(
    private llm: LlmClient,
    private traceLogger: TraceLogger
  ) {}

  async interpret(input: {
    userFeedback: string
    caseState: CaseState
    lastAction: AgentAction
    lastOutput: string
  }): Promise<FeedbackInterpretation> {
    const { userFeedback, caseState, lastAction, lastOutput } = input

    // 使用 LLM 理解模糊反馈
    const prompt = `
你是一个医疗咨询助手的反馈解释器。

用户反馈：${userFeedback}

当前状态：
- 已收集症状：${caseState.symptoms.primary.join(', ')}
- 已生成假设：${caseState.hypotheses.initial.map(h => h.disease).join(', ')}
- 上一轮动作：${lastAction}
- 上一轮输出：${lastOutput.substring(0, 200)}...

请分析用户反馈的意图，并选择：
1. feedbackType: 反馈类型
   - clarification: 用户希望澄清某些信息
   - expansion: 用户希望扩展当前内容
   - correction: 用户认为有错误需要修正
   - perspective_change: 用户希望换个角度分析

2. targetAspect: 目标方面
   - symptoms: 症状相关
   - hypotheses: 疾病假设相关
   - evidence: 证据相关
   - care_plan: 处理建议相关
   - report: 报告整体相关

3. action: 下一步动作
   - ask_clarification: 追问澄清
   - search_evidence: 搜索证据
   - refine_hypothesis: 细化假设
   - assess_risk: 风险评估
   - generate_care_plan: 生成处理建议
   - generate_report: 生成报告

4. specificInstructions: 具体执行指令（给下游模块的提示）

请以 JSON 格式输出：
{
  "feedbackType": "...",
  "targetAspect": "...",
  "action": "...",
  "specificInstructions": "..."
}
`

    const response = await this.llm.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })

    const interpretation = JSON.parse(response.content) as FeedbackInterpretation

    this.traceLogger.log(caseState.caseId, 'feedback_interpretation', {
      userFeedback,
      interpretation,
    })

    return interpretation
  }
}
```

### 3.5 StateMutator — 状态修改器

负责在已有状态基础上进行增量修改，而非重写。

```typescript
// server/agent/loop/StateMutator.ts

export interface StateMutation {
  type: 'append' | 'update' | 'refine' | 'merge'
  target: keyof CaseState
  changes: Partial<CaseState>
  reason: string
}

export class StateMutator {
  constructor(private traceLogger: TraceLogger) {}

  /**
   * 增量修改状态
   */
  async mutate(
    currentState: CaseState,
    mutation: StateMutation
  ): Promise<CaseState> {
    this.traceLogger.log(currentState.caseId, 'state_mutation', {
      mutationType: mutation.type,
      target: mutation.target,
      reason: mutation.reason,
    })

    const newState = { ...currentState }

    switch (mutation.type) {
      case 'append':
        // 追加新信息（如新症状、新证据）
        this.appendToArray(newState, mutation.target, mutation.changes)
        break

      case 'update':
        // 更新现有信息（如修正症状描述）
        this.updateField(newState, mutation.target, mutation.changes)
        break

      case 'refine':
        // 细化现有信息（如细化假设）
        this.refineField(newState, mutation.target, mutation.changes)
        break

      case 'merge':
        // 合并新旧信息（如合并多轮追问结果）
        this.mergeFields(newState, mutation.target, mutation.changes)
        break
    }

    return newState
  }

  private appendToArray(
    state: CaseState,
    target: keyof CaseState,
    changes: Partial<CaseState>
  ): void {
    const currentValue = state[target]
    const newValue = changes[target]

    if (Array.isArray(currentValue) && Array.isArray(newValue)) {
      ;(state[target] as any) = [...currentValue, ...newValue]
    }
  }

  private updateField(
    state: CaseState,
    target: keyof CaseState,
    changes: Partial<CaseState>
  ): void {
    ;(state[target] as any) = {
      ...(state[target] as any),
      ...(changes[target] as any),
    }
  }

  private refineField(
    state: CaseState,
    target: keyof CaseState,
    changes: Partial<CaseState>
  ): void {
    // 细化逻辑：保留原有信息，增加细节
    this.updateField(state, target, changes)
  }

  private mergeFields(
    state: CaseState,
    target: keyof CaseState,
    changes: Partial<CaseState>
  ): void {
    // 合并逻辑：去重、冲突解决
    this.updateField(state, target, changes)
  }
}
```

---

## 4. 完整 Agent 流实现

### 4.1 主循环实现

```typescript
// server/agent/loop/agentLoopV2.ts

import { AgentLoopController, type IterationContext } from './AgentLoopController'
import { QualityAssessor } from './QualityAssessor'
import { StrategySelector, type AgentAction } from './StrategySelector'
import { FeedbackInterpreter } from './FeedbackInterpreter'
import { StateMutator } from './StateMutator'
import type { CaseState } from '../case/CaseState'
import type { TraceLogger } from '../logs/traceLogger'
import type { LlmClient } from '../llm/llmClient'

export interface AgentLoopV2Config {
  maxIterations: number
  qualityThreshold: number
  enableSelfReflection: boolean
}

export interface RunAgentV2Input {
  caseId?: string
  userId?: string
  userMessage: string
  userFeedback?: string        // 用户反馈（用于模糊反馈处理）
}

export interface AgentLoopV2Deps {
  caseStateService: CaseStateService
  messageService: MessageService
  toolExecutor: ToolExecutor
  searchPipeline: SearchPipeline
  traceLogger: TraceLogger
  llm: LlmClient
  search: SearchClient
}

export async function runCareCueAgentV2(
  input: RunAgentV2Input,
  deps: AgentLoopV2Deps,
  config: AgentLoopV2Config = {
    maxIterations: 10,
    qualityThreshold: 0.8,
    enableSelfReflection: true,
  }
): Promise<AgentResponse> {
  const { caseStateService, messageService, toolExecutor, searchPipeline, traceLogger, llm, search } = deps

  // 初始化核心模块
  const qualityAssessor = new QualityAssessor(llm, traceLogger)
  const strategySelector = new StrategySelector(llm, traceLogger)
  const feedbackInterpreter = new FeedbackInterpreter(llm, traceLogger)
  const stateMutator = new StateMutator(traceLogger)
  const loopController = new AgentLoopController(config, qualityAssessor, strategySelector, traceLogger)

  // 加载或创建状态
  let state = await caseStateService.loadOrCreate(input.caseId, input.userId)
  const caseId = state.caseId

  traceLogger.beginRequest(caseId)
  traceLogger.log(caseId, 'agent_loop_v2_start', {
    input: {
      userMessage: input.userMessage,
      userFeedback: input.userFeedback,
    },
  })

  // 记录用户消息
  await messageService.appendUserMessage({
    caseId,
    content: input.userFeedback || input.userMessage,
  })

  let iteration = 0
  let lastAction: AgentAction = 'ask_clarification'
  let lastOutput = ''

  // 主循环
  while (iteration < config.maxIterations) {
    iteration++

    traceLogger.log(caseId, 'loop_iteration_start', {
      iteration,
      lastAction,
    })

    // 1. 评估当前质量
    const quality = await qualityAssessor.assess({
      caseState: state,
      iteration,
      lastAction,
    })

    // 2. 构建迭代上下文
    const context: IterationContext = {
      iteration,
      caseState: state,
      qualityScore: quality,
      lastAction,
      userFeedback: input.userFeedback,
    }

    // 3. 决策：是否继续迭代
    const decision = await loopController.runIteration(context)

    if (!decision.shouldContinue) {
      traceLogger.log(caseId, 'loop_terminate', {
        reason: decision.reason,
        iteration,
      })
      break
    }

    // 4. 如果有用户反馈，先解释反馈
    let targetAction = decision.nextAction
    if (input.userFeedback) {
      const interpretation = await feedbackInterpreter.interpret({
        userFeedback: input.userFeedback,
        caseState: state,
        lastAction,
        lastOutput,
      })
      targetAction = interpretation.action
    }

    // 5. 执行选定的动作
    const actionResult = await executeAction(targetAction, {
      state,
      deps,
      traceLogger,
    })

    // 6. 更新状态（增量修改）
    state = await stateMutator.mutate(state, actionResult.mutation)

    // 7. 记录输出
    lastAction = targetAction
    lastOutput = actionResult.output

    // 8. 清除用户反馈（只处理一次）
    input.userFeedback = undefined

    traceLogger.log(caseId, 'loop_iteration_end', {
      iteration,
      action: targetAction,
      qualityAfter: quality,
    })
  }

  // 生成最终报告
  const report = await generateFinalReport(state, deps)

  traceLogger.log(caseId, 'agent_loop_v2_end', {
    totalIterations: iteration,
    finalQuality: await qualityAssessor.assess({
      caseState: state,
      iteration,
      lastAction,
    }),
  })

  return {
    caseId,
    report,
    traceId: traceLogger.getTraceId(caseId),
  }
}

async function executeAction(
  action: AgentAction,
  context: {
    state: CaseState
    deps: AgentLoopV2Deps
    traceLogger: TraceLogger
  }
): Promise<{ mutation: StateMutation; output: string }> {
  const { state, deps, traceLogger } = context

  switch (action) {
    case 'ask_clarification':
      // 调用追问工具
      const question = await deps.toolExecutor.execute('followupQuestionTool', {
        caseState: state,
      })
      return {
        mutation: {
          type: 'append',
          target: 'questions',
          changes: { questions: [question] } as any,
          reason: '追问澄清',
        },
        output: question.text,
      }

    case 'search_evidence':
      // 调用搜索工具
      const searchResults = await deps.searchPipeline.search({
        caseState: state,
      })
      return {
        mutation: {
          type: 'append',
          target: 'evidence',
          changes: { evidence: searchResults } as any,
          reason: '搜索证据',
        },
        output: `搜索到 ${searchResults.length} 条证据`,
      }

    case 'refine_hypothesis':
      // 调用假设细化工具
      const refined = await deps.toolExecutor.execute('hypothesisRefineTool', {
        caseState: state,
      })
      return {
        mutation: {
          type: 'refine',
          target: 'hypotheses',
          changes: { hypotheses: refined } as any,
          reason: '细化假设',
        },
        output: `细化了 ${refined.length} 个假设`,
      }

    case 'assess_risk':
      // 调用风险评估工具
      const risk = await deps.toolExecutor.execute('riskAssessTool', {
        caseState: state,
      })
      return {
        mutation: {
          type: 'update',
          target: 'risk',
          changes: { risk } as any,
          reason: '风险评估',
        },
        output: `风险等级：${risk.overallLevel}`,
      }

    case 'generate_care_plan':
      // 调用处理建议生成工具
      const carePlan = await deps.toolExecutor.execute('carePlanGenerateTool', {
        caseState: state,
      })
      return {
        mutation: {
          type: 'update',
          target: 'carePlan',
          changes: { carePlan } as any,
          reason: '生成处理建议',
        },
        output: '已生成处理建议',
      }

    case 'generate_report':
      // 调用报告生成工具
      const report = await deps.toolExecutor.execute('reportGenerateTool', {
        caseState: state,
      })
      return {
        mutation: {
          type: 'update',
          target: 'report',
          changes: { report } as any,
          reason: '生成报告',
        },
        output: '已生成报告',
      }

    default:
      return {
        mutation: {
          type: 'update',
          target: 'questions',
          changes: {} as any,
          reason: '默认动作',
        },
        output: '',
      }
  }
}

async function generateFinalReport(
  state: CaseState,
  deps: AgentLoopV2Deps
): Promise<FinalReport> {
  return await deps.toolExecutor.execute('reportGenerateTool', {
    caseState: state,
  })
}
```

---

## 5. 与现有系统的集成

### 5.1 渐进式迁移策略

新 Agent 流设计为与现有系统兼容，支持渐进式迁移：

1. **Phase 1**：新增 `agentLoopV2.ts`，保留原有 `agentLoop.ts`
2. **Phase 2**：通过配置开关切换新旧版本
3. **Phase 3**：验证稳定后，逐步废弃旧版本

```typescript
// server/agent/index.ts

export async function createCareCueAgentRuntime(
  options: CreateRuntimeOptions & { useV2?: boolean } = {}
): Promise<CareCueAgentRuntime> {
  if (options.useV2) {
    // 使用新版 Agent 流
    return {
      run: async (input: RunAgentInput) => {
        return await runCareCueAgentV2(input, deps, config)
      },
      getDebugInfo: async (caseId: string) => {
        // ...
      },
    }
  } else {
    // 使用旧版 Agent 流
    return {
      run: async (input: RunAgentInput) => {
        return await runCareCueAgent(input, deps)
      },
      getDebugInfo: async (caseId: string) => {
        // ...
      },
    }
  }
}
```

### 5.2 配置化控制

通过配置文件控制 Agent 流行为：

```yaml
# config/agent-loop.yaml

agentLoop:
  version: v2                    # v1 | v2
  maxIterations: 10              # 最大迭代次数
  qualityThreshold: 0.8          # 质量阈值
  enableSelfReflection: true     # 是否启用自我反思

  qualityWeights:                # 质量评估权重
    completeness: 0.25
    consistency: 0.20
    safety: 0.30
    evidenceStrength: 0.15
    userUnderstanding: 0.10

  strategyPriorityities:          # 策略优先级
    safety: 0.95
    completeness: 0.90
    evidenceStrength: 0.85
    consistency: 0.80
```

---

## 6. 测试与验证

### 6.1 单元测试

```typescript
// server/agent/loop/__tests__/QualityAssessor.test.ts

describe('QualityAssessor', () => {
  it('应该正确评估完整性', async () => {
    const assessor = new QualityAssessor(mockLlm, mockTraceLogger)
    const state = createMockCaseState({
      symptoms: { primary: ['头痛'] },
      hypotheses: { initial: [] },
    })

    const score = await assessor.assess({
      caseState: state,
      iteration: 1,
      lastAction: 'ask_clarification',
    })

    expect(score.completeness).toBeGreaterThan(0)
    expect(score.completeness).toBeLessThan(1)
  })

  it('安全性权重应该最高', async () => {
    const assessor = new QualityAssessor(mockLlm, mockTraceLogger)
    const state = createMockCaseState({
      risk: { redFlags: { triggered: ['胸痛'] } },
    })

    const score = await assessor.assess({
      caseState: state,
      iteration: 1,
      lastAction: 'assess_risk',
    })

    expect(score.safety).toBeLessThan(0.7)
  })
})
```

### 6.2 集成测试

```typescript
// server/agent/loop/__tests__/agentLoopV2.integration.test.ts

describe('AgentLoopV2 Integration', () => {
  it('应该支持多轮迭代', async () => {
    const runtime = await createCareCueAgentRuntime({ useV2: true })

    const response = await runtime.run({
      userMessage: '我头痛',
    })

    expect(response.report).toBeDefined()
    expect(response.traceId).toBeDefined()
  })

  it('应该能响应用户反馈', async () => {
    const runtime = await createCareCueAgentRuntime({ useV2: true })

    // 第一轮
    const response1 = await runtime.run({
      userMessage: '我头痛',
    })

    // 第二轮：用户反馈
    const response2 = await runtime.run({
      caseId: response1.caseId,
      userMessage: '',
      userFeedback: '能再详细点吗？',
    })

    expect(response2.report).toBeDefined()
  })
})
```

---

## 7. 总结

### 7.1 核心改进

基于 Fable 5 设计理念，CareCue Agent 流实现了以下核心改进：

1. **从线性到循环**：支持多轮迭代，持续优化输出质量
2. **从被动到主动**：能主动评估质量、选择策略、响应用户反馈
3. **从一次性到增量**：在已有状态基础上迭代，而非推倒重来
4. **从明确到模糊**：能理解并处理用户的模糊反馈
5. **从单维度到多维度**：从多个维度评估输出质量（完整性、一致性、安全性等）

### 7.2 预期效果

1. **更高的输出质量**：通过多轮迭代和质量评估，确保输出达到阈值
2. **更好的用户体验**：能理解并响应用户的模糊反馈
3. **更强的安全性**：安全性权重最高，确保不遗漏风险
4. **更灵活的控制**：通过配置化控制，支持不同场景的需求

### 7.3 后续优化方向

1. **引入强化学习**：根据用户满意度优化策略选择
2. **支持并行迭代**：同时探索多个策略，选择最优结果
3. **引入外部知识**：结合医学知识库，提升专业性
4. **可视化调试**：提供迭代过程的可视化界面，便于调试和优化

---

## 附录

### A. 关键接口定义

```typescript
// CaseState 扩展
export interface CaseState {
  // ... 现有字段

  // 新增：迭代历史
  iterationHistory: IterationRecord[]

  // 新增：质量历史
  qualityHistory: QualityScore[]
}

export interface IterationRecord {
  iteration: number
  action: AgentAction
  qualityBefore: QualityScore
  qualityAfter: QualityScore
  mutation: StateMutation
  timestamp: number
}
```

### B. 性能优化建议

1. **缓存质量评估结果**：避免重复计算
2. **并行执行独立动作**：如同时搜索多个证据源
3. **提前终止**：当质量达到阈值时立即停止迭代
4. **增量更新**：只更新变化的部分，而非全量重算

### C. 参考资料

1. Fable 5 设计理念分析：https://aicoding.juejin.cn/post/7653507801742524416
2. Agentic Coding 范式转移：从 prompt 到 loop
3. CareCue Agent 技术设计文档：docs/Agent 技术设计文档.md
