import * as React from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ClipboardList,
  FileText,
  HeartPulse,
  History,
  Info,
  ListChecks,
  Loader2,
  LogOut,
  Paperclip,
  Send,
  ShieldCheck,
  Stethoscope,
  Trash2,
  User,
  X,
} from 'lucide-react'
import heroImage from './assets/carecue-hero.png'
import './App.css'

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const API_BASE = configuredApiBase || '/api'

type User = {
  id: string
  phone: string | null
  email: string | null
  displayName: string
}

type AgentRiskLevel = 'R0' | 'R1' | 'R2' | 'R3'

type AgentFollowupQuestion = {
  question: string
  reason: string
  targetField: string
  priority: 'high' | 'medium' | 'low'
  type: 'risk_probe' | 'differential' | 'care_plan'
}

type AgentCitation = {
  index: number
  title: string
  url: string
  credibility: string
}

type AgentSnapshot = {
  chiefComplaint: string
  primaryDomain: string
  riskLevel: AgentRiskLevel
  riskReason: string
  inRiskProbe: boolean
  knownFacts: Array<{ label: string; value: string }>
  hypotheses: Array<{ name: string; likelihood: string }>
  evidenceSources: Array<{ title: string; url: string; credibility: string }>
  citations: AgentCitation[]
  searchQueries: string[]
  missingInfo: string[]
}

type AgentResponse = {
  caseId: string
  riskLevel: AgentRiskLevel
  citations: AgentCitation[]
  stateSnapshot: AgentSnapshot
} & (
  | { type: 'followup'; mode: 'risk_probe' | 'differential' | 'care_plan'; intro: string; questions: AgentFollowupQuestion[] }
  | { type: 'emergency'; content: string; triggeredCombination: string[]; doctorSummary: string }
  | { type: 'final_report'; rendered: string }
  | { type: 'stage_report'; content: string; reason: string; nextStepHints: string[] }
)

type AgentStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'extracted_facts'; facts: Array<{ label: string; value: string }> }
  | { type: 'risk_check'; level: AgentRiskLevel; confirmed: string[]; denied: string[]; unresolved: string[]; reason: string }
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

type ChatMessage = {
  role: 'assistant' | 'user'
  content: string
  kind?: 'followup' | 'emergency' | 'final_report' | 'stage_report'
  followupMode?: AgentFollowupQuestion['type']
  questions?: AgentFollowupQuestion[]
  /** 本条回复的可审计分析过程（可折叠展示） */
  process?: string[]
  /** 本条回复引用的权威来源 */
  citations?: AgentCitation[]
}

/** 进行中的实时步骤（Claude/ChatGPT 式工具调用时间线） */
type LiveStep = {
  id: number
  label: string
  status: 'running' | 'done' | 'error'
}

type ChatSessionSummary = {
  id: string
  title: string
  status: string
  riskLevel: AgentRiskLevel
  messageCount: number
  createdAt: string
  updatedAt: string
}

type ChatMessageRow = {
  id: string
  role: 'user' | 'assistant'
  kind: ChatMessage['kind'] | null
  content: string
  payload: {
    mode?: AgentFollowupQuestion['type']
    questions?: AgentFollowupQuestion[]
    doctorSummary?: string
    citations?: AgentCitation[]
    events?: AgentStreamEvent[]
  } | null
  createdAt: string
}

type View = 'home' | 'auth' | 'consult' | 'aiChat' | 'history'
type AuthStatus = 'checking' | 'authenticated' | 'anonymous'

const LAST_CASE_KEY = 'carecue:lastCaseId'

const examples = [
  '我爸最近总是头晕，是怎么回事？',
  '胸口闷，需要马上去医院吗？',
  '咳嗽两周不好，要挂什么科？',
]

