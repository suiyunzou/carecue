// 轻量并发限制器（替代 p-limit，避免新增依赖）— v3.0 设计文档 §20.3

export function createLimiter(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []

  function next() {
    active -= 1
    const resume = queue.shift()
    if (resume) resume()
  }

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active += 1
    try {
      return await task()
    } finally {
      next()
    }
  }
}

export function collectSuccessful<T>(settled: PromiseSettledResult<T>[]): T[] {
  return settled
    .filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is NonNullable<T> => v !== null && v !== undefined) as T[]
}

export const PIPELINE_CONCURRENCY = {
  search: 3,
  fetch: 5,
  evidenceExtract: 2,
} as const
