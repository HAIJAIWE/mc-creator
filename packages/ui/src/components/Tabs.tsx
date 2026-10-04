/**
 * Tabs —— 选项卡（设计文档 §4.5；§10 工作区多视图切换）。
 *
 * 视觉复用 index.css 的 `.mc-tab` / `.mc-tab-idle` / `.mc-tab-selected`
 * （选中态是「顶部 2px accent 高光线 + 凸起面」）+ `.mc-active-bar`
 * （VS Code 活动栏风格的左侧指示条）。
 *
 * a11y 要点（这里是全库最容易写错的地方，逐条落实）：
 * 1. **每个 tab 一个 panel**，未激活的用 `hidden` 藏起来 —— 而不是只渲染
 *    当前 panel 让所有 tab 的 `aria-controls` 指向同一个 id。后者虽然
 *     widespread 但不合规范：`aria-controls` 必须是「这个 tab 控制的面板」。
 * 2. `aria-labelledby` 只出现在 tabpanel 上（指向自己的 tab），
 *    让读屏播报「<tab 名>，选项卡面板」。
 * 3. **roving tabindex**：只有激活的 tab `tabIndex={0}`，其余 -1。
 *    否则 Tab 键会在 N 个 tab 上停 N 次（应停 1 次、方向键切换）。
 * 4. 方向键 / Home / End 导航，且**跳过 disabled 项**（WAI-ARIA APG 要求）。
 */
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../utils';

export interface TabItem {
  /** 唯一值 */
  value: string;
  /** 标签文本 */
  label: ReactNode;
  /** 禁用（不参与方向键导航，点击无效） */
  disabled?: boolean;
  /** 标签右侧的计数徽标 */
  badge?: ReactNode;
}

/** 传给 `children` 渲染函数的状态。 */
export interface TabsPanelState {
  /** 当前面板对应的 tab value */
  value: string;
  /** 对应的 TabItem（找不到时 undefined） */
  item: TabItem | undefined;
}

export interface TabsProps {
  /** tab 列表 */
  items: TabItem[];
  /** 受控选中值。传了就是受控模式 */
  value?: string;
  /** 非受控初始选中值（默认取第一个可用项） */
  defaultValue?: string;
  /** 选中值变化回调（受控/非受控都会调） */
  onValueChange?: (value: string) => void;
  /** 排列方向，决定方向键用左右还是上下，默认 `horizontal` */
  orientation?: 'horizontal' | 'vertical';
  /** tablist 的可访问名 */
  label?: string;
  /**
   * 面板内容。可以是静态 ReactNode（每个 tab 显示同样的内容），
   * 也可以是 `(state: TabsPanelState) => ReactNode` 按 tab 定制。
   */
  children?: ReactNode | ((state: TabsPanelState) => ReactNode);
  /** tablist className 覆盖 */
  className?: string;
  /** tabpanel className 覆盖 */
  panelClassName?: string;
}

