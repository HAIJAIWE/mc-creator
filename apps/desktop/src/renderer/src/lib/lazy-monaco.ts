import { lazy } from 'react';

/**
 * Monaco Editor 懒加载包装。
 *
 * Monaco 是 ~5MB 的大依赖，首次打开代码视图前不需要加载。
 * 用 React.lazy 延迟到首次渲染 <Editor> / <DiffEditor> 时才动态 import。
 *
 * 3 个使用点（CodePreview / SplitCodeEditor / AgentPanel）共享同一个 lazy chunk，
 * 只在第一次实际使用时加载一次。
 *
 * 调用方需用 <Suspense> 包裹，fallback 推荐用 <Loader2 className="animate-spin" />。
 */
export const LazyEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.Editor })),
);

export const LazyDiffEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.DiffEditor })),
);
