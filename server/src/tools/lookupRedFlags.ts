// lookup_red_flags：检索本地红旗知识库，把匹配的红旗以 pending 载入 Workspace。

import { z } from 'zod'
import { LookupRedFlagsInput } from '../schemas/index.ts'
import type { Tool } from './types.ts'

type Input = z.infer<typeof LookupRedFlagsInput>

export const lookupRedFlagsTool: Tool<Input> = {
  name: 'lookup_red_flags',
  description: '根据症状检索本地红旗知识库，载入需要排查的危险信号。症状已知但红旗未加载时应优先调用。',
  inputSchema: LookupRedFlagsInput,
  spec: {
    name: 'lookup_red_flags',
    description: '根据症状检索本地红旗知识库，载入需要排查的危险信号。',
    parameters: {
      type: 'object',
      properties: { symptoms: { type: 'array', items: { type: 'string' } } },
      required: ['symptoms'],
    },
  },
  run(input, ctx) {
    const defs = ctx.knowledge.lookupRedFlags(input.symptoms)
    ctx.workspace.loadRedFlags(defs)
    return {
      ok: true,
      summary: defs.length
        ? `加载 ${defs.length} 条红旗：${defs.map((d) => d.name).join('、')}`
        : '该症状组合无匹配红旗（标记为已加载，避免重复检索）',
    }
  },
}
