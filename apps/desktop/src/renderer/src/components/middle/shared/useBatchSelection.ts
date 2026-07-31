import { useState, useCallback, useMemo } from 'react';

/**
 * 批量选择 hook：6 个预览面板共用的 toggle / clear / isSelected 模式。
 *
 * 每个面板通常有 1-3 个 `useState<Set<string>>` 用于不同实体类型
 * （entities / recipes / items / blocks / mods 等）的批量选择。
 * 本 hook 把 toggle / clear / isSelected / size 统一封装。
 *
 * @example
 * ```tsx
 * const entitySelection = useBatchSelection<string>();
 * // JSX:
 * <button onClick={() => entitySelection.toggle(id)}>
 *   {entitySelection.isSelected(id) ? <CheckSquare /> : <Square />}
 * </button>
 * <BatchSelectToolbar
 *   selectedCount={entitySelection.size}
 *   onBatchRemove={() => removeItems(Array.from(entitySelection.selected))}
 *   onClearSelection={entitySelection.clear}
 * />
 * ```
 */
export function useBatchSelection<T>(): {
  selected: Set<T>;
  toggle: (id: T) => void;
  clear: () => void;
  isSelected: (id: T) => boolean;
  size: number;
  setAll: (ids: T[]) => void;
} {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: T) => selected.has(id), [selected]);

  const setAll = useCallback((ids: T[]) => {
    setSelected(new Set(ids));
  }, []);

  // size 单独返回避免每次 set 变化触发依赖 size 的组件全量重渲染
  return useMemo(
    () => ({
      selected,
      toggle,
      clear,
      isSelected,
      size: selected.size,
      setAll,
    }),
    [selected, toggle, clear, isSelected, setAll],
  );
}
