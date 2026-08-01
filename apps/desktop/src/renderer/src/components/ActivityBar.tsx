import { useState, type ReactNode } from 'react';
import { GitBranch, Gamepad2 } from 'lucide-react';
import { McMark } from './McMark.js';
import { McIcon } from '../assets/mc-ui/McIcon';

type Activity =
  | 'explorer'
  | 'search'
  | 'git'
  | 'packages'
  | 'items'
  | 'blocks'
  | 'mc'
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

  const activities: { id: Activity; icon: ReactNode; label: string }[] = [
    { id: 'explorer', icon: <McIcon scope="pixel" name="folder" size={20} />, label: '资源管理器' },
    { id: 'search', icon: <McIcon scope="pixel" name="search" size={20} />, label: '搜索' },
    { id: 'git', icon: <GitBranch className="h-5 w-5" />, label: '源代码管理' },
    { id: 'packages', icon: <McIcon scope="pixel" name="package" size={20} />, label: '包管理' },
    { id: 'items', icon: <McIcon scope="pixel" name="box" size={20} />, label: '物品/配方' },
    { id: 'blocks', icon: <McIcon scope="game" name="block-house" size={20} />, label: '方块编辑' },
    { id: 'mc', icon: <McIcon scope="pixel" name="star" size={20} />, label: 'MC 启动器' },
    { id: 'entity', icon: <McIcon scope="pixel" name="box" size={20} />, label: '实体 AI' },
    { id: 'audio', icon: <McIcon scope="pixel" name="image" size={20} />, label: '音效管理' },
    { id: 'cicd', icon: <McIcon scope="pixel" name="terminal" size={20} />, label: 'CI/CD' },
    { id: 'game', icon: <Gamepad2 className="h-5 w-5" />, label: '游戏启动器' },
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
      className="flex w-12 flex-col items-center gap-1 bg-mc-bg py-2"
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
            className={`relative flex h-10 w-10 items-center justify-center rounded-mc transition-colors ${
              active === id
                ? 'bg-mc-surface-2 text-mc-text'
                : 'text-mc-mute hover:bg-mc-surface hover:text-mc-dim'
            }`}
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
          aria-label="设置"
          aria-pressed={active === 'settings'}
          tabIndex={active === 'settings' ? 0 : -1}
          className={`relative flex h-10 w-10 items-center justify-center rounded-mc transition-colors ${
            active === 'settings'
              ? 'bg-mc-surface-2 text-mc-text'
              : 'text-mc-mute hover:bg-mc-surface hover:text-mc-dim'
          }`}
          title="设置"
        >
          <McIcon scope="pixel" name="settings-cog" size={20} />
          {active === 'settings' && <span className="mc-active-bar" aria-hidden="true" />}
          {hovered === 'settings' && (
            <div
              role="tooltip"
              className="mc-pop absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap px-2 py-1 text-xs text-mc-text"
            >
              设置
            </div>
          )}
        </button>
        {/* 品牌方块标：点击返回 Dashboard 首屏 */}
        <button
          type="button"
          onClick={() => onHome?.()}
          aria-label="返回项目仪表盘"
          className="mt-1 flex h-10 w-10 items-center justify-center rounded-mc transition-colors hover:bg-mc-surface"
          title="返回项目仪表盘"
        >
          <McMark className="h-6 w-6 text-mc-accent" />
        </button>
      </div>
    </div>
  );
}
