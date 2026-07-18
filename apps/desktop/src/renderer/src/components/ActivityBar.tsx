import { useState, type ReactNode } from 'react';
import { GitBranch } from 'lucide-react';
import { McMark } from './McMark.js';
import { McIcon } from '../assets/mc-ui/McIcon';

type Activity = 'explorer' | 'search' | 'git' | 'packages' | 'settings' | 'items' | 'blocks';

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
  ];

  return (
    <div className="flex w-12 flex-col items-center gap-1 bg-mc-bg py-2">
      <div className="flex flex-col gap-1">
        {activities.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            className={`relative flex h-10 w-10 items-center justify-center rounded-mc transition-colors ${
              active === id
                ? 'bg-mc-surface-2 text-mc-text'
                : 'text-mc-mute hover:bg-mc-surface hover:text-mc-dim'
            }`}
            title={label}
          >
            {Icon}
            {active === id && <span className="mc-active-bar" />}
            {hovered === id && (
              <div className="mc-pop absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap px-2 py-1 text-xs text-mc-text">
                {label}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-1">
        <button
          onClick={() => onChange('settings')}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          className={`relative flex h-10 w-10 items-center justify-center rounded-mc transition-colors ${
            active === 'settings'
              ? 'bg-mc-surface-2 text-mc-text'
              : 'text-mc-mute hover:bg-mc-surface hover:text-mc-dim'
          }`}
          title="设置"
        >
          <McIcon scope="pixel" name="settings-cog" size={20} />
          {active === 'settings' && <span className="mc-active-bar" />}
          {hovered === 'settings' && (
            <div className="mc-pop absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap px-2 py-1 text-xs text-mc-text">
              设置
            </div>
          )}
        </button>
        {/* 品牌方块标：点击返回 Dashboard 首屏 */}
        <button
          onClick={() => onHome?.()}
          className="mt-1 flex h-10 w-10 items-center justify-center rounded-mc transition-colors hover:bg-mc-surface"
          title="返回项目仪表盘"
        >
          <McMark className="h-6 w-6 text-mc-accent" />
        </button>
      </div>
    </div>
  );
}
