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
 * 5. **带关闭按钮的 tab 用 `div[role=tab]` 承载，不带时仍是 `button[role=tab]`**：
 *    `<button>` 里嵌 `<button>` 是非法 HTML（HTML 解析器会把内层 button 提出
 *    外层，React 侧也会报 validateDOMNesting 警告），所以只要 `closeable`
 *    打开就换成 div + 手写 Enter/Space 激活；没打开时 DOM 与扩展前一字不差，
 *    既有断言/快照不会漂移。
 * 6. **tab 内有装饰性子元素时给 tab 显式 `aria-label`**：可访问名默认取自子
 *    元素文本，关闭按钮的「关闭 a.ts」和脏标记的「未保存」会被拼进 tab 名，
 *    读成「a.ts关闭 a.ts未保存」——冗余且误导。`closeable` / `dirty` 任一为真
 *    就把 tab 名固定成纯文本（`TabItem.ariaLabel` → 字符串 label → value）。
 *
 * ## 文件标签栏能力（desktop TabBar 迁移用，默认全关）
 *
 * `icon` / `closeable` / `dirty` / `onTabAuxClick` / `onTabContextMenu` /
 * `closeLabel` / `dirtyLabel` 全部 opt-in：不传时渲染结果与扩展前完全一致。
 * `children` 省掉时面板区退化成一组 hidden 空 panel —— 正好是「只有标签栏、
 * 没有面板」的文件标签栏语义。
 */
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  /**
   * 标签左侧的图标槽（desktop 放文件类型图标）。
   * 渲染时套 `aria-hidden` —— 文件名文字已经表达了内容，图标是纯装饰，
   * 让读屏念一遍只是噪声。
   */
  icon?: ReactNode;
  /**
   * tab 的纯文本可访问名。两个用途：
   * ① `label` 是非文本 ReactNode（或塞了图标）时给读屏一个稳定名字；
   * ② `closeable` / `dirty` 打开时用它把 tab 名固定住，避免子元素文案被拼进来
   * （见文件头第 6 条）。缺省时依次退回「字符串 label」→「value」。
   */
  ariaLabel?: string;
  /** 渲染 tab 内的关闭按钮 */
  closeable?: boolean;
  /** 关闭按钮点击回调（默认只回调，不动选中值 —— 关不关是调用方的账） */
  onClose?: (value: string) => void;
  /** 渲染未保存标记（金色圆点，语义色 `--mc-gold`） */
  dirty?: boolean;
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
  /**
   * tab 上的**辅助键点击**（中键等）。只在 `button !== 0`（非常规键）时触发，
   * 常规左键点击仍然只走 `onValueChange`。
   *
   * 中键默认会被组件 `preventDefault`：X11 上中键是「粘贴主选择区」，
   * 浏览器里还会触发滚动光标 —— 在标签栏上两者都是纯噪音。
   */
  onTabAuxClick?: (value: string, button: number) => void;
  /**
   * tab 上的右键。**默认不 preventDefault** —— 弹不弹上下文菜单是调用方的
   * 决定（组件无权替它决定）；回调拿到的是原生 MouseEvent，需要拦就自己拦。
   */
  onTabContextMenu?: (value: string, event: MouseEvent) => void;
  /**
   * 关闭按钮可访问名的生成器，默认产出中文「关闭 X」（对齐现状）。
   * 与 Modal.closeLabel 同理：i18n §4.5 要求多语言由文案层统一，组件不该
   * 把中文硬编码成唯一可选项。
   */
  closeLabel?: (value: string, label: string) => string;
  /** 未保存标记的可访问名，默认中文（i18n 理由同 `closeLabel`） */
  dirtyLabel?: string;
  /**
   * 关闭按钮的图标（ReactNode），默认字符 `×`。
   *
   * 为什么开这个槽：组件零第三方依赖，**塞不进 lucide-react 之类图标库**，
   * 而调用方（如 desktop 文件标签栏）原本用自己的图标，迁移后肉眼可见地
   * 变成字符 `×`。给个插槽让调用方把图标传进来，组件仍保持零依赖。
   * 不传时行为与加此 prop 前完全一致（回落字符 ×）。
   */
  closeIcon?: ReactNode;
}

/** 把任意 value 变成合法 id 片段（value 可能含中文/空格/斜杠）。 */
function toIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 关闭按钮可访问名的默认实现（中文，对齐现状；多语言请传 `closeLabel`）。 */
function defaultCloseLabel(_value: string, label: string): string {
  return `关闭 ${label}`;
}

/** 未保存标记可访问名的默认值。 */
const DEFAULT_DIRTY_LABEL = '未保存的更改';