function App() {
  const [view, setView] = React.useState<View>('home')
  const [user, setUser] = React.useState<User | null>(null)
  const [authStatus, setAuthStatus] = React.useState<AuthStatus>('checking')
  const [authMode, setAuthMode] = React.useState<'login' | 'register'>('login')
  const [account, setAccount] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [chiefComplaint, setChiefComplaint] = React.useState('')
  const urgentKeywords = ['胸痛', '呼吸困难', '晕倒', '吐血', '意识异常', '出血', '昏迷']
  const isUrgentInput = urgentKeywords.some((keyword) => chiefComplaint.includes(keyword))
  const [caseId, setCaseId] = React.useState<string | null>(null)
  const [snapshot, setSnapshot] = React.useState<AgentSnapshot | null>(null)
  const [sessions, setSessions] = React.useState<ChatSessionSummary[]>([])
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [isChatting, setIsChatting] = React.useState(false)
  const [liveSteps, setLiveSteps] = React.useState<LiveStep[]>([])

  /** 从历史 / 刷新恢复完整对话：消息、引用、追问、分析过程、侧栏快照都可还原并继续聊天 */
  const restoreSession = async (sessionId: string, options: { silent?: boolean } = {}) => {
    try {
      const data = await api<{
        session: ChatSessionSummary
        messages: ChatMessageRow[]
        snapshot: AgentSnapshot | null
      }>(`/chats/${sessionId}`)

      setCaseId(data.session.id)
      window.localStorage.setItem(LAST_CASE_KEY, data.session.id)
      setChiefComplaint(data.session.title)
      setSnapshot(data.snapshot)
      setChatMessages(data.messages.map(rowToChatMessage))
      setView('aiChat')
    } catch (error) {
      window.localStorage.removeItem(LAST_CASE_KEY)
      if (!options.silent) setMessage(errorMessage(error))
    }
  }

  React.useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then(async (data) => {
        setUser(data.user)
        setAuthStatus('authenticated')
        // 刷新页面后恢复上次未结束的对话（含消息、引用、侧栏快照）
        const lastCaseId = window.localStorage.getItem(LAST_CASE_KEY)
        if (lastCaseId) {
          await restoreSession(lastCaseId, { silent: true })
        }
      })
      .catch(() => {
        setUser(null)
        setAuthStatus('anonymous')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startExperience = () => {
    setMessage('')
    if (authStatus === 'checking') {
      setMessage('正在恢复登录状态，请稍候。')
      return
    }
    setView(user ? 'consult' : 'auth')
  }

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault()
    setMessage('')
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
      const data = await api<{ user: User }>(endpoint, {
        method: 'POST',
        body: { account, password, displayName },
      })
      setUser(data.user)
      setAuthStatus('authenticated')
      setAccount('')
      setPassword('')
      setDisplayName('')
      setView('consult')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
    setAuthStatus('anonymous')
    setView('home')
    resetConsultation()
  }

  const consultAgent = async (userMessage: string, existingCaseId: string | null) => {
    const processLines: string[] = []
    const steps: LiveStep[] = []
    let stepId = 0
    setLiveSteps([])

    try {
      const data = await streamAgentConsult(
        { caseId: existingCaseId ?? undefined, message: userMessage },
        (event) => {
          const line = describeStreamEvent(event)
          if (line) processLines.push(line)

          // 结构化实时步骤：工具开始 -> running；完成 -> done/error；其他事件 -> 即时完成项
          if (event.type === 'tool_step') {
            if (event.phase === 'start') {
              steps.push({
                id: ++stepId,
                label: TOOL_STEP_LABELS[event.toolName] ?? event.toolName,
                status: 'running',
              })
            } else {
              const running = [...steps].reverse().find((s) => s.status === 'running')
              if (running) {
                running.status = event.status === 'error' ? 'error' : 'done'
                if (event.summary) running.label = event.summary
              }
            }
          } else if (line) {
            // 把仍在 running 的状态行收尾，避免步骤悬挂
            for (const s of steps) {
              if (s.status === 'running' && event.type === 'status') s.status = 'done'
            }
            steps.push({ id: ++stepId, label: line, status: event.type === 'status' ? 'running' : 'done' })
          }
          setLiveSteps([...steps])
        },
      )
      setCaseId(data.response.caseId)
      window.localStorage.setItem(LAST_CASE_KEY, data.response.caseId)
      setSnapshot(data.response.stateSnapshot)
      setChatMessages((items) => [
        ...items,
        { ...agentResponseToChatMessage(data.response), process: processLines },
      ])
    } finally {
      setLiveSteps([])
    }
  }

  const startConsultation = async () => {
    if (chiefComplaint.trim().length < 2) {
      setMessage('请先用一句话描述哪里不舒服。')
      return
    }
    if (isChatting) return

    setMessage('')
    setCaseId(null)
    setSnapshot(null)
    setChatMessages([])
    window.localStorage.removeItem(LAST_CASE_KEY)
    setView('aiChat')

    try {
      setIsChatting(true)
      await consultAgent(chiefComplaint.trim(), null)
    } catch (error) {
      setMessage(errorMessage(error))
      setView('consult')
    } finally {
      setIsChatting(false)
    }
  }

  const sendChatMessage = async () => {
    const content = chatInput.trim()
    if (!content || isChatting) return

    setChatMessages((items) => [...items, { role: 'user', content }])
    setChatInput('')
    setMessage('')

    try {
      setIsChatting(true)
      await consultAgent(content, caseId)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setIsChatting(false)
    }
  }

  const loadHistory = async () => {
    setMessage('')
    try {
      const data = await api<{ sessions: ChatSessionSummary[] }>('/chats')
      setSessions(data.sessions)
      setView('history')
    } catch (error) {
      setMessage(errorMessage(error))
      if (!user) setView('auth')
    }
  }

  const deleteSession = async (sessionId: string) => {
    await api(`/chats/${sessionId}`, { method: 'DELETE' })
    setSessions((items) => items.filter((item) => item.id !== sessionId))
    if (window.localStorage.getItem(LAST_CASE_KEY) === sessionId) {
      window.localStorage.removeItem(LAST_CASE_KEY)
    }
  }

  const resetConsultation = () => {
    setChiefComplaint('')
    setCaseId(null)
    setSnapshot(null)
    setChatMessages([])
    setChatInput('')
    window.localStorage.removeItem(LAST_CASE_KEY)
  }

  return (
    <main className="app-shell">
      {view !== 'aiChat' && (
        <header className="topbar">
          <button className="brand-button" onClick={() => setView('home')} type="button">
            <span className={`brand-mark${view === 'home' ? ' brand-mark--beating' : ''}`}>
              <HeartPulse size={18} />
            </span>
            <span>
              <strong>问康</strong>
              <small>CareCue</small>
            </span>
          </button>

          <nav className="nav-actions" aria-label="主导航">
            {authStatus === 'checking' ? (
              <button className="primary-button small" disabled type="button">
                恢复登录中
              </button>
            ) : user ? (
              <>
                <button className="ghost-button" onClick={() => setView('consult')} type="button">
                  <Stethoscope size={18} />
                  新咨询
                </button>
                <button className="ghost-button" onClick={loadHistory} type="button">
                  <History size={18} />
                  历史
                </button>
                <button className="icon-button" onClick={logout} title="退出登录" type="button">
                  <LogOut size={19} />
                </button>
              </>
            ) : (
              <button className="primary-button small" onClick={startExperience} type="button">
                立即体验
                <ArrowRight size={18} />
              </button>
            )}
          </nav>
        </header>
      )}

      {view === 'aiChat' && (
        <header className="topbar">
          <div className="brand-button">
            <span className="brand-mark">
              <HeartPulse size={18} />
            </span>
            <span>
              <strong>问康</strong>
              <small>CareCue</small>
            </span>
          </div>

          <nav className="nav-actions" aria-label="主导航">
            {user ? (
              <>
                <button
                  className="primary-button small"
                  onClick={() => {
                    resetConsultation()
                    setView('consult')
                  }}
                  type="button"
                >
                  + 新咨询
                </button>
                <button className="ghost-button" onClick={loadHistory} type="button">
                  <History size={18} />
                  历史
                </button>
                <button className="icon-button" onClick={logout} title="退出登录" type="button">
                  <User size={19} />
                </button>
              </>
            ) : null}
          </nav>
        </header>
      )}

      {message ? <div className="toast">{message}</div> : null}

      {view === 'home' ? (
        <HomeView onStart={startExperience} />
      ) : null}

      {view === 'auth' ? (
        <section className="auth-layout">
          <div className="auth-copy">
            <ShieldCheck size={34} />
            <h1>先确认身份，再保存健康记录</h1>
            <p>登录后，咨询记录只归你本人所有，方便自己查看、家人了解，或带去医院沟通。</p>
            <div className="safety-strip">
              <AlertTriangle size={18} />
              问康不是确诊工具；出现胸痛伴呼吸困难、说话不清、肢体无力等情况，请优先线下急诊。
            </div>
          </div>
          <form className="auth-panel" onSubmit={submitAuth}>
            <div className="segmented">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')} type="button">
                登录
              </button>
              <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')} type="button">
                注册
              </button>
            </div>
            <label>
              手机号或邮箱
              <input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="13800000000 / name@example.com" />
            </label>
            {authMode === 'register' ? (
              <label>
                昵称
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：王阿姨" />
              </label>
            ) : null}
            <label>
              密码
              <input value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} type="password" placeholder="至少 6 位" />
            </label>
            <button className="primary-button" type="submit">
              {authMode === 'login' ? '登录并开始咨询' : '注册并开始咨询'}
              <ArrowRight size={18} />
            </button>
          </form>
        </section>
      ) : null}

      {view === 'consult' ? (
        <section className="workspace">
          <div className="workspace-header compact-header">
            <span className="eyebrow">就医前症状整理</span>
            <h1 className="consult-title">先用一句话说哪里不舒服，问康会帮你问清关键信息</h1>
            <p>先核查是否有危险信号，再整理可能方向、日常处理和就医建议。信息不足时只做阶段性整理，不给出确诊结论。</p>
          </div>

          <div className="consult-grid">
            <div className="input-panel">
              <label>
                这次想咨询什么不舒服？
                <textarea
                  value={chiefComplaint}
                  onChange={(event) => setChiefComplaint(event.target.value)}
                  placeholder="比如：我爸最近总头晕，站起来更明显。"
                  rows={3}
                />
              </label>
              <div className="example-row">
                {examples.map((example) => (
                  <button key={example} onClick={() => setChiefComplaint(example)} type="button">
                    {example}
                  </button>
                ))}
              </div>
              <button className={`primary-button${isChatting ? ' is-loading' : ''}`} disabled={isChatting} onClick={startConsultation} type="button">
                {isChatting ? '正在整理' : '开始分析'}
                {isChatting ? <Loader2 className="spin" size={18} /> : <ArrowRight size={18} />}
              </button>
            </div>
            <aside className={`urgent-panel ${isUrgentInput ? 'urgent-active' : 'urgent-default'}`}>
              {isUrgentInput ? <AlertTriangle size={24} /> : <Info size={24} />}
              <h2>{isUrgentInput ? '紧急情况优先线下处理' : '安全提醒'}</h2>
              <p>出现胸痛伴呼吸困难、突发剧烈头痛、一侧肢体无力、意识模糊、大量出血或严重过敏等情况，不建议等待线上整理结果，请优先线下急诊。</p>
            </aside>
          </div>
        </section>
      ) : null}

      {view === 'aiChat' ? (
        <ChatView
          chatInput={chatInput}
          chatMessages={chatMessages}
          chiefComplaint={chiefComplaint}
          isChatting={isChatting}
          liveSteps={liveSteps}
          onBack={() => setView('consult')}
          onInputChange={setChatInput}
          onSend={sendChatMessage}
          snapshot={snapshot}
        />
      ) : null}

      {view === 'history' ? (
        <section className="workspace">
          <div className="workspace-header compact-header">
            <span className="eyebrow">历史对话</span>
            <h1>所有咨询对话都在这里</h1>
            <p className="history-note">点开任意一条可查看完整聊天记录，并直接继续提问，不需要重新描述。</p>
          </div>
          <div className="history-list">
            {sessions.length ? sessions.map((session) => (
              <article className="record-row" key={session.id}>
                <button onClick={() => restoreSession(session.id)} type="button">
                  <strong>{session.title}</strong>
                  <span>
                    {formatDate(session.updatedAt)} · {RISK_LABELS[session.riskLevel] ?? '评估中'} · {session.messageCount} 条消息
                    {session.status === 'finalized' ? ' · 已生成报告' : session.status === 'emergency' ? ' · 急症提醒' : ' · 可继续咨询'}
                  </span>
                </button>
                <button className="icon-button danger" onClick={() => deleteSession(session.id)} title="删除对话" type="button">
                  <Trash2 size={18} />
                </button>
              </article>
            )) : (
              <div className="empty-state">暂无历史对话。发起一次咨询后，对话会自动保存在这里。</div>
            )}
          </div>
        </section>
      ) : null}
    </main>
  )
}

