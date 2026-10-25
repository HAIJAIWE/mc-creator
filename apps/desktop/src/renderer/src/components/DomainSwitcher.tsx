/**
 * 顶部域切换器（§0.2「三域并列 + 智能体横向贯穿」的导航层入口）
 *
 * ## 为什么是 tablist/tab 而不是一组按钮
 *
 * 它在语义上确实是「一组互斥选项，切换同一个区域的内容」= WAI-ARIA Tabs：
 * - `role="tablist"` + 每项 `role="tab"` + `aria-selected`，读屏会播报「第 N 项，共 3 项，已选中」，
 *   而 `role="group"` + `aria-pressed`（ActivityBar 那套 toolbar 模式）只会被读成三个独立开关。
 * - 采用**自动激活**（Automatic Activation）：方向键移动焦点即同时切换域。
 *   域切换本身是纯本地状态更新、无网络往返，不该让用户多按一次 Enter；
 *   这也是 APG 对「面板内容立刻可见」的 tablist 的推荐做法。
 * - Roving tabindex + 左右箭头 / Home / End：整组只占 1 个 Tab 停靠点，10 个 Tab 位不被吃掉
 *   （与 TabBar 头注释里记的同一个坑一致）。
 *
 * ## 文案
 *
 * 显示名优先走 i18n（`domains.<id>`）；i18n 缺键时回落到 domains.ts 的中文真源，
 * 保证组件在语言包未补齐时也不会露出裸 key。
 */
import { useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation.js';
import {
  DOMAINS,
  DOMAIN_IDS,
  getDomain,
  type DomainDefinition,
  type DomainId,
} from '../shell/domains.js';
import { useWorkbenchStore, selectDomain, selectSetDomain } from '../shell/workbench-store.js';

interface DomainSwitcherProps {
  /** 受控覆盖（不传则读 workbench-store）—— 便于单测与将来做外壳级联动的场景 */
  value?: DomainId;
  /** 切域回调（不传则直接写 workbench-store） */
  onChange?: (domain: DomainId) => void;
}

/** 取显示名：i18n 命中就用译文，未命中回落到中文真源 */
function domainLabel(def: DomainDefinition, t: (key: string) => string): string {
  const translated = t(def.labelKey);
  return translated === def.labelKey ? def.labelZh : translated;
}

/** 取一句话职责：与显示名同一套回落规则 */
function domainSummary(def: DomainDefinition, t: (key: string) => string): string {
  const translated = t(def.summaryKey);
  return translated === def.summaryKey ? def.summaryZh : translated;
}

export function DomainSwitcher({ value, onChange }: DomainSwitcherProps = {}) {
  const { t } = useTranslation();
  const storeDomain = useWorkbenchStore(selectDomain);
  const setStoreDomain = useWorkbenchStore(selectSetDomain);
  const active = value ?? storeDomain;
  const listRef = useRef<HTMLDivElement | null>(null);

  const select = (next: DomainId) => {
    if (onChange) onChange(next);
    else setStoreDomain(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const idx = DOMAIN_IDS.indexOf(active);
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % DOMAIN_IDS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + DOMAIN_IDS.length) % DOMAIN_IDS.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = DOMAIN_IDS.length - 1;
    } else {
      return; // 其它键交回浏览器（Tab / Enter / Space）
    }
    e.preventDefault();
    select(DOMAIN_IDS[nextIdx]);
    // 按 data-domain-tab 定位目标 tab，而不是 ref 住「当前激活那个」：
    // setDomain/onChange 引发的重渲染可能还没发生（父层也可能拒收这次切换），
    // 但目标 tab 一定已经在 DOM 里，焦点照搬不会丢。
    requestAnimationFrame(() => {
      const next = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-domain-tab="${DOMAIN_IDS[nextIdx]}"]`,
      );
      next?.focus();
    });
  };

  return (
    <div
      ref={listRef}
      className="flex h-9 items-center gap-1 border-b border-mc-border bg-mc-surface px-3"
      role="tablist"
      aria-label={t('domains.switcherLabel')}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
    >
      {/* 智能体横向贯穿：三域都在，右侧 AgentPanel 常驻 —— 这里只标注不占域位 */}
      <span className="mr-2 text-[10px] text-mc-mute" aria-hidden="true">
        {t('domains.agentHint')}
      </span>

      {DOMAINS.map((def) => {
        const isActive = def.id === active;
        return (
          <button
            key={def.id}
            type="button"
            role="tab"
            id={`domain-tab-${def.id}`}
            data-domain-tab={def.id}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => select(def.id)}
            title={t(def.summaryKey)}
            className={`rounded-mc px-3 py-1 text-xs transition-colors ${
              isActive
                ? 'bg-mc-surface-2 font-medium text-mc-text'
                : 'text-mc-dim hover:bg-mc-surface-2 hover:opacity-60 hover:text-mc-text'
            }`}
          >
            {domainLabel(def, t)}
          </button>
        );
      })}

      {/* 当前域的一句话职责：常驻可见，不必靠悬停 title 才发现「这个域是干嘛的」 */}
      <span className="ml-2 truncate text-[11px] text-mc-mute">
        {domainSummary(getDomain(active), t)}
      </span>
    </div>
  );
}
