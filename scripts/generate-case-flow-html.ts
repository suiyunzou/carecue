/**
 * 从终端 Trace 日志 + PostgreSQL 生成病例流转 HTML（case c9397b7b）
 * 运行: npx tsx scripts/generate-case-flow-html.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import 'dotenv/config'
import { PrismaClient } from '../server/generated/prisma/client.ts'
import { PrismaPg } from '@prisma/adapter-pg'

const CASE_PREFIX = 'c9397b7b'
const TERMINAL_LOG = resolve('C:/Users/86198/.cursor/projects/c-Users-86198-Documents-CareCue/terminals/4.txt')
const OUT_HTML = resolve('docs/case-flow-c9397b7b.html')

type TraceRow = {
  step: number
  eventType: string
  reason: string
  phase: string
  round: number
  estMs: number
  cumMs: number
  storage: string
  storageDetail: string
}

const STATE_MERGE_MAP: Record<string, { fields: string; store: string }> = {
  user_message_received: {
    fields: 'symptoms.userOriginalText += 用户消息',
    store: 'InMemoryCaseStore (CaseState v++)',
  },
  symptom_extracted: {
    fields: 'symptoms.*, userProfile.*（LLM 抽取）',
    store: 'InMemoryCaseStore',
  },
  symptom_domain_classified: {
    fields: 'symptomDomain.primaryDomain / supportedDepth',
    store: 'InMemoryCaseStore',
  },
  risk_probe_completed: {
    fields: 'riskProbe.requiredQuestions / probeStatus',
    store: 'InMemoryCaseStore',
  },
  risk_assessed: {
    fields: 'risk.level / redFlags / matchedRules / reason',
    store: 'InMemoryCaseStore',
  },
  decision_ask_user: {
    fields: 'decisionHistory += ask_user 决策',
    store: 'InMemoryCaseStore + meta.agentSteps++',
  },
  asked_questions_recorded: {
    fields: 'askedQuestions, status=waiting_user, meta.followupRounds++',
    store: 'InMemoryCaseStore',
  },
  decision_search_medical: {
    fields: 'decisionHistory += search_medical',
    store: 'InMemoryCaseStore + meta.agentSteps++',
  },
  search_pipeline_completed: {
    fields: 'evidence[], searchTrace[], meta.searchRounds++',
    store: 'InMemoryCaseStore',
  },
  decision_analyze_case: {
    fields: 'decisionHistory += analyze_case',
    store: 'InMemoryCaseStore + meta.agentSteps++',
  },
}

const DURATION_MS: Record<string, number> = {
  user_input: 0,
  state_merged: 8,
  symptom_extracted: 0,
  symptom_domain_classified: 0,
  risk_probe: 0,
  risk_assessed: 0,
  agent_decision: 2800,
  tool_use: 1200,
  tool_result: 4200,
  question_guard: 120,
  search_queries: 3500,
  sources_accepted: 4500,
  sources_rejected: 0,
  evidence_extracted: 72000,
  failure_recovery: 900,
  final_output: 400,
}

const USER_TURNS = [
  {
    round: 1,
    label: '第 1 轮 · 主诉',
    message: '胸口痛（用户首次描述）',
    output: 'followup(differential) — 追问疼痛性质/伴随症状/持续时间',
  },
  {
    round: 2,
    label: '第 2 轮 · 补充',
    message: '有针痛感；就今天；维持了5min → 24岁；左肩偶疼；按压能缓解',
    output: 'stage_report (TOOL_RUNTIME_ERROR) — case.analyze 失败后降级输出',
  },
]

function parseTerminalTrace(logText: string): TraceRow[] {
  const re = /\[Trace\]\[c9397b7b\]\[#(\d+)\] (\S+)(?: (.+))?/g
  const rows: Omit<TraceRow, 'cumMs' | 'phase' | 'round' | 'storage' | 'storageDetail'>[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(logText)) !== null) {
    const step = Number(m[1])
    const eventType = m[2]
    const reason = (m[3] ?? '').trim()
    rows.push({ step, eventType, reason, estMs: estimateMs(eventType, reason, step) })
  }

  let cum = 0
  let round = 1
  return rows.map((row) => {
    if (row.step === 25) round = 2
    cum += row.estMs
    const mergeKey = row.reason || row.eventType
    const mergeInfo = row.eventType === 'state_merged' ? STATE_MERGE_MAP[row.reason] : undefined
    return {
      ...row,
      cumMs: cum,
      round,
      phase: phaseOf(row),
      storage: storageOf(row, mergeInfo),
      storageDetail: mergeInfo
        ? `${mergeInfo.fields} → ${mergeInfo.store}`
        : storageDetailOf(row),
    }
  })
}

function estimateMs(eventType: string, reason: string, step: number): number {
  if (eventType === 'tool_result' && reason.includes('TOOL_RUNTIME_ERROR')) return 38000
  if (eventType === 'evidence_extracted' && step >= 55) return 65000
  if (eventType === 'evidence_extracted') return DURATION_MS.evidence_extracted
  return DURATION_MS[eventType] ?? 500
}

function phaseOf(row: { eventType: string; reason: string; step: number }): string {
  if (row.step <= 24) {
    if (row.step < 18) return '预处理（抽取/分域/风险）'
    if (row.step < 24) return '追问生成'
    return '第1轮输出'
  }
  if (row.step < 44) return '第2轮预处理'
  if (row.step < 50) return '联网检索 · 第1轮'
  if (row.step < 57) return '联网检索 · 第2轮'
  if (row.step < 62) return '病例分析（失败）'
  return '降级输出'
}

function storageOf(
  row: { eventType: string; reason: string },
  mergeInfo?: { fields: string; store: string },
): string {
  if (mergeInfo) return 'CaseState 合并'
  if (row.eventType === 'user_input') return 'MessageService'
  if (row.eventType.startsWith('search_') || row.eventType.startsWith('sources_') || row.eventType === 'evidence_extracted')
    return 'TraceLogger + CaseState(证据)'
  if (row.eventType === 'tool_use' || row.eventType === 'tool_result') return 'MessageService + TraceLogger'
  if (row.eventType === 'final_output') return 'SSE 流 → 前端'
  if (row.eventType === 'failure_recovery') return 'FailureRecovery'
  return 'TraceLogger'
}

function storageDetailOf(row: { eventType: string; reason: string }): string {
  const map: Record<string, string> = {
    user_input: 'appendUserMessage → 内存消息历史',
    tool_use: '记录工具调用意图',
    tool_result: 'appendToolResult → 工具输出写入消息链',
    search_queries: 'Trace 记录检索词（不直接改 CaseState）',
    sources_accepted: '白名单过滤后的来源列表（Trace）',
    sources_rejected: 'D级/重复来源（Trace）',
    evidence_extracted: 'evidence[] 写入 CaseState（抓取+LLM抽取后）',
    agent_decision: 'decideAction LLM/规则 → 下一动作',
    question_guard: '过滤已问过/低价值追问',
    failure_recovery: '生成 stage_report 模板',
    final_output: '返回 followup / stage_report 给客户端',
  }
  return map[row.eventType] ?? (row.reason || '—')
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

async function queryDb() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })
  try {
    const records = await prisma.consultationRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { result: true, user: { select: { email: true } } },
    })
    const agentV3 = records.filter((r) => r.scenario === 'agent_v3')
    return { records, agentV3, chestPain: records.filter((r) => r.chiefComplaint.includes('胸')) }
  } finally {
    await prisma.$disconnect()
  }
}

function buildHtml(trace: TraceRow[], db: Awaited<ReturnType<typeof queryDb>>) {
  const totalMs = trace.at(-1)?.cumMs ?? 0
  const round1End = trace.find((t) => t.step === 24)?.cumMs ?? 0
  const round2End = trace.at(-1)?.cumMs ?? 0
  const searchGap1 = trace.find((t) => t.step === 48)
  const searchGap2 = trace.find((t) => t.step === 55)

  const mermaid = `flowchart TB
    U1[用户: 胸口痛] --> P1[症状抽取 LLM]
    P1 --> D1[症状域分类]
    D1 --> R1[风险探查+评估 R1]
    R1 --> A1{Agent决策}
    A1 -->|ask_user| F1[追问 differential]
    F1 --> U2[用户补充: 5min/24岁/左肩疼]
    U2 --> P2[再抽取+再评估]
    P2 --> A2{Agent决策}
    A2 -->|search_medical| S1[Firecrawl 搜索#1]
    S1 --> E1[抓取+证据抽取 LLM]
    E1 --> A3{继续搜索}
    A3 -->|search_medical| S2[Firecrawl 搜索#2]
    S2 --> E2[抓取+证据抽取 LLM]
    E2 --> A4{analyze_case}
    A4 -->|TOOL_RUNTIME_ERROR| X[失败恢复 stage_report]
    X --> OUT[SSE 返回前端]
    OUT -.->|stage_report 不落库| DB[(PostgreSQL)]`

  const traceJson = JSON.stringify(trace, null, 2)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CareCue 病例流转 · ${CASE_PREFIX}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2332;
      --border: #2d3a4f;
      --text: #e7ecf3;
      --muted: #8b9cb3;
      --accent: #5b9fd4;
      --warn: #e8a838;
      --err: #e85d5d;
      --ok: #5cb87a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      padding: 24px 32px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    .sub { color: var(--muted); font-size: 0.9rem; }
    main { padding: 24px 32px 48px; max-width: 1400px; margin: 0 auto; }
    section { margin-bottom: 32px; }
    h2 { font-size: 1.1rem; margin: 0 0 16px; color: var(--accent); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card strong { display: block; font-size: 1.4rem; margin-bottom: 4px; }
    .card span { color: var(--muted); font-size: 0.85rem; }
    .warn { color: var(--warn); }
    .err { color: var(--err); }
    .ok { color: var(--ok); }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { background: #243044; color: var(--muted); font-weight: 600; position: sticky; top: 0; }
    tr:hover td { background: #1f2a3d; }
    .step { font-family: ui-monospace, monospace; color: var(--accent); }
    .phase-r1 { border-left: 3px solid var(--ok); }
    .phase-r2 { border-left: 3px solid var(--warn); }
    .phase-search { border-left: 3px solid #9b7ede; }
    .phase-fail { border-left: 3px solid var(--err); }
    .timeline-wrap { overflow-x: auto; padding-bottom: 8px; }
    .timeline {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 120px;
      min-width: 900px;
    }
    .bar {
      flex: 1;
      min-width: 4px;
      background: var(--accent);
      border-radius: 2px 2px 0 0;
      position: relative;
      opacity: 0.85;
    }
    .bar.search { background: #9b7ede; }
    .bar.fail { background: var(--err); }
    .bar:hover { opacity: 1; }
    .mermaid { background: var(--panel); border-radius: 8px; padding: 16px; }
    .layers {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 900px) { .layers { grid-template-columns: 1fr; } }
    .layer h3 { margin: 0 0 8px; font-size: 0.95rem; }
    .layer ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 0.85rem; }
    pre {
      background: #0a0e14;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      overflow: auto;
      font-size: 0.75rem;
      max-height: 280px;
    }
    .turn {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <header>
    <h1>问康 CareCue · 病例信息流转全景</h1>
    <p class="sub">Case ID 前缀 <code>${CASE_PREFIX}</code> · 数据来源：API 终端 Trace 日志 + PostgreSQL 查询 · 生成时间 ${new Date().toLocaleString('zh-CN')}</p>
  </header>
  <main>
    <section>
      <h2>摘要指标</h2>
      <div class="grid">
        <div class="card"><strong>${trace.length}</strong><span>Trace 事件总数</span></div>
        <div class="card"><strong>~${formatMs(totalMs)}</strong><span>估算端到端耗时（第2轮）</span></div>
        <div class="card"><strong class="ok">2</strong><span>联网搜索轮次（均成功抽取证据）</span></div>
        <div class="card"><strong class="err">stage_report</strong><span>最终输出（未落库 PostgreSQL）</span></div>
        <div class="card"><strong class="warn">~${formatMs((searchGap1?.estMs ?? 0))}</strong><span>单次搜索「来源过滤→证据抽取」估算耗时</span></div>
        <div class="card"><strong>${db.agentV3.length}</strong><span>数据库中 agent_v3 历史记录数</span></div>
      </div>
    </section>

    <section>
      <h2>用户对话与系统输出</h2>
      ${USER_TURNS.map(
        (t) => `<div class="turn">
          <strong>${t.label}</strong>
          <p>输入：${t.message}</p>
          <p>输出：<code>${t.output}</code></p>
        </div>`,
      ).join('')}
    </section>

    <section>
      <h2>流程总览（Mermaid）</h2>
      <div class="mermaid">${mermaid}</div>
    </section>

    <section>
      <h2>耗时分布（估算）</h2>
      <p class="sub">Trace 终端日志未打印时间戳；下图按事件类型权重估算。第1轮约 <strong>${formatMs(round1End)}</strong>，第2轮累计约 <strong>${formatMs(round2End)}</strong>。搜索阶段 #47→#48、#54→#55 之间无日志，对应页面抓取 + LLM 证据抽取（最重）。</p>
      <div class="timeline-wrap">
        <div class="timeline">
          ${trace
            .map((t) => {
              const h = Math.max(4, Math.min(100, (t.estMs / 72000) * 100))
              const cls =
                t.eventType === 'evidence_extracted'
                  ? 'search'
                  : t.reason.includes('TOOL_RUNTIME_ERROR') || t.eventType === 'failure_recovery'
                    ? 'fail'
                    : ''
              const title = `#${t.step} ${t.eventType} ${formatMs(t.estMs)} cum=${formatMs(t.cumMs)}`
              return `<div class="bar ${cls}" style="height:${h}%" title="${title}"></div>`
            })
            .join('')}
        </div>
      </div>
    </section>

    <section>
      <h2>存储层变化</h2>
      <div class="layers">
        <div class="card layer">
          <h3>内存 · CaseState</h3>
          <ul>
            <li>症状/画像/风险/证据/搜索轨迹持续合并</li>
            <li>版本号每次 merge +1（InMemoryCaseStore）</li>
            <li>服务重启后丢失（本 case 仅在当次 dev:api 进程内）</li>
          </ul>
        </div>
        <div class="card layer">
          <h3>内存 · TraceLogger / MessageService</h3>
          <ul>
            <li>63 条 Trace 事件（本 HTML 数据来源）</li>
            <li>用户消息 + 工具结果消息链</li>
            <li>可通过 <code>GET /api/agent/cases/:id/debug</code> 读取（需登录+完整 caseId）</li>
          </ul>
        </div>
        <div class="card layer">
          <h3>PostgreSQL · 持久化</h3>
          <ul>
            <li><strong class="warn">本次未写入</strong>：仅 <code>final_report</code> / <code>emergency</code> 落库</li>
            <li>输出为 <code>stage_report</code> → 无 consultation_records 行</li>
            <li>库内最近记录：${db.records[0] ? `${db.records[0].chiefComplaint} (${db.records[0].scenario})` : '无'}</li>
            <li>含「胸」主诉记录：${db.chestPain.length} 条</li>
          </ul>
        </div>
      </div>
    </section>

    <section>
      <h2>逐步 Trace · 流程 / 耗时 / 存储</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>轮次</th><th>阶段</th><th>事件</th><th>说明</th>
            <th>单步耗时(估)</th><th>累计(估)</th><th>存储变化</th>
          </tr>
        </thead>
        <tbody>
          ${trace
            .map((t) => {
              const rowClass =
                t.phase.includes('联网检索')
                  ? 'phase-search'
                  : t.phase.includes('失败') || t.reason.includes('TOOL_RUNTIME')
                    ? 'phase-fail'
                    : t.round === 1
                      ? 'phase-r1'
                      : 'phase-r2'
              return `<tr class="${rowClass}">
                <td class="step">${t.step}</td>
                <td>R${t.round}</td>
                <td>${t.phase}</td>
                <td><code>${t.eventType}</code></td>
                <td>${t.reason || '—'}</td>
                <td>${formatMs(t.estMs)}</td>
                <td>${formatMs(t.cumMs)}</td>
                <td><strong>${t.storage}</strong><br/><span style="color:var(--muted)">${t.storageDetail}</span></td>
              </tr>`
            })
            .join('')}
        </tbody>
      </table>
    </section>

    <section>
      <h2>关键状态合并节点（CaseState 字段）</h2>
      <table>
        <thead><tr><th>updateReason</th><th>写入字段</th><th>存储</th></tr></thead>
        <tbody>
          ${Object.entries(STATE_MERGE_MAP)
            .map(
              ([k, v]) =>
                `<tr><td><code>${k}</code></td><td>${v.fields}</td><td>${v.store}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </section>

    <section>
      <h2>原始 Trace JSON（嵌入）</h2>
      <pre id="trace-json"></pre>
    </section>
  </main>
  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
    document.getElementById('trace-json').textContent = ${JSON.stringify(traceJson)};
  </script>
</body>
</html>`
}

async function main() {
  const logText = readFileSync(TERMINAL_LOG, 'utf8')
  const trace = parseTerminalTrace(logText)
  if (trace.length === 0) {
    throw new Error('未在终端日志中解析到 c9397b7b trace 事件')
  }
  const db = await queryDb()
  const html = buildHtml(trace, db)
  writeFileSync(OUT_HTML, html, 'utf8')
  console.log(`Wrote ${OUT_HTML} (${trace.length} events)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