function HomeView({ onStart }: { onStart: () => void }) {
  return (
    <>
      <section className="hero-section">
        <img className="hero-image" src={heroImage} alt="家人在桌边整理就医前健康信息" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <span className="eyebrow">
            <ShieldCheck size={18} />
            就医前症状整理与日常健康咨询助手
          </span>
          <h1>身体不适，先做症状梳理</h1>
          <p>通过对话梳理不适表现、持续时间、伴随症状和危险信号，生成一份可保存、可转发、可用于就医沟通的健康摘要。</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart} type="button">
              立即体验
              <ArrowRight size={20} />
            </button>
            <a className="secondary-button" href="#boundary">
              先看安全边界
            </a>
          </div>
          <div className="hero-note">
            <AlertTriangle size={18} />
            问康不做诊断，不替代医生判断。出现持续胸痛、呼吸困难、意识异常、肢体无力、大出血等情况，请直接急诊或拨打急救电话。
          </div>
        </div>
      </section>

      <section className="home-features" aria-label="服务流程">
        <article className="home-feature-card">
          <div className="home-feature-icon" aria-hidden>
            <ClipboardList size={24} />
          </div>
          <div className="home-feature-body">
            <h2>说清楚症状</h2>
            <p>补齐时间、部位、程度、诱因、伴随症状和用药信息。</p>
          </div>
        </article>
        <article className="home-feature-card">
          <div className="home-feature-icon" aria-hidden>
            <ShieldCheck size={24} />
          </div>
          <div className="home-feature-body">
            <h2>核查危险信号</h2>
            <p>优先识别胸痛、呼吸困难、意识异常、肢体无力等风险信号。</p>
          </div>
        </article>
        <article className="home-feature-card">
          <div className="home-feature-icon" aria-hidden>
            <FileText size={24} />
          </div>
          <div className="home-feature-body">
            <h2>生成就医摘要</h2>
            <p>整理可能方向、依据、需补充信息和医生沟通要点。</p>
          </div>
        </article>
      </section>

      <section className="home-boundary" id="boundary">
        <header className="home-boundary-head">
          <span className="home-boundary-label">安全边界</span>
          <h2>就医前整理，不作确诊结论</h2>
        </header>
        <ul className="home-boundary-list">
          <li>
            <ShieldCheck size={18} aria-hidden />
            <span>提供可能方向与阶段性判断，不替代医生面诊与必要检查。</span>
          </li>
          <li>
            <AlertTriangle size={18} aria-hidden />
            <span>胸痛、呼吸困难、言语异常、肢体无力等危险信号将优先提示就医。</span>
          </li>
          <li>
            <ListChecks size={18} aria-hidden />
            <span>建议附有依据说明、不确定项及线下就诊指引。</span>
          </li>
        </ul>
      </section>
    </>
  )
}

