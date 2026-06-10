// ToolRegistry — v3.0 设计文档 §17

import type { CareCueTool } from './Tool.ts'

export class ToolRegistry {
  private tools = new Map<string, CareCueTool<unknown, unknown>>()

  register<TInput, TOutput>(tool: CareCueTool<TInput, TOutput>) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.tools.set(tool.name, tool as unknown as CareCueTool<unknown, unknown>)
  }

  get(name: string): CareCueTool<unknown, unknown> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }
    return tool
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): CareCueTool<unknown, unknown>[] {
    return Array.from(this.tools.values())
  }
}
