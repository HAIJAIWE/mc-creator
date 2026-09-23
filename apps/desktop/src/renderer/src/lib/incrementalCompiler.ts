import type { NodeGraph } from '@mc-creator/shared';

import {
  computeGraphHash,
  getCachedCompileResult,
  setCachedCompileResult,
} from './compileCache.js';

/**
 * 增量编译器：简化版，专注于 IndexedDB 缓存
 */
export class IncrementalCompiler {
  private cache: { result: any; timestamp: number } | null = null;

  /**
   * 执行编译（带 IndexedDB 缓存）
   */
  async compile(graph: any): Promise<any> {
    return compileGraph(graph);
  }

  getCacheInfo(): { hasCache: boolean; cacheAge: number } {
    return { hasCache: false, cacheAge: 0 };
  }

  clearCache(): void {
    // no-op for now
  }
}

// 单例实例
export const incrementalCompiler = new IncrementalCompiler();

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

/**
 * 编译入口：按图内容哈希读写 IndexedDB 缓存
 */
export async function compileGraph(graph: any): Promise<any> {
  const graphHash = await computeGraphHash(graph);
  const cached = await getCachedCompileResult(graphHash, graph.modId);
  if (cached && cached.result && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const { compileNodeGraph } = await import('./compileNodeGraph.js');
  const result = await compileNodeGraph(graph);
  await setCachedCompileResult(graphHash, graph.modId, result);
  return result;
}

/**
 * 标记节点/边/子图为脏（供 UI 调用）
 * 当前按内容哈希缓存，图变更后哈希自动失效，无需手动标脏。
 */
export function markGraphDirty(
  _nodeIds?: string[],
  _edgeIds?: string[],
  _subgraphIds?: string[],
): void {
  // no-op：缓存键已包含图内容哈希
}

/**
 * 获取增量编译器状态
 */
export function getIncrementalCompilerStatus() {
  return { hasCache: false, cacheAge: 0 };
}

/**
 * 清除增量编译缓存
 */
export function clearIncrementalCache(): void {
  // no-op：可后续接入 clearAllCache
}

/**
 * 初始化缓存系统（应用启动时调用）
 */
export async function initCompileCache(): Promise<void> {
  try {
    await import('./compileCache.js').then((m) => m.preloadCache?.());
  } catch {
    // 静默失败
  }
}