/** 取 tab 的纯文本名：`ariaLabel` → 字符串 label → value。 */
function tabTextLabel(item: TabItem): string {
  if (item.ariaLabel !== undefined) return item.ariaLabel;
  return typeof item.label === 'string' ? item.label : item.value;
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
  onTabAuxClick,
  onTabContextMenu,
  closeLabel = defaultCloseLabel,
  dirtyLabel = DEFAULT_DIRTY_LABEL,
  closeIcon,
}: TabsProps) {
  const uid = useId().replace(/:/g, '');
  const tabId = useCallback((v: string) => `mc-tab-${uid}-${toIdSegment(v)}`, [uid]);
  const panelId = useCallback((v: string) => `mc-tabpanel-${uid}-${toIdSegment(v)}`, [uid]);

  // 受控 / 非受控双支持：判断依据是「有没有传 value」，而不是有没有传
  // defaultValue —— 否则两者都传时行为会含糊。
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string>(
    () => defaultValue ?? items.find((item) => !item.disabled)?.value ?? items[0]?.value ?? '',
  );
  const activeValue = isControlled ? value : internalValue;

  /**
   * **items 可变时的选中兜底**。
   *
   * 受控模式下 `value` 是调用方的账：文件标签被关掉、父组件还没同步过来时，
   * `activeValue` 会悬空 —— 症状是「一个 tab 都不高亮、面板全 hidden、
   * 方向键又从 0 号重新起步」，用户眼里就是标签栏突然丢了焦点位置。
   *
   * 兜底**只在渲染期**做：activeValue 不在 items 里就临时高亮第一个未禁用项，
   * 既不改受控值、不回调、也不写回 state（那会把「父组件正在同步」的中间态
   * 变成一次静默的选中，等父组件把 value 同步回来兜底自然失效）。
   * 方向键导航也用兜底后的值算起点，避免从错误的 tab 继续跳。
   */
  const highlightedValue = items.some((item) => item.value === activeValue)
    ? activeValue
    : (items.find((item) => !item.disabled)?.value ?? items[0]?.value ?? '');

  // 元素类型随 closeable 在 button / div 之间切换，ref 只用到 .focus()
  const tabRefs = useRef<Record<string, HTMLElement | null>>({});

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
      const currentIndex = enabledValues.indexOf(highlightedValue);
      // 兜底值仍可能落在 disabled 项上（受控显式选中的禁用项），同样从头部起步
      const base = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex = (base + delta + enabledValues.length) % enabledValues.length;
      const next = enabledValues[nextIndex] as string;
      select(next);
      focusTab(next);
    },
    [highlightedValue, enabledValues, select, focusTab],
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

  /**
   * 中键等辅助键点击。
   *
   * 只有 `button !== 0`（非常规键）才算「辅助键点击」—— 左键点击必须继续
   * 走 tab 自己的 onClick，否则一个 click 事件会被回调两次。
   * 中键顺手 preventDefault：X11 上它是「粘贴主选择区」，浏览器里还会拉出
   * 滚动光标，在标签栏上两者都是纯噪音（desktop 现状也是这么拦的）。
   */
  const handleTabAuxClick =
    (itemValue: string) =>
    (event: ReactMouseEvent): void => {
      if (event.button === 0) return;
      if (event.button === 1) event.preventDefault();
      onTabAuxClick?.(itemValue, event.button);
    };

  /** 右键。默认**不** preventDefault，弹不弹菜单交给调用方。 */
  const handleTabContextMenu =
    (itemValue: string) =>
    (event: ReactMouseEvent): void => {
      onTabContextMenu?.(itemValue, event.nativeEvent);
    };

  /**
   * div[role=tab] 的 Enter/Space 激活（原生 button 自带，div 没有）。
   *
   * 只处理**落在 tab 自身**上的按键：关闭按钮在 tab 内部，它冒泡上来的
   * Enter/Space 属于「关掉这个 tab」，绝不能顺手把 tab 也选中。
   */
  const handleTabActivationKey =
    (itemValue: string, disabled: boolean) =>
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (disabled) return;
      select(itemValue);
    };

  /**
   * tab 内的关闭按钮。
   *
   * 键盘可达性方案：**只有「选中项」的关闭按钮进 Tab 序列**
   * （tabIndex = isActive ? 0 : -1）。
   *
   * roving tabindex 的全部意义就是「一排 tab 只占一格 Tab」。若每个关闭按钮
   * 都给 tabIndex=0，Tab 键要在 N 个按钮上停 N 次（10 个文件 = 连按 10+ 次
   * Tab 才穿得过标签栏），比不做 roving 还糟。业界（Chrome / VS Code）就是
   * 只在选中 tab 内露出可聚焦的关闭按钮：标签栏最多占 2 格（选中 tab + 它的
   * 关闭按钮）；方向键移到别的 tab 后立刻能 Tab 到它的关闭按钮，不会形成
   * 「一排按钮都够不着」的孤岛。代价是非选中 tab 的关闭按钮得先选中才能聚焦
   * —— 对比「关掉一个非选中文件」这个低频操作的成本，可以接受。
   */
  const renderCloseButton = (item: TabItem, isActive: boolean, disabled: boolean): ReactNode => {
    if (item.closeable !== true) return null;
    return (
      <button
        type="button"
        aria-label={closeLabel(item.value, tabTextLabel(item))}
        tabIndex={isActive ? 0 : -1}
        disabled={disabled}
        onClick={(event) => {
          // 必须 stopPropagation：关闭按钮在 tab 内部，不拦的话一次点击会
          // 连带触发 tab 选中（关掉 A 却把焦点又跳到 A）—— 这类组件最常见的 bug
          event.stopPropagation();
          item.onClose?.(item.value);
        }}
        className="rounded-mc p-0.5 text-mc-mute transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
      >
        {/*
          关闭图标可注入：desktop 标签栏原本用 lucide-react 的 <X> 线条图标，
          写死字符 × 会让它肉眼可见地变样。组件零第三方依赖（塞不进 lucide），
          所以把插槽开给调用方 —— 不传时仍回落到字符 ×（零依赖基线不变）。
          aria-hidden 是必须的：按钮的可访问名来自 aria-label="关闭 X"，
          里面的图形再被念一遍就是噪声。
        */}
        <span aria-hidden="true">{closeIcon ?? '×'}</span>
      </button>
    );
  };

  /** tab 内部内容：图标 → 标签 → 徽标 → 脏标记 → 关闭按钮。 */
  const renderTabContent = (item: TabItem, isActive: boolean, disabled: boolean): ReactNode => (
    <>
      {item.icon !== undefined && item.icon !== null ? (
        <span className="inline-flex shrink-0 items-center" aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      <span>{item.label}</span>
      {item.badge !== undefined && item.badge !== null ? (
        <span className="mc-badge">{item.badge}</span>
      ) : null}
      {item.dirty === true ? (
        // role=img + aria-label：纯视觉圆点对读屏用户等于不存在，
        // 必须让它以「未保存的更改」这个语义进入无障碍树。
        <span className="text-mc-gold" role="img" aria-label={dirtyLabel}>
          ●
        </span>
      ) : null}
      {renderCloseButton(item, isActive, disabled)}
    </>
  );

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
          const isActive = item.value === highlightedValue;
          const disabled = Boolean(item.disabled);
          const hasCloseButton = item.closeable === true;
          const attachRef = (el: HTMLElement | null): void => {
            tabRefs.current[item.value] = el;
          };
          /**
           * tab 自己的 className / 事件，两种承载元素共用。
           * closeable 时用 `div[role=tab]`（button 套 button 是非法 HTML），
           * 否则仍是 `<button role="tab">` —— DOM 与扩展前一字不差。
           */
          const shared = {
            role: 'tab' as const,
            id: tabId(item.value),
            'aria-selected': isActive,
            'aria-controls': panelId(item.value),
            'aria-disabled': disabled ? true : undefined,
            // tab 内有子元素文案时固定可访问名，否则会读成「a.ts关闭 a.ts未保存」
            ...(item.closeable === true || item.dirty === true
              ? { 'aria-label': tabTextLabel(item) }
              : {}),
            // roving tabindex：整个 tablist 在 Tab 序列里只占一格
            tabIndex: isActive ? 0 : -1,
            onClick: () => {
              if (disabled) return;
              select(item.value);
            },
            // 辅助键/右键默认**不挂任何监听**（调用方不传就没有这个交互）
            ...(onTabAuxClick ? { onAuxClick: handleTabAuxClick(item.value) } : {}),
            ...(onTabContextMenu ? { onContextMenu: handleTabContextMenu(item.value) } : {}),
            className: cx(
              'mc-tab cursor-pointer px-2 py-1',
              isActive ? 'mc-tab-selected' : 'mc-tab-idle',
              disabled && 'cursor-not-allowed opacity-50',
            ),
          };
          return (
            // 外层 span 只为承载 .mc-active-bar（absolute 定位需要 relative 父级）
            <span key={item.value} className="relative inline-flex">
              {hasCloseButton ? (
                <div
                  {...shared}
                  ref={attachRef}
                  onKeyDown={handleTabActivationKey(item.value, disabled)}
                >
                  {renderTabContent(item, isActive, disabled)}
                </div>
              ) : (
                <button type="button" {...shared} ref={attachRef} disabled={disabled}>
                  {renderTabContent(item, isActive, disabled)}
                </button>
              )}
              {isActive ? <span className="mc-active-bar" aria-hidden="true" /> : null}
            </span>
          );
        })}
      </div>

      {items.map((item) => {
        const isActive = item.value === highlightedValue;
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
