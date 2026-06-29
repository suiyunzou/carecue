// M1 端到端测试：约束式事件循环骨架（头晕 + 胸闷）。
// 运行：tsx server/src/consult.test.ts
// 覆盖：正常排查出报告 / 急症提示 / 红旗强制加载 / 工具失败可恢复 / Guard 规则。

import assert from 'node:assert/strict'
import { createM1Engine, ConsultEngine } from './agent/loop.ts'
import { loadKnowledge } from './knowledge/loader.ts'
import { createM1ToolRegistry } from './tools/index.ts'
import { lookupRedFlagsTool } from './tools/lookupRedFlags.ts'
import { MockLlm } from './agent/llm.ts'
import { Workspace } from './agent/workspace.ts'
import { guard, guardReport } from './agent/guard.ts'
import type { Tool } from './tools/index.ts'

const BANNED = ['确诊', '一定是', '必须服用']
let failures = 0

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
  } catch (err) {
    failures++
    console.log(`  ❌ ${name}`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log('M1 约束式事件循环骨架')

await test('正常排查：逐轮排除全部红旗 → 非确诊报告', async () => {
  const engine = createM1Engine()
  const id = 'case-normal'

  const r1 = await engine.consult({ caseId: id, userMessage: '我最近老是头晕，还有点胸闷' })
  assert.equal(r1.type, 'followup', '第1轮应追问')

  const r2 = await engine.consult({ caseId: id, userMessage: '没有压榨痛，也不放射，没出冷汗' })
  assert.equal(r2.type, 'followup')

  const r3 = await engine.consult({ caseId: id, userMessage: '没有手脚无力，说话也清楚，看东西也正常' })
  assert.equal(r3.type, 'followup')

  const r4 = await engine.consult({ caseId: id, userMessage: '心跳挺平稳的，没有乱跳的感觉' })
  assert.equal(r4.type, 'final_report', '红旗排完应出报告')
  if (r4.type !== 'final_report') return

  assert.ok(r4.report.careAdvice.length > 0, '应有护理建议')
  assert.ok(r4.report.referral.department.length > 0, '应有就医科室建议')
  assert.deepEqual(
    r4.report.checked.sort(),
    ['心律失常', '心源性', '脑血管'].sort(),
    '三条红旗都应已排除',
  )
  assert.equal(r4.riskLevel, 'R0')
  for (const phrase of BANNED) {
    assert.ok(!r4.rendered.includes(phrase), `报告不应含被禁短语「${phrase}」`)
  }
})

await test('急症：心源性 positive → emergency 提示', async () => {
  const engine = createM1Engine()
  const id = 'case-emergency'

  const r1 = await engine.consult({ caseId: id, userMessage: '头晕胸闷' })
  assert.equal(r1.type, 'followup')

  const r2 = await engine.consult({
    caseId: id,
    userMessage: '有压榨性疼痛，还放射到左臂，冒冷汗',
  })
  assert.equal(r2.type, 'emergency', '高危红旗 positive 应触发急症')
  if (r2.type !== 'emergency') return
  assert.ok(r2.triggeredCombination.includes('心源性'))
  assert.equal(r2.riskLevel, 'R3')
  assert.ok(r2.doctorSummary.includes('心源性'))
})

await test('硬约束：症状已知未加载红旗时，第一步强制 lookup_red_flags', async () => {
  const engine = createM1Engine()
  const id = 'case-forced'
  const r1 = await engine.consult({ caseId: id, userMessage: '头晕，胸闷' })
  const ws = engine.getWorkspace(id)
  assert.ok(ws, 'workspace 应存在')
  assert.equal(ws!.redFlagsLoaded, true, '第一轮应已加载红旗')
  assert.equal(ws!.redFlags.length, 3, '应加载 3 条红旗')
  // 加载后才追问，说明 lookup 先于 ask 执行
  assert.equal(r1.type, 'followup')
})

await test('工具失败可恢复：lookup 第一次抛错，重试后对话继续', async () => {
  let calls = 0
  const flakyLookup: Tool = {
    ...(lookupRedFlagsTool as Tool),
    run(input, ctx) {
      if (calls++ === 0) throw new Error('模拟知识库瞬时故障')
      return lookupRedFlagsTool.run(input as never, ctx)
    },
  }
  const registry = createM1ToolRegistry()
  registry.register(flakyLookup)

  const engine = new ConsultEngine({ llm: new MockLlm(), knowledge: loadKnowledge(), registry })
  const r1 = await engine.consult({ caseId: 'case-flaky', userMessage: '头晕胸闷' })
  assert.equal(r1.type, 'followup', '工具失败 1 次后应重试成功并继续')
  assert.equal(calls, 2, 'lookup 应被调用 2 次（失败 1 次 + 重试成功）')
})

await test('Guard：有 pending 红旗时禁止 generate_report', () => {
  const ws = new Workspace('g1')
  ws.loadRedFlags([{ name: '心源性', severity: 'high', ask: 'q', positiveSignals: [] }])
  const v = guard({ tool: 'generate_report', input: {} }, ws)
  assert.equal(v.allow, false)
})

await test('Guard：高危 positive 时放行 generate_report（急症）', () => {
  const ws = new Workspace('g2')
  ws.loadRedFlags([{ name: '心源性', severity: 'high', ask: 'q', positiveSignals: ['冷汗'] }])
  ws.updateRedFlag('心源性', 'positive', '冷汗')
  const v = guard({ tool: 'generate_report', input: {} }, ws)
  assert.equal(v.allow, true)
})

await test('Guard：重复问题被拒绝', () => {
  const ws = new Workspace('g3')
  ws.recordQuestion('你头痛吗？')
  const v = guard({ tool: 'ask_user', input: { question: '你头痛吗？' } }, ws)
  assert.equal(v.allow, false)
})

await test('GuardReport：被禁短语被拦截', () => {
  assert.equal(guardReport('你这一定是心梗').allow, false)
  assert.equal(guardReport('必须服用 100mg 阿司匹林').allow, false)
  assert.equal(guardReport('建议注意休息，必要时就医。每日饮水不超过 2g 盐。').allow, true)
})

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 个用例失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