/** 把任意 value 变成合法 id 片段（value 可能含中文/空格/斜杠）。 */
function toIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  label,
  children,
  className,
  panelClassName,
}: TabsProps) {
  const uid = useId().replace(/:/g, '');
  const tabId = useCallback((v: string) => `mc-tab-${uid}-${toIdSegment(v)}`, [uid]);
  const panelId = useCallback((v: string) => `mc-tabpanel-${uid}-${toIdSegment(v)}`, [uid]);

  // 受控 / 非受控双支持：判断依据是「有没有传 value」，而不是有没有传
  // defaultValue —— 否则两者都传时行为会含糊。
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string>(
    () =>
      defaultValue ??
      items.find((item) => !item.disabled)?.value ??
      items[0]?.value ??
      '',
  );
  const activeValue = isControlled ? value : internalValue;

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /**
   * 切换选中值。
   *
   * 刻意**不做**「值没变就不回调」的去重：重复点击同一个 tab 本身是有意义的
   * 交互信号（父组件常借此把面板滚回顶部），去重会让这类用法静默失效。
   */
  const select = useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  // 只让可用的 value 参与方向键导航
  const enabledValues = items.filter((item) => !item.disabled).map((item) => item.value);

  const focusTab = useCallback((target: string) => {
    tabRefs.current[target]?.focus();
  }, []);

  const moveFocus = useCallback(
    (delta: number) => {
      if (enabledValues.length === 0) return;
      const currentIndex = enabledValues.indexOf(activeValue);
      // 激活值不在列表里（受控传入非法值）时从头部起步，避免 -1 下标
      const base = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex =
        (base + delta + enabledValues.length) % enabledValues.length;
      const next = enabledValues[nextIndex] as string;
      select(next);
      focusTab(next);
    },
    [activeValue, enabledValues, select, focusTab],
  );

  const focusEdge = useCallback(
    (position: 'first' | 'last') => {
      const target =
        position === 'first' ? enabledValues[0] : enabledValues[enabledValues.length - 1];
      if (target === undefined) return;
      select(target);
      focusTab(target);
    },
    [enabledValues, select, focusTab],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const isHorizontal = orientation === 'horizontal';
      const forward = isHorizontal ? 'ArrowRight' : 'ArrowDown';
      const backward = isHorizontal ? 'ArrowLeft' : 'ArrowUp';

      if (event.key === forward) {
        event.preventDefault();
        moveFocus(1);
      } else if (event.key === backward) {
        event.preventDefault();
        moveFocus(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusEdge('first');
      } else if (event.key === 'End') {
        event.preventDefault();
        focusEdge('last');
      }
    },
    [orientation, moveFocus, focusEdge],
  );

  const renderPanel = (item: TabItem): ReactNode =>
    typeof children === 'function' ? children({ value: item.value, item }) : children;

  return (
    <div className="flex min-h-0 flex-col">
      <div
        role="tablist"
        aria-orientation={orientation}
        {...(label ? { 'aria-label': label } : {})}
        onKeyDown={handleKeyDown}
        className={cx(
          'flex items-center gap-0.5 border-b border-mc-border bg-mc-surface px-1 py-1',
          orientation === 'vertical' && 'flex-col items-stretch',
          className,
        )}
      >
        {items.map((item) => {
          const isActive = item.value === activeValue;
          const disabled = Boolean(item.disabled);
          return (
            // 外层 span 只为承载 .mc-active-bar（absolute 定位需要 relative 父级）
            <span key={item.value} className="relative inline-flex">
              <button
                type="button"
                role="tab"
                id={tabId(item.value)}
                ref={(el) => {
                  tabRefs.current[item.value] = el;
                }}
                aria-selected={isActive}
                aria-controls={panelId(item.value)}
                aria-disabled={disabled ? true : undefined}
                disabled={disabled}
                // roving tabindex：整个 tablist 在 Tab 序列里只占一格
                tabIndex={isActive ? 0 : -1}
                onClick={() => {
                  if (disabled) return;
                  select(item.value);
                }}
                className={cx(
                  'mc-tab cursor-pointer px-2 py-1',
                  isActive ? 'mc-tab-selected' : 'mc-tab-idle',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge !== null ? (
                  <span className="mc-badge">{item.badge}</span>
                ) : null}
              </button>
              {isActive ? <span className="mc-active-bar" aria-hidden="true" /> : null}
            </span>
          );
        })}
      </div>

      {items.map((item) => {
        const isActive = item.value === activeValue;
        return (
          <div
            key={item.value}
            role="tabpanel"
            id={panelId(item.value)}
            aria-labelledby={tabId(item.value)}
            // tabIndex=0：面板内的内容若全是静态文本，键盘用户也要能滚动/聚焦它
            tabIndex={0}
            hidden={!isActive}
            className={cx('px-3 py-3 text-sm text-mc-text', panelClassName)}
          >
            {isActive ? renderPanel(item) : null}
          </div>
        );
      })}
    </div>
  );
}
