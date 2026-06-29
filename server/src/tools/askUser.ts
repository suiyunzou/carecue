// ask_user：向用户追问一个问题，中断循环等待回复。

import { z } from 'zod'
import { AskUserInput } from '../schemas/index.ts'
import type { Tool } from './types.ts'

type Input = z.infer<typeof AskUserInput>

export const askUserTool: Tool<Input> = {
  name: 'ask_user',
  description: '向用户追问一个问题以排查红旗或收集关键信息。会中断流程等待用户回复。',
  inputSchema: AskUserInput,
  spec: {
    name: 'ask_user',
    description: '向用户追问一个问题以排查红旗或收集关键信息。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要问用户的问题' },
        target: { type: 'string', description: '该问题指向的红旗名（可选）' },
      },
      required: ['question'],
    },
  },
  run(input, ctx) {
    ctx.workspace.recordQuestion(input.question)
    if (input.target) ctx.workspace.awaitingRedFlag = input.target
    return {
      ok: true,
      summary: `追问：${input.question}`,
      interrupt: { question: input.question, target: input.target },
    }
  },
}
