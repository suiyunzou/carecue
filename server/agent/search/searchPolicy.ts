// 联网检索策略 — 开关与用户显式请求识别
// 独立模块：decideAction / agentLimits / agentLoop 共用，避免循环依赖。

import type { CaseState } from '../case/CaseState.ts'

/** 联网检索总开关：AGENT_WEB_SEARCH_ENABLED=false 时完全关闭检索以节省成本/提速。 */
export function webSearchEnabled(): boolean {
  return process.env.AGENT_WEB_SEARCH_ENABLED !== 'false'
}

/** 用户消息是否显式要求联网搜索（如"帮我联网查一下""搜索最新指南"） */
const SEARCH_REQUEST_PATTERN = /联网|搜索|搜一下|搜一搜|查一下|查一查|检索|上网查|帮我查|查资料|最新(指南|资料|研究|文献)/

export function detectSearchRequest(message: string): boolean {
  return SEARCH_REQUEST_PATTERN.test(message)
}

/** 用户显式要求且开关开启时，本轮允许（且应当）执行一次联网检索 */
export function userForcedSearchActive(state: CaseState): boolean {
  return state.meta.userRequestedSearch === true && webSearchEnabled()
}