const DOMAIN_LABELS: Record<string, string> = {
  throat_respiratory: '咽喉与呼吸不适',
  gastrointestinal: '胃肠不适',
  eye_discomfort: '眼部不适',
  skin_mild: '皮肤轻微问题',
  chest_pain: '胸痛胸闷',
  headache: '头晕头痛',
  limb_pain: '肢体疼痛',
  fever: '发热相关',
  general_discomfort: '全身不适',
  unknown: '症状咨询',
}

const RISK_LABELS: Record<AgentRiskLevel, string> = {
  R0: '暂未发现明显危险信号',
  R1: '低风险，可先观察并继续补充信息',
  R2: '中风险，建议尽快就医评估',
  R3: '高风险，优先急诊或急救',
}

const FOLLOWUP_MODE_TITLES: Record<AgentFollowupQuestion['type'], string> = {
  risk_probe: '问康 · 危险信号核查',
  differential: '问康 · 补充关键信息',
  care_plan: '问康 · 日常处理相关',
}

const LIKELIHOOD_LABELS: Record<string, string> = {
  more_likely: '更像',
  possible: '也可能',
  less_likely: '暂不太支持',
  must_rule_out: '需优先排除',
}

const MESSAGE_KIND_TITLES: Record<NonNullable<ChatMessage['kind']>, string> = {
  followup: '问康 · 补充信息',
  emergency: '急症提醒',
  final_report: '症状处理报告',
  stage_report: '阶段性整理（非最终结论）',
}

