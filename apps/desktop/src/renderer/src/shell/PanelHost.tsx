import { Suspense, useMemo, lazy } from 'react';
import { getPanel } from './panels.js';

interface PanelHostProps {
  /** 面板 ID（对应 panelRegistry 中的 key） */
  panelId: string;
  /** 额外透传给面板组件的 props */
  panelProps?: Record<string, unknown> | undefined;
  /** 加载态 fallback（可选，默认统一占位） */
  fallback?: React.ReactNode;
  /** 找不到面板时的 fallback */
  notFound?: React.ReactNode;
}

/**
 * 通用面板宿主：根据 panelId 从注册表取组件并渲染。
 * - 自动包裹 Suspense
 * - 支持额外 props 透传
 * - 面板组件约定：接收 panelProps 作为单一 prop 对象
 */
export function PanelHost({ panelId, panelProps = {}, fallback, notFound }: PanelHostProps) {
  const registration = useMemo(() => {
    return getPanel(panelId);
  }, [panelId]);

  // Hook 必须无条件、且在 early return 之前调用。
  //
  // 为什么：`registration` 会随渲染从「有」变「无」（或反过来）——
  // 面板可动态注册。调用方渲染 `<PanelHost panelId={state} />` 时，
  // state 从「未注册的 id」切到「已注册的 id」，memo 重算、
  // registration 由 undefined 变有值，hook 数量 1 → 2，React 直接抛
  // "Rendered more hooks than during the previous render"；反向切换则抛
  // "Rendered fewer hooks than expected ... accidental early return"，整个面板树白屏。
  //
  // 注意触发路径**必须换 panelId**：`registration` 的 useMemo 只依赖 [panelId]，
  // 同一 id 的重渲染不会重查注册表，所以「同 id 下注册表增删」观察不到，
  // 也不会改变 hook 数量。见 PanelHost.test.tsx。
  //
  // 所以这里对「未注册」返回 null 而不是跳过 hook，early return 挪到两个
  // useMemo 之后 —— hook 数量恒为 2，与 registration 是否存在无关。
  const LazyComponent = useMemo(
    () => (registration ? lazy(registration.component) : null),
    [registration],
  );

  if (!registration || LazyComponent === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-mc-bg text-sm text-mc-mute">
        {notFound ?? (
          <>
            面板未注册: <code className="font-mono">{panelId}</code>
          </>
        )}
      </div>
    );
  }

  return (
    <Suspense fallback={fallback ?? <PanelLoadingFallback />}>
      <LazyComponent {...panelProps} />
    </Suspense>
  );
}

/** 默认加载占位 */
function PanelLoadingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center bg-mc-bg text-sm text-mc-dim">
      加载面板…
    </div>
  );
}

/** 批量渲染多个面板（用于标签页切换等场景） */
export function PanelHostList({
  panelIds,
  activeId,
  panelProps,
  fallback,
}: {
  panelIds: string[];
  activeId: string;
  panelProps?: Record<string, unknown>;
  fallback?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {panelIds.map((id) => (
        <div
          key={id}
          className={id === activeId ? 'flex-1' : 'hidden'}
          role="tabpanel"
          aria-labelledby={`tab-${id}`}
        >
          <PanelHost panelId={id} panelProps={panelProps} fallback={fallback} />
        </div>
      ))}
    </div>
  );
}
