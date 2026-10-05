import { useState, Fragment } from 'react';
import { McMark } from './McMark.js';
import { useTranslation } from '../hooks/useTranslation.js';
import { getShellPanels } from '../shell/panels.js';

interface ActivityBarProps {
  /** 当前激活的面板 ID */
  active: string;
  /** 切换面板回调 */
  onChange: (panelId: string) => void;
  /** 点击品牌标返回 Dashboard 首屏 */
  onHome?: () => void;
}

export function ActivityBar({ active, onChange, onHome }: ActivityBarProps) {
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
   * 键盘导航（WAI-ARIA Toolbar 模式）：
   * - ArrowUp/ArrowDown：上下切换，循环
   * - Home/End：跳到第一个/最后一个
   * - 切换后用 requestAnimationFrame 延迟 focus 到新按钮（确保 DOM 已更新）
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const idx = shellPanels.findIndex((p) => p.id === active);
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
        return (
          <Fragment key={id}>
            <button
              type="button"
              data-activity={id}
              onClick={() => onChange(id)}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              aria-label={label}
              aria-pressed={active === id}
              tabIndex={active === id ? 0 : -1}
              className={`mc-atb-btn ${active === id ? 'mc-atb-btn-active' : 'mc-atb-btn-idle'}`}
              title={label}
            >
              {Icon}
              {active === id && <span className="mc-active-bar" aria-hidden="true" />}
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
