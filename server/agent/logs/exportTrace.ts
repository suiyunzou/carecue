// Trace 导出 CLI：npm run trace:export -- <traceId>
// 读取 {TRACE_LOG_DIR}/{traceId}.jsonl 或 {TRACE_LOG_DIR}/*-{traceId}.jsonl，
// 整理为单个 JSON 数组文件 {TRACE_LOG_DIR}/YYYY-MM-DD/YYYY-MM-DD HH-MM-SS-traceId[-userId].json

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { traceLogDir } from './traceLogger.ts'

const traceId = process.argv[2]
if (!traceId) {
  console.error('用法: npm run trace:export -- <traceId>')
  process.exit(1)
}

const dir = traceLogDir()
const files = readdirSync(dir)
const matchedFile = files.find(f => f === `${traceId}.jsonl` || (f.endsWith(`${traceId}.jsonl`) && f.includes('-')))

if (!matchedFile) {
  console.error(`导出失败：在 ${dir} 下找不到匹配 ${traceId} 的 jsonl 文件`)
  process.exit(1)
}

const inputFile = join(dir, matchedFile)

try {
  const lines = readFileSync(inputFile, 'utf8').split('\n').filter((line) => line.trim().length > 0)
  const events = lines.map((line) => JSON.parse(line))
  
  let timePrefix = ''
  let dateDir = ''
  let userIdStr = ''
  
  if (events.length > 0) {
    if (events[0].timestamp) {
      const d = new Date(events[0].timestamp)
      const pad = (n: number) => n.toString().padStart(2, '0')
      // 避免文件名中出现不支持的字符 (如:冒号)，所以文件名中用 '-' 代替 ':'，但为了按照要求显示，只在目录名和文件名中尽量贴近
      // 如果严格要求文件名中包含 `:`，在 Windows 等系统中是不允许的。
      // 因此我们按照标准格式：2026-06-22 18-18-21-
      timePrefix = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-`
      dateDir = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    
    // 尝试从 input.userId 获取用户信息
    for (const event of events) {
      if (event.input && typeof event.input === 'object' && 'userId' in event.input) {
         userIdStr = `-${event.input.userId}`
         break
      }
    }
  }

  const outDir = join(traceLogDir(), dateDir)
  mkdirSync(outDir, { recursive: true })

  const outputFile = join(outDir, `${timePrefix}${traceId}${userIdStr}.json`)
  
  writeFileSync(outputFile, JSON.stringify(events, null, 2), 'utf8')
  console.log(`已导出 ${events.length} 条事件 -> ${outputFile}`)
} catch (err) {
  console.error(`导出失败：找不到或无法解析 ${inputFile}`)
  console.error(String(err))
  process.exit(1)
}
