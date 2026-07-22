import type { SubgraphDefinition } from '@mc-creator/shared';

/**
 * 子图注册表（单例，不导出独立 getSubgraph 函数）
 *
 * 维护全局子图定义，支持：
 * - register/get/has/list/remove 基础操作
 * - detectCycle：检测把 targetId 放入 parentId 是否成环（DFS 遍历 parentId 子图内的 subgraph 节点引用链）
 * - serializeAll/deserializeAll：JSON 持久化
 *
 * 子图定义也持久化到 NodeGraph.subgraphs（Zod schema），subgraphManager 作为运行时缓存 + 环检测能力。
 */
export class SubgraphManager {
  private map = new Map<string, SubgraphDefinition>();

  register(sg: SubgraphDefinition): void {
    this.map.set(sg.id, sg);
  }

  get(id: string): SubgraphDefinition | undefined {
    return this.map.get(id);
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  list(): SubgraphDefinition[] {
    return [...this.map.values()];
  }

  remove(id: string): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }

  /**
   * 检测把 targetId 子图放入 parentId 子图内部是否会成环。
   * 成环条件：从 parentId 出发，沿其内部 subgraph 节点引用链，看是否已经引用了 targetId。
   * 若 parentId 已经（直接或间接）引用 targetId，再把 targetId 放入 parentId 会形成 targetId → parentId → targetId 环。
   */
  detectCycle(parentId: string, targetId: string): boolean {
    if (parentId === targetId) return true;
    const visited = new Set<string>();
    const stack = [parentId];
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      if (currentId === targetId) return true;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const sg = this.map.get(currentId);
      if (!sg) continue;
      for (const node of sg.nodes) {
        if (node.data.kind === 'subgraph' && node.data.subgraphId) {
          stack.push(node.data.subgraphId);
        }
      }
    }
    return false;
  }

  serializeAll(): string {
    const obj: Record<string, SubgraphDefinition> = {};
    for (const [id, sg] of this.map) {
      obj[id] = sg;
    }
    return JSON.stringify(obj);
  }

  deserializeAll(json: string): { ok: true } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(json) as Record<string, SubgraphDefinition>;
      this.map.clear();
      for (const [id, sg] of Object.entries(parsed)) {
        this.map.set(id, sg);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export const subgraphManager = new SubgraphManager();
