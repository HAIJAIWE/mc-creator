import type { ReactNode } from 'react';
import { SearchInput } from './SearchInput.js';

export interface FilterBarProps {
  /** 搜索框当前值 */
  query: string;
  /** 搜索框回调 */
  onQueryChange: (q: string) => void;
  /** 搜索框 placeholder */
  searchPlaceholder?: string;
  /** 额外筛选控件（通常是 `<select>` 下拉），放在搜索框右侧 */
  children?: ReactNode;
  /** 外层容器 className；默认适配 flex 布局 */
  className?: string;
}

/**
 * 筛选栏：SearchInput + 可选 children（通常是 `<select>` 下拉）。
 *
 * 6 个预览面板共用。ResourcePack 无下拉（children 为空），Mod 有 2 个下拉（稀有度 + 类别），
 * Kubejs/CraftTweaver/BehaviorPack 按 tab 动态显示 1 个下拉，Modpack 有来源 + 排序 2 个下拉。
 */
export function FilterBar({
  query,
  onQueryChange,
  searchPlaceholder,
  children,
  className = 'flex flex-wrap items-center gap-2 border-b border-mc-border px-3 py-2',
}: FilterBarProps) {
  return (
    <div className={className}>
      <div className="flex-1 min-w-[180px]">
        <SearchInput value={query} onChange={onQueryChange} placeholder={searchPlaceholder} />
      </div>
      {children}
    </div>
  );
}
