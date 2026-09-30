import { useState, type ReactNode } from 'react';
import { McMark } from './McMark.js';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useTranslation } from '../hooks/useTranslation.js';

type Activity =
  | 'explorer'
  | 'search'
  | 'git'
  | 'packages'
  | 'items'
  | 'blocks'
  | 'entity'
  | 'audio'
  | 'cicd'
  | 'game'
  | 'settings';

interface ActivityBarProps {
  active: Activity;
  onChange: (activity: Activity) => void;
  /** 点击品牌标返回 Dashboard 首屏 */
  onHome?: () => void;
}

export function ActivityBar({ active, onChange, onHome }: ActivityBarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { t } = useTranslation();

  // 全部使用 MC 彩色像素图标（与 Dashboard 首页 gen-* 同款 16x16 调色板），非单色线条
  const activities: { id: Activity; icon: ReactNode; label: string }[] = [
    {
      id: 'explorer',
      icon: <McIcon scope="pixel" name="atb-folder" size={20} />,
      label: t('activityBar.explorer'),
    },
    {
      id: 'search',
      icon: <McIcon scope="pixel" name="atb-search" size={20} />,
      label: t('activityBar.search'),
    },
    {
      id: 'git',
      icon: <McIcon scope="pixel" name="atb-git" size={20} />,
      label: t('activityBar.git'),
    },
    {
      id: 'packages',
      icon: <McIcon scope="pixel" name="atb-chest" size={20} />,
      label: t('activityBar.packages'),
    },
    {
      id: 'items',
      icon: <McIcon scope="pixel" name="atb-ingot" size={20} />,
      label: t('activityBar.items'),
    },
    {
      id: 'blocks',
      icon: <McIcon scope="pixel" name="atb-grass" size={20} />,
      label: t('activityBar.blocks'),
    },
    {
      id: 'entity',
      icon: <McIcon scope="pixel" name="atb-creeper" size={20} />,
      label: t('activityBar.entity'),
    },
    {
      id: 'audio',
      icon: <McIcon scope="pixel" name="atb-note" size={20} />,
      label: t('activityBar.audio'),
    },
    {
      id: 'cicd',
      icon: <McIcon scope="pixel" name="atb-cmd" size={20} />,
      label: t('activityBar.cicd'),
    },
    {
      id: 'game',
      icon: <McIcon scope="pixel" name="atb-gamepad" size={20} />,
      label: t('activityBar.game'),
    },
  ];

  /**
   * 键盘导航（WAI-ARIA Toolbar 模式）：
   * - ArrowUp/ArrowDown：上下切换，循环
   * - Home/End：跳到第一个/最后一个
   * - 切换后用 requestAnimationFrame 延迟 focus 到新按钮（确保 DOM 已更新）
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const idx = activities.findIndex((a) => a.id === active);
    let nextIdx: number | null = null;
    if (e.key === 'ArrowDown') {
      nextIdx = (idx + 1) % activities.length;
    } else if (e.key === 'ArrowUp') {
      nextIdx = (idx - 1 + activities.length) % activities.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = activities.length - 1;
    } else {
      return; // 其它键不处理
    }
    e.preventDefault();
    const next = activities[nextIdx];
    onChange(next.id);
    // Roving Tabindex：focus 到新激活按钮（即便 onChange 是 no-op，也尝试 focus）
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
      <div className="flex flex-col gap-1">
        {activities.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
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
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-1">
        <button
          type="button"
          data-activity="settings"
          onClick={() => onChange('settings')}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          aria-label={t('activityBar.settings')}
          aria-pressed={active === 'settings'}
          tabIndex={active === 'settings' ? 0 : -1}
          className={`mc-atb-btn ${
            active === 'settings' ? 'mc-atb-btn-active' : 'mc-atb-btn-idle'
          }`}
          title={t('activityBar.settings')}
        >
          <McIcon scope="pixel" name="atb-cog" size={20} />
          {active === 'settings' && <span className="mc-active-bar" aria-hidden="true" />}
          {hovered === 'settings' && (
            <div
              role="tooltip"
              className="mc-pop absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap px-2 py-1 text-xs text-mc-text"
            >
              {t('activityBar.settings')}
            </div>
          )}
        </button>
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
    </div>
  );
}