function formatDomainLabel(domain?: string) {
  if (!domain) return '症状咨询'
  return DOMAIN_LABELS[domain] ?? '症状咨询'
}

function assistantMessageTitle(message: ChatMessage) {
  if (message.role !== 'assistant') return '补充说明'
  if (message.kind === 'followup') {
    const mode = message.followupMode ?? message.questions?.[0]?.type
    if (mode) return FOLLOWUP_MODE_TITLES[mode]
  }
  if (message.kind) return MESSAGE_KIND_TITLES[message.kind]
  return '问康'
}

const CITATION_MARKER_PATTERN = /([①②③④⑤⑥⑦⑧]|\[\d+\])/g

function shortSourceTitle(title: string) {
  const trimmed = title.trim()
  if (trimmed.length <= 36) return trimmed
  return `${trimmed.slice(0, 34)}…`
}

function MessageContentWithCitations({ content, citations }: { content: string; citations: AgentCitation[] }) {
  if (!citations.length) {
    return <p className="prewrap">{content}</p>
  }

  const indexByMarker = new Map<number, AgentCitation>(
    citations.map((c) => [c.index, c] as const),
  )
  const circledByIndex = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

  const parts = content.split(CITATION_MARKER_PATTERN)
  return (
    <p className="prewrap message-with-citations">
      {parts.map((part, i) => {
        if (!part) return null
        const bracketMatch = part.match(/^\[(\d+)\]$/)
        const circledIndex = circledByIndex.indexOf(part) + 1
        const citationIndex = bracketMatch ? Number(bracketMatch[1]) : circledIndex
        if (citationIndex > 0) {
          const citation = indexByMarker.get(citationIndex)
          if (citation) {
            return (
              <a
                className="citation-sup"
                href={`#cite-${citation.index}`}
                key={`${part}-${i}`}
                title={citation.title}
              >
                {part}
              </a>
            )
          }
        }
        return <React.Fragment key={`${part}-${i}`}>{part}</React.Fragment>
      })}
    </p>
  )
}

