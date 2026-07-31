/**
 * useLiveRegion — 重新导出 lib/useLiveRegion 的实现
 *
 * 任务说明要求 useLiveRegion.ts 位于 components/common/，但实际实现已在
 * lib/useLiveRegion.ts（主代理集成 NodeGraphEditor.tsx 时引用的路径）。
 * 这里作为 re-export，避免两份实现冲突，同时满足任务文件路径要求。
 *
 * API 详见 lib/useLiveRegion.ts。
 */
export {
  useLiveRegion,
  type UseLiveRegionOptions,
  type UseLiveRegionResult,
} from '../../lib/useLiveRegion.js';
