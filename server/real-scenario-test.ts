import 'dotenv/config'
import { chatWithAi, analyzeConsultationWithAi, type AiChatInput } from './ai.ts'
import { buildResult } from './rules.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

// 模拟完整的一个用户就诊对话过程
async function runRealScenario() {
  console.log('>>> 启动真实场景测试...')
  
  const chiefComplaint = '我是什么疾病'
  const answers: any[] = [] // 模拟表单答案，假设什么都没填或者没提供关键信息
  const ruleResult = buildResult(chiefComplaint, 'general', answers)

  // 【第一轮】：用户提问，系统触发聊天补充
  const chatInput1: AiChatInput = {
    chiefComplaint,
    scenario: 'general',
    answers,
    ruleResult,
    chatMessages: [
      { role: 'assistant', content: '我已经接收到你的基础信息，接下来可以继续补充症状变化、诱因、既往病史或用药情况；如果信息已经完整，可以直接生成分析报告。' },
      { role: 'user', content: chiefComplaint }
    ]
  }

  console.log('\n==============================')
  console.log('【第一轮请求】用户第一次补充')
  const reply1 = await chatWithAi(chatInput1)
  
  // 【第二轮】：用户仅仅回复 "1"（对应上面的某个选项）
  const chatInput2: AiChatInput = {
    ...chatInput1,
    chatMessages: [
      ...chatInput1.chatMessages,
      { role: 'assistant', content: reply1.message },
      { role: 'user', content: '1' }
    ]
  }

  console.log('\n==============================')
  console.log('【第二轮请求】用户只回复数字 1')
  const reply2 = await chatWithAi(chatInput2)
  
  // 【第三轮】：用户补充一点症状，直接生成报告
  const finalInput = {
    ...chatInput2,
    chatMessages: [
      ...chatInput2.chatMessages,
      { role: 'assistant', content: reply2.message },
      { role: 'user', content: '就是早上起来突然头晕，感觉天旋地转的，还想吐，没有其他病。现在帮我生成报告吧。' }
    ]
  }

  console.log('\n==============================')
  console.log('【第三轮请求】用户补充症状并直接生成报告')
  const finalResult = await analyzeConsultationWithAi(finalInput)
  console.log('最终报告:', JSON.stringify(finalResult.doctorSummary, null, 2))
  
  console.log('\n>>> 真实场景测试结束。')
}

runRealScenario().catch(console.error)