import { McIcon } from '../../../assets/mc-ui/McIcon';

interface PanelHeaderProps {
  icon: string;
  title: string;
  meta?: { label: string; value: string }[];
  subtitle?: string;
}

/** 面板头部：图标 + 标题 + 元信息 */
export function PanelHeader({ icon, title, meta = [], subtitle }: PanelHeaderProps) {
  return (
    <div className="border-b border-mc-border px-4 py-3">
      <div className="flex items-center gap-2">
        <McIcon scope="pixel" name={icon} size={16} className="text-mc-accent" />
        <span className="text-sm font-bold text-mc-text">{title}</span>
        {meta.map((m, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="text-xs text-mc-mute">·</span>
            <span className="text-xs text-mc-dim">{m.label}: {m.value}</span>
          </span>
        ))}
      </div>
      {subtitle && <div className="mt-1 text-xs text-mc-mute">{subtitle}</div>}
    </div>
  );
}
