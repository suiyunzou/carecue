// update_red_flag：标记某条红旗的排查状态。

import { z } from 'zod'
import { UpdateRedFlagInput } from '../schemas/index.ts'
import type { Tool } from './types.ts'

type Input = z.infer<typeof UpdateRedFlagInput>

export const updateRedFlagTool: Tool<Input> = {
  name: 'update_red_flag',
  description: '根据用户回答标记某条红旗为 ruled_out（排除）或 positive（命中）。',
  inputSchema: UpdateRedFlagInput,
  spec: {
    name: 'update_red_flag',
    description: '根据用户回答标记某条红旗为 ruled_out 或 positive。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'ruled_out', 'positive'] },
        evidence: { type: 'string', description: '支持该判断的用户原话或线索' },
      },
      required: ['name', 'status'],
    },
  },
  run(input, ctx) {
    const ok = ctx.workspace.updateRedFlag(input.name, input.status, input.evidence)
    if (!ok) return { ok: false, error: `红旗不存在：${input.name}` }
    return { ok: true, summary: `${input.name} → ${input.status}` }
  },
}