function CitationFootnotes({ citations }: { citations: AgentCitation[] }) {
  if (!citations.length) return null
  const circledByIndex = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

  return (
    <div className="message-citations">
      <span className="citations-label">参考来源</span>
      <ol className="citation-footnotes">
        {citations.map((c) => (
          <li id={`cite-${c.index}`} key={c.url}>
            <span className="citation-index">{circledByIndex[c.index - 1] ?? c.index}</span>
            <a href={c.url} rel="noreferrer" target="_blank">
              {shortSourceTitle(c.title)}
            </a>
            <span className={`source-level-badge level-${c.credibility.toLowerCase()}`}>{c.credibility}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ChatView({
  chatInput,
  chatMessages,
  chiefComplaint,
  isChatting,
  liveSteps,
  onBack,
  onInputChange,
  onSend,
  snapshot,
}: {
  chatInput: string
  chatMessages: ChatMessage[]
  chiefComplaint: string
  isChatting: boolean
  liveSteps: LiveStep[]
  onBack: () => void
  onInputChange: (value: string) => void
  onSend: () => void
  snapshot: AgentSnapshot | null
}) {
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onSend()
  }

  return (
    <section className="chat-layout-redesigned">
      <div className="chat-main-col">
        <div className="chat-panel-header-redesigned">
          <button className="ghost-button" onClick={onBack} type="button">
            <ArrowLeft size={18} />
            返回
          </button>
          <h2>{formatDomainLabel(snapshot?.primaryDomain)}</h2>
          <div className="spacer"></div>
        </div>

        <div className="chat-cards-container">
          <div className="chat-card complaint-card">
            <div className="card-icon"><User size={28} /></div>
            <div className="card-content">
              <h3>主要诉求</h3>
              <p>我本次的主要不适是：{chiefComplaint}</p>
            </div>
            <div className="card-decoration"><HeartPulse size={80} /></div>
          </div>

          {chatMessages.map((item, index) => (
            <div className={`chat-card message-card ${item.role} ${item.kind === 'emergency' ? 'emergency-card' : ''}`} key={index}>
              <div className={`card-icon ${item.role === 'assistant' ? 'ai-icon' : ''}`}>
                {item.role === 'assistant'
                  ? (item.kind === 'emergency' ? <AlertTriangle size={28} /> : <Bot size={28} />)
                  : <User size={28} />}
              </div>
              <div className="card-content">
                <h3>{item.role === 'assistant' ? assistantMessageTitle(item) : '你的补充'}</h3>
                {item.process?.length ? (
                  <details className="process-disclosure">
                    <summary>分析过程（{item.process.length} 步）</summary>
                    <ul>
                      {item.process.map((step, stepIndex) => (
                        <li key={stepIndex}>{step}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <MessageContentWithCitations
                  citations={item.role === 'assistant' ? (item.citations ?? []) : []}
                  content={item.content}
                />
                {item.role === 'assistant' && item.citations?.length ? (
                  <CitationFootnotes citations={item.citations} />
                ) : null}
                {item.questions?.length ? (
                  <ol className="followup-question-list">
                    {item.questions.map((question) => (
                      <li key={question.question}>{question.question}</li>
                    ))}
                  </ol>
                ) : null}
              </div>
            </div>
          ))}

          {isChatting ? (
            <div className="chat-card message-card assistant">
               <div className="card-icon ai-icon"><Bot size={28} /></div>
               <div className="card-content">
                 <h3>问康 · 正在整理</h3>
                 {liveSteps.length > 0 ? (
                   <ul className="live-step-list">
                     {liveSteps.map((step) => (
                       <li key={step.id} className={`live-step ${step.status}`}>
                         <span className="live-step-icon">
                           {step.status === 'running' ? (
                             <Loader2 className="spin" size={14} />
                           ) : step.status === 'error' ? (
                             <X size={14} />
                           ) : (
                             <Check size={14} />
                           )}
                         </span>
                         <span className="live-step-label">{step.label}</span>
                       </li>
                     ))}
                   </ul>
                 ) : (
                   <p>正在整理症状并核查风险信号，请稍候...</p>
                 )}
               </div>
            </div>
          ) : null}
        </div>

        <form className="chat-input-row-redesigned" onSubmit={handleSubmit}>
          <div className="attachment-icon"><Paperclip size={20} /></div>
          <textarea
            value={chatInput}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (chatInput.trim() && !isChatting) onSend()
              }
            }}
            placeholder="回答上面的问题，或继续补充症状、病史、用药等（Enter 发送，Shift+Enter 换行）"
            rows={1}
          />
          <button
            className={`primary-button send-btn${isChatting ? ' is-loading' : ''}`}
            disabled={!chatInput.trim() || isChatting}
            type="submit"
            aria-label={isChatting ? '正在分析' : '发送'}
          >
            {isChatting ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          </button>
        </form>

        <div className="chat-actions-redesigned">
          <p>
            <Info size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            信息足够时会自动生成可带去医院整理的症状处理报告；以上内容均非确诊结论。
          </p>
        </div>
      </div>

      <aside className="chat-sidebar-col">
        {snapshot?.knownFacts.length ? (
          <div className="overview-card">
            <div className="overview-header">
              <ClipboardList size={20} />
              <h3>已确认的信息</h3>
            </div>
            <div className="known-facts-list">
              {snapshot.knownFacts.map((fact) => (
                <div className="known-fact-row" key={fact.label}>
                  <span className="fact-label">{fact.label}</span>
                  <span className="fact-value">{fact.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="overview-card">
          <div className="overview-header">
            <ShieldCheck size={20} />
            <h3>当前评估</h3>
          </div>
          <div className="overview-list">
            <div className="overview-item">
              <div className="item-icon"><AlertTriangle size={18} /></div>
              <div className="item-content">
                <span className="item-label">风险等级</span>
                <span className="item-value">{snapshot ? RISK_LABELS[snapshot.riskLevel] : '评估中'}</span>
              </div>
            </div>
            <div className="overview-item">
              <div className="item-icon"><Info size={18} /></div>
              <div className="item-content">
                <span className="item-label">评估说明</span>
                <span className="item-value">{snapshot?.riskReason || '正在根据你的描述整理'}</span>
              </div>
            </div>
            <div className="overview-item">
              <div className="item-icon"><Stethoscope size={18} /></div>
              <div className="item-content">
                <span className="item-label">可能方向</span>
                <span className="item-value">
                  {snapshot?.hypotheses.length
                    ? snapshot.hypotheses
                        .map((h) => `${h.name}（${LIKELIHOOD_LABELS[h.likelihood] ?? h.likelihood}）`)
                        .join('；')
                    : '暂未形成'}
                </span>
              </div>
            </div>
            <div className="overview-item">
              <div className="item-icon"><ClipboardList size={18} /></div>
              <div className="item-content">
                <span className="item-label">待补充信息</span>
                <span className="item-value">
                  {snapshot?.missingInfo.length ? snapshot.missingInfo.join('；') : '暂无'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="risk-warning-card">
          <div className="warning-header">
            <ShieldCheck size={20} />
            <h3>风险提醒</h3>
          </div>
          <p>症状可能由多种原因引起，若出现加重、持续或伴随其他症状，建议及时就医。</p>
        </div>
      </aside>
    </section>
  )
}

/** SSE 流式咨询：边收过程事件边回调，返回 final 事件 */
async function streamAgentConsult(
  body: { caseId?: string; message: string },
  onEvent: (event: AgentStreamEvent) => void,
): Promise<{ response: AgentResponse }> {
  const response = await fetch(`${API_BASE}/agent/consult/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data.message === 'string' ? data.message : '请求失败')
  }
  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent: { response: AgentResponse } | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      separatorIndex = buffer.indexOf('\n\n')

      const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue

      let event: AgentStreamEvent
      try {
        event = JSON.parse(dataLine.slice(6)) as AgentStreamEvent
      } catch {
        continue
      }

      if (event.type === 'final') {
        finalEvent = { response: event.response }
      } else if (event.type === 'error') {
        throw new Error(event.message)
      } else {
        onEvent(event)
      }
    }
  }

  if (!finalEvent) {
    throw new Error('分析服务连接中断，请重试。')
  }
  return finalEvent
}

/** 把流式事件转成"可审计过程"展示行 */
function describeStreamEvent(event: AgentStreamEvent): string | null {
  switch (event.type) {
    case 'status':
      return event.message
    case 'extracted_facts':
      return event.facts.length
        ? `已提取信息：${event.facts.map((f) => `${f.label} ${f.value}`).join('；')}`
        : null
    case 'risk_check': {
      // 不向用户展示内部风险码（R0-R3），统一用可读表述
      const parts = [`风险核查：${RISK_LABELS[event.level] ?? '评估中'}`]
      if (event.confirmed.length) parts.push(`需警惕 ${event.confirmed.join('、')}`)
      if (event.denied.length) parts.push(`已排除 ${event.denied.join('、')}`)
      if (event.unresolved.length) parts.push(`待确认 ${event.unresolved.join('、')}`)
      return parts.join('；')
    }
    case 'search_query':
      return `检索：${event.queries.join('；')}`
    case 'search_result':
      return `已获取 ${event.sources.length} 条权威来源：${event.sources.slice(0, 3).map((s) => s.title).join('；')}`
    case 'tool_step':
      if (event.phase === 'start') {
        return `▶ ${TOOL_STEP_LABELS[event.toolName] ?? event.toolName}`
      }
      if (event.status === 'error') {
        return `✗ ${event.summary ?? TOOL_STEP_LABELS[event.toolName] ?? event.toolName}`
      }
      return event.summary ? `✓ ${event.summary}` : null
    case 'agent_decision':
      return `决策 → ${DECISION_LABELS[event.action] ?? event.action}`
    default:
      return null
  }
}

const TOOL_STEP_LABELS: Record<string, string> = {
  'symptom.extract': '症状抽取',
  'symptom.domain_classify': '症状域分类',
  'risk.probe': '风险探查',
  'risk.red_flag_assess': '红旗评估',
  'case.analyze': '病例分析',
  'care_plan.generate': '处理建议',
  'question.generate': '生成追问',
  'question.generate_risk_probe': '危险信号追问',
  'report.generate': '生成报告',
}

const DECISION_LABELS: Record<string, string> = {
  search_medical: '联网检索',
  analyze_case: '病例分析',
  generate_care_plan: '整理处理建议',
  ask_user: '向用户追问',
  final_answer: '生成报告',
  emergency_stop: '急症停止',
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof data.message === 'string' ? data.message : '请求失败')
  }

  return data as T
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

/** 把持久化的消息行还原成前端聊天消息（含追问、引用、分析过程） */
function rowToChatMessage(row: ChatMessageRow): ChatMessage {
  if (row.role === 'user') {
    return { role: 'user', content: row.content }
  }

  const payload = row.payload ?? {}
  const process = (payload.events ?? [])
    .map((event) => describeStreamEvent(event))
    .filter((line): line is string => Boolean(line))

  let content = row.content
  if (row.kind === 'emergency' && payload.doctorSummary) {
    content = `${row.content}\n\n医生沟通摘要（可直接出示给医生）：\n${payload.doctorSummary}`
  }

  return {
    role: 'assistant',
    kind: row.kind ?? undefined,
    followupMode: payload.mode,
    content,
    questions: payload.questions,
    citations: payload.citations ?? [],
    process: process.length ? process : undefined,
  }
}

function agentResponseToChatMessage(response: AgentResponse): ChatMessage {
  const citations = response.citations?.length
    ? response.citations
    : response.stateSnapshot.citations ?? []

  if (response.type === 'followup') {
    return {
      role: 'assistant',
      kind: 'followup',
      followupMode: response.mode,
      content: response.intro,
      questions: response.questions,
      citations,
    }
  }

  if (response.type === 'emergency') {
    return {
      role: 'assistant',
      kind: 'emergency',
      content: `${response.content}\n\n医生沟通摘要（可直接出示给医生）：\n${response.doctorSummary}`,
      citations,
    }
  }

  if (response.type === 'final_report') {
    return {
      role: 'assistant',
      kind: 'final_report',
      content: response.rendered,
      citations,
    }
  }

  return {
    role: 'assistant',
    kind: 'stage_report',
    content: response.content,
    citations,
  }
}

export default App
