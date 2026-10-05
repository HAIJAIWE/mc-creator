/**
 * Dropdown —— 下拉选择器（设计文档 §4.5；§12 设置项）。
 *
 * 视觉复用 index.css 的 `.mc-select`（与 Input 同族的紧凑控件），
 * 浮层复用 `.mc-pop`（圆角 + 强边框 + `--mc-shadow-pop` 投影）。
 *
 * 选 `role="combobox"` + `role="listbox"` 而非裸 button + div：
 * 这样读屏会播报「选择框，已折叠/已展开，X 项」，
 * 而 `aria-activedescendant` 让「视觉高亮」和「真实焦点」解耦 ——
 * 焦点始终留在触发按钮上（用户不会被焦点跳进浮层而丢失位置），
 * 只用 aria-activedescendant 指向当前高亮项。这是 WAI-ARIA APG
 * 对 select-only combobox 的标准做法。
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../utils';

export interface DropdownItem {
  /** 唯一值 */
  value: string;
  /** 显示文本 */
  label: ReactNode;
  /** 禁用（不可选、方向键跳过） */
  disabled?: boolean;
  /** 左侧图标 */
  icon?: ReactNode;
}

export interface DropdownProps {
  /** 选项列表 */
  items: DropdownItem[];
  /** 受控选中值 */
  value?: string;
  /** 非受控初始选中值 */
  defaultValue?: string;
  /** 选中值变化回调 */
  onValueChange?: (value: string) => void;
  /** 未选中时的占位文案，默认 `请选择` */
  placeholder?: string;
  /** 受控展开状态 */
  open?: boolean;
  /** 展开状态变化回调 */
  onOpenChange?: (open: boolean) => void;
  /** 触发器的可访问名 */
  label?: string;
  /** 整体禁用 */
  disabled?: boolean;
  /** 根容器 className 覆盖 */
  className?: string;
  /** 浮层 className 覆盖 */
  listboxClassName?: string;
}

