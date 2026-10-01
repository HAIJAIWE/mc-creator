import type { NodeGraph } from '@mc-creator/shared';
import type { CompileResult } from './compileNodeGraph.js';

import {
  computeGraphHash,
  getCachedCompileResult,
  setCachedCompileResult,
} from './compileCache.js';

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

/**
 * 编译入口：按图内容哈希读写 IndexedDB 缓存（24h TTL），未命中则走 compileNodeGraph。
 *
 * 之所以不需要「标脏」接口：缓存键已包含整图内容哈希，图一改哈希即变化、旧条目自动失效。
 *
 * 注：历史上此文件还有 `IncrementalCompiler` 类、`incrementalCompiler` 单例以及
 * `markGraphDirty` / `getIncrementalCompilerStatus` / `clearIncrementalCache` /
 * `initCompileCache` 等导出，但它们全仓零引用且多为返回假状态或空的桩实现
 * （例如 `getCacheInfo()` 恒返回 `hasCache: false`），已按「增量编译器死代码」清理。
 */
export async function compileGraph(graph: NodeGraph): Promise<CompileResult> {
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
