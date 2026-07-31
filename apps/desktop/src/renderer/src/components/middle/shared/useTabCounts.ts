import { useMemo } from 'react';
import type { ComponentType } from 'react';
import type { TabItem } from './IconTabBar.js';

/**
 * 基础 Tab 配置（不含 count / hideCount 等运行时字段）。
 * 调用方通常用模块级常量传入。
 */
export interface BaseTab<K extends string> {
  key: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/**
 * 按 tab key 派生的运行时状态：count + 校验错误/警告。
 *
 * - count：该 tab 的条目数（undefined 时不显示计数）
 * - error / warning：该 tab 关联的校验问题数（用于 IconTabBar 显示 ✗ / ⚠ 标记）
 *
 * 返回 undefined 时该字段不显示。
 */
export interface TabStatus {
  count?: number;
  error?: number;
  warning?: number;
}

/**
 * 提取 6 个预览面板共用的 `tabs = useMemo(() => TABS.map(...))` 模式。
 *
 * 调用方传入：
 * - `baseTabs`：模块级常量（key/label/icon）
 * - `spec`：当前 spec（可能为 null，null 时所有 count 为 undefined）
 * - `countFn`：从 spec + key 计算该 tab 的条目数（返回 undefined 表示不计数）
 * - `hideCountOn`：即使能算出 count 也不显示的 tab（如 metadata/export）
 *
 * 返回值可直接传给 `<IconTabBar tabs={tabs} />`。
 *
 * @example
 * ```tsx
 * const tabs = useTabCounts(TABS, mod, (m, key) => countByTab(m, key), HIDE_COUNT);
 * ```
 */
export function useTabCounts<S, K extends string>(
  baseTabs: ReadonlyArray<BaseTab<K>>,
  spec: S | null,
  countFn: (spec: S, key: K) => number | undefined,
  hideCountOn?: ReadonlySet<K>,
): TabItem<K>[] {
  return useMemo(
    () =>
      baseTabs.map((t) => {
        const hide = hideCountOn?.has(t.key) ?? false;
        return {
          key: t.key,
          label: t.label,
          icon: t.icon,
          count: hide || !spec ? undefined : countFn(spec, t.key),
          hideCount: hide,
        };
      }),
    // countFn 一般是模块级函数或稳定引用；spec 决定 count 数值；hideCountOn 是常量
    [baseTabs, spec, countFn, hideCountOn],
  );
}

/**
 * 扩展版 useTabCounts：除 count 外，还支持按 tab 派生 error/warning 状态。
 *
 * DatapackPreviewPanel 等需要展示校验问题的面板用此变体。
 *
 * @example
 * ```tsx
 * const tabs = useTabStatus(TABS, dp, countFn, statusFn, HIDE_COUNT);
 * ```
 */
export function useTabStatus<S, K extends string>(
  baseTabs: ReadonlyArray<BaseTab<K>>,
  spec: S | null,
  countFn: (spec: S, key: K) => number | undefined,
  statusFn: (spec: S, key: K) => Omit<TabStatus, 'count'> | undefined,
  hideCountOn?: ReadonlySet<K>,
): TabItem<K>[] {
  return useMemo(
    () =>
      baseTabs.map((t) => {
        const hide = hideCountOn?.has(t.key) ?? false;
        const status = spec ? statusFn(spec, t.key) : undefined;
        const error = status?.error;
        const warning = status?.warning;
        return {
          key: t.key,
          label: t.label,
          icon: t.icon,
          count: hide || !spec ? undefined : countFn(spec, t.key),
          hideCount: hide,
          error: error && error > 0 ? error : undefined,
          warning: warning && warning > 0 && !(error && error > 0) ? warning : undefined,
        };
      }),
    [baseTabs, spec, countFn, statusFn, hideCountOn],
  );
}
