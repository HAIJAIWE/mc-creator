import type { ComponentType } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** 该 tab 的条目数；undefined 时不显示计数 */
  count?: number;
  /** 即使 count 已知也不显示计数（用于 metadata/export 等非列表 tab） */
  hideCount?: boolean;
}

export interface IconTabBarProps<K extends string> {
  tabs: TabItem<K>[];
  activeTab: K;
  onSelect: (tab: K) => void;
  /** 外层容器 className；默认适配 5 个 PreviewPanel 的样式 */
  className?: string;
}

/**
 * 图标 Tab 栏：横向排列的 tab 按钮，支持图标 + 计数。
 *
 * 5 个预览面板共用（Mod/BehaviorPack/CraftTweaker/Kubejs/ResourcePack）。
 * Modpack 的子视图切换样式略不同（无图标、按钮更紧凑），可通过 className 覆盖。
 *
 * 调用方需把 `setActiveTab + setQuery('') + setXxxFilter('all')` 包装到 onSelect handler。
 */
export function IconTabBar<K extends string>({
  tabs,
  activeTab,
  onSelect,
  className = 'flex flex-wrap items-center gap-1 border-b border-mc-border bg-mc-surface px-2 py-1',
}: IconTabBarProps<K>) {
  return (
    <div className={className}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const showCount = !t.hideCount && t.count !== undefined;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className={`flex items-center gap-1 rounded-mc px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {t.label}
            {showCount && <span className="ml-0.5 text-mc-mute">({t.count})</span>}
          </button>
        );
      })}
    </div>
  );
}
