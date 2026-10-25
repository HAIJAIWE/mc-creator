import { useState, Fragment } from 'react';
import { McMark } from './McMark.js';
import { useTranslation } from '../hooks/useTranslation.js';
import { getShellPanels } from '../shell/panels.js';

interface ActivityBarProps {
  /**
   * **左侧边栏**是否展开。
   *
   * ## 为什么它与 `activePanel` 是两件事
   *
   * explorer（文件树）只住在左栏 —— 中栏永不渲染它，否则屏幕上会有两个文件树
   * （`explorer-duplication.repro.test.tsx` 实锤过，见 App.tsx 的 handleActivityChange）。
   * 所以 explorer 图标的选中态表达的是「左栏展开着」，而不是「中栏正在渲 explorer」。
   * `aria-pressed` 必须如实反映这一点，否则读屏用户听到的与画面不符。
   */
  leftCollapsed: boolean;
  /** 中栏当前激活的面板 id（经 resolveActivePanel 过滤，绝不会是 'explorer'） */
  activePanel: string;
  /** 切换面板回调。explorer 会被 App 转成折叠/展开左栏，不会走到这里选中中栏 */
  onChange: (panelId: string) => void;
  /** 点击品牌标返回 Dashboard 首屏 */
  onHome?: () => void;
}

/** 左栏专属面板：它的图标管的是侧栏，不是中栏 */
const SIDEBAR_PANEL_ID = 'explorer';

export function ActivityBar({ leftCollapsed, activePanel, onChange, onHome }: ActivityBarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { t } = useTranslation();

  /**
   * 活动栏只承载 shell（core）基础设施面板：
   * explorer / search / git / packages / settings。
   * 领域编辑器（items/blocks/entity…）与中部功能（preview/resources/nbt…）
   * 属于 domain / middle 分组，入口在中部面板，不进活动栏。
   * 注册表为空时（如单测未调用 registerAllPanels）自然渲染为空列表。
   */
  const shellPanels = getShellPanels();

  /**
   * 当前应当高亮的图标 id（**至多一个**），null 表示不高亮任何。
   *
   * 优先级：中栏正在显示的 core 面板 > 左栏展开态。
   * 之所以要有优先级，是因为本项目把 search/git/packages/settings 放在**中栏**，
   * 而 VS Code 是把它们放在侧栏里的（点图标 = 切换侧栏内容）。
   * 两边都保留就意味着「左栏开着 + 中栏显示 search」时两个图标同时高亮，
   * 活动栏就失去了「当前视图是哪个」的唯一指示作用。
   */
  const middleHasCore = shellPanels.some((p) => p.id === activePanel);
  const highlightedId = middleHasCore ? activePanel : leftCollapsed ? null : SIDEBAR_PANEL_ID;

  /**
   * 键盘漫游 / roving tabindex 的锚点。
   *
   * 与 `highlightedId` 分开是必需的：WAI-ARIA 的 roving tabindex 要求工具栏里
   * **恒有且仅有一个** tabIndex=0 的按钮。若直接拿 highlightedId 当锚点，
   * 「左栏折叠 + 中栏停在域面板(items)」时 highlightedId 为 null ——
   * 整个活动栏一个可 tab 的按钮都没有，键盘用户直接摸不到这一列；
   * 而且方向键漫游会因 `findIndex` 返回 -1 而直接 return。
   * 这个 bug 是这次改动自己引入的（原先锚点是中栏面板，恒有值），
   * 由 ActivityBar.test.tsx 的方向键用例当场抓住。
   */
  const rovingId = highlightedId ?? SIDEBAR_PANEL_ID;

  const isActive = (id: string) => id === highlightedId;

  /**
   * 键盘导航（WAI-ARIA Toolbar 模式）：
   * - ArrowUp/ArrowDown：上下切换，循环
   * - Home/End：跳到第一个/最后一个
   * - 切换后用 requestAnimationFrame 延迟 focus 到新按钮（确保 DOM 已更新）
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const idx = shellPanels.findIndex((p) => p.id === rovingId);
    if (idx === -1) return;

    let nextIdx: number | null = null;
    if (e.key === 'ArrowDown') {
      nextIdx = (idx + 1) % shellPanels.length;
    } else if (e.key === 'ArrowUp') {
      nextIdx = (idx - 1 + shellPanels.length) % shellPanels.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = shellPanels.length - 1;
    } else {
      return; // 其它键不处理
    }
    e.preventDefault();
    const next = shellPanels[nextIdx];
    onChange(next.id);
    // Roving Tabindex：focus 到新激活按钮
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLButtonElement>(`[data-activity="${next.id}"]`);
      btn?.focus();
    });
  };

  return (
    <div
      className="flex w-12 flex-col items-center gap-1 border-r border-mc-border bg-mc-bg py-2"
      role="toolbar"
      aria-label="活动栏"
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
    >
      {shellPanels.map(({ id, icon: Icon, title }, index, arr) => {
        const isLastInGroup = index === arr.length - 1 || arr[index + 1].kind !== arr[index].kind;
        // 将 i18n key 翻译为实际文案（供 aria-label/title/tooltip 使用）
        const label = t(title);
        const active = isActive(id);
        return (
          <Fragment key={id}>
            <button
              type="button"
              data-activity={id}
              onClick={() => onChange(id)}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              aria-label={label}
              aria-pressed={active}
              // roving tabindex：恒有且仅有一个 0，用 rovingId 而非 active
              tabIndex={id === rovingId ? 0 : -1}
              className={`mc-atb-btn ${active ? 'mc-atb-btn-active' : 'mc-atb-btn-idle'}`}
              title={label}
            >
              {Icon}
              {active && <span className="mc-active-bar" aria-hidden="true" />}
              {hovered === id && (
                <div
                  role="tooltip"
                  className="mc-pop absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap px-2 py-1 text-xs text-mc-text"
                >
                  {label}
                </div>
              )}
            </button>
            {/* 分组分隔线 */}
            {isLastInGroup && index !== arr.length - 1 && (
              <div key={`sep-${id}`} className="w-6 h-px bg-mc-border my-1" aria-hidden="true" />
            )}
          </Fragment>
        );
      })}

      <div className="flex-1" />

      {/* 品牌方块标：点击返回 Dashboard 首屏 */}
      <button
        type="button"
        onClick={() => onHome?.()}
        aria-label={t('activityBar.backToDashboard')}
        className="mc-atb-btn mc-atb-btn-idle mt-1"
        title={t('activityBar.backToDashboard')}
      >
        <McMark className="h-6 w-6 text-mc-accent" />
      </button>
    </div>
  );
}