export function Dropdown({
  items,
  value,
  defaultValue,
  onValueChange,
  placeholder = '请选择',
  open,
  onOpenChange,
  label,
  disabled = false,
  className,
  listboxClassName,
}: DropdownProps) {
  const uid = useId().replace(/:/g, '');
  const listboxId = `mc-dropdown-listbox-${uid}`;
  // 用下标做 id 片段：value 可能含中文/空格，index 天然合法且唯一
  const optionId = useCallback((index: number) => `mc-dropdown-option-${uid}-${index}`, [uid]);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ---- 受控 / 非受控 ----
  const isOpenControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isOpenControlled ? open : internalOpen;

  const isValueControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string | undefined>(() => defaultValue);
  const currentValue = isValueControlled ? value : internalValue;

  /**
   * 当前「视觉高亮」下标，与选中值区分开（键盘导航改的是它）。
   *
   * 三态而不是两态，这是「回退高亮」能同时满足几条互斥要求的关键：
   * - `null` = **从未导航过**（含受控模式下父组件直接给 `open={true}`）。
   *   此时高亮落在当前选中项上（见下方 fallbackActiveIndex），否则
   *   aria-activedescendant 会空着、Enter 选不中任何项，与非受控模式不一致。
   * - `>= 0` = 用户（或 openListbox）显式指定的高亮项。
   * - `-1` = **显式清空**（收起浮层 / Escape / Tab）。必须与 null 区分：
   *   若清空后仍走 fallback，收起状态下 aria-activedescendant 会因为
   *   「还有选中项」而重新出现 —— 读屏会宣告一个已经看不见的浮层位置。
   */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const selectedItem = items.find((item) => item.value === currentValue);
  // 次要文字色用 `text-mc-mute`（tailwind.config.js 定义的是 mc.mute）；
  // 曾误写 `text-mc-text-mute` —— 那个键从不存在，静默不生成样式。

  /**
   * 从未导航过时的回退高亮：有选中值就落在选中项上，没有选中值则**不猜**。
   *
   * 为什么不猜第一项：空 Dropdown 展开后直接按 Enter 就静默写入第一项，
   * 是「用户没选却被提交了值」—— 设置类表单里这类误写代价很高，
   * 所以无选中值时宁可没有高亮（Enter 空操作），等用户先动一次方向键。
   */
  const fallbackActiveIndex =
    currentValue === undefined
      ? -1
      : items.length === 0
        ? -1
        : Math.max(
            0,
            items.findIndex((item) => item.value === currentValue),
          );
  const activeOptionIndex = activeIndex === null ? fallbackActiveIndex : activeIndex;

  const setOpenState = useCallback(
    (next: boolean) => {
      if (!isOpenControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isOpenControlled, onOpenChange],
  );

  const closeListbox = useCallback(() => {
    setOpenState(false);
    setActiveIndex(-1);
  }, [setOpenState]);

  const openListbox = useCallback(() => {
    if (disabled) return;
    // 打开时把高亮落在当前选中项上（没有选中项则第一项）。
    // 这里给的是**显式**高亮而非留 null：非受控模式下 openListbox 是唯一的
    // 展开入口，若留 null 就退回「无选中值不猜」的语义，用户展开后看不到高亮。
    setActiveIndex(
      Math.max(
        0,
        items.findIndex((item) => item.value === currentValue),
      ),
    );
    setOpenState(true);
  }, [disabled, items, currentValue, setOpenState]);

  const selectItem = useCallback(
    (item: DropdownItem) => {
      if (item.disabled) return;
      if (!isValueControlled) setInternalValue(item.value);
      onValueChange?.(item.value);
      closeListbox();
      // 选中后把焦点收回触发器，否则焦点会停在已被卸载的浮层上（丢焦点）
      triggerRef.current?.focus();
    },
    [isValueControlled, onValueChange, closeListbox],
  );

  /** 方向键移动高亮，跳过 disabled 项；到头则环绕。 */
  const moveActive = useCallback(
    (delta: number) => {
      const count = items.length;
      if (count === 0) return;
      // 从「实际生效的高亮」出发（activeOptionIndex 已含受控模式的回退），
      // 否则受控打开时第一次 ArrowDown 会跳回第一项而非选中项的下一项。
      // 无高亮时：向下从表头之后起步，向上从表尾之前起步（都跳过 0 号，
      // 因为 0 号会在下面被 +delta 又走一遍）。
      const start = activeOptionIndex < 0 ? (delta > 0 ? -1 : 0) : activeOptionIndex;
      let index = start;
      for (let step = 1; step <= count; step += 1) {
        index = (index + delta + count) % count;
        const candidate = items[index];
        if (candidate && !candidate.disabled) {
          setActiveIndex(index);
          return;
        }
      }
    },
    [activeOptionIndex, items],
  );

  /** 跳到首个/末个可用项（Home / End）。找不到可用项时不动。 */
  const focusEdge = useCallback(
    (position: 'first' | 'last') => {
      const ordered = position === 'first' ? items : [...items].reverse();
      const found = ordered.find((item) => !item.disabled);
      if (found) setActiveIndex(items.indexOf(found));
    },
    [items],
  );

  // 点击外部关闭。监听 mousedown 而非 click：mousedown 先于 click，
  // 能在用户点到别的控件前就把浮层拆掉，避免「点一下按钮先关浮层再触发按钮」
  const handlePointerDown = useCallback(
    (event: globalThis.MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return;
      closeListbox();
    },
    [closeListbox],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, handlePointerDown]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return;

    if (!isOpen) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        // Space 在 button 上会滚动页面，先拦掉
        event.preventDefault();
        openListbox();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        focusEdge('first');
        break;
      case 'End':
        event.preventDefault();
        focusEdge('last');
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = activeOptionIndex >= 0 ? items[activeOptionIndex] : undefined;
        if (item) selectItem(item);
        break;
      }
      case 'Escape':
        event.preventDefault();
        closeListbox();
        triggerRef.current?.focus();
        break;
      case 'Tab':
        // Tab 是「移到下一个控件」，顺带收起浮层，不阻止默认行为
        closeListbox();
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        type="button"
        ref={triggerRef}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && activeOptionIndex >= 0 ? optionId(activeOptionIndex) : undefined
        }
        {...(label ? { 'aria-label': label } : {})}
        disabled={disabled}
        onClick={() => (isOpen ? closeListbox() : openListbox())}
        onKeyDown={handleKeyDown}
        className={cx(
          'mc-select flex w-full items-center justify-between gap-2 text-left',
          isOpen && 'border-mc-accent',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className={cx('truncate', selectedItem ? 'text-mc-text' : 'text-mc-mute')}>
          {selectedItem ? selectedItem.label : placeholder}
        </span>
        {/* 纯装饰的展开箭头，不参与朗读（状态由 aria-expanded 表达） */}
        <span aria-hidden="true" className="shrink-0 text-mc-mute">
          ▾
        </span>
      </button>

      {isOpen ? (
        <ul
          role="listbox"
          id={listboxId}
          {...(label ? { 'aria-label': label } : {})}
          className={cx(
            'mc-pop absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-auto py-1',
            listboxClassName,
          )}
        >
          {items.map((item, index) => {
            const isSelected = item.value === currentValue;
            const isActive = index === activeOptionIndex;
            return (
              <li
                key={item.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={item.disabled ? true : undefined}
                onMouseEnter={() => {
                  if (!item.disabled) setActiveIndex(index);
                }}
                // 阻止默认 mousedown 失焦，否则点击会先触发 document 的
                // 「点外部关闭」逻辑
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectItem(item)}
                className={cx(
                  'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-mc-text',
                  isActive && !item.disabled && 'bg-mc-surface-3',
                  item.disabled && 'cursor-not-allowed opacity-50 text-mc-mute',
                )}
              >
                {item.icon ? <span className="mc-icon-svg shrink-0">{item.icon}</span> : null}
                <span className="flex-1 truncate">{item.label}</span>
                {isSelected ? (
                  <span aria-hidden="true" className="shrink-0 text-mc-accent">
                    ✓
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
