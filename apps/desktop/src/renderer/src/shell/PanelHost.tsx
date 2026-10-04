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
export function PanelHost({
  panelId,
  panelProps = {},
  fallback,
  notFound,
}: PanelHostProps) {
  const registration = useMemo(() => {
    return getPanel(panelId);
  }, [panelId]);

  if (!registration) {
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

  const { component: Loader } = registration;
  const LazyComponent = useMemo(() => lazy(Loader), [Loader]);

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