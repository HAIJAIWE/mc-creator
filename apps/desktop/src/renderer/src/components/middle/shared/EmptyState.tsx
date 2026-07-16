import { McIcon } from '../../../assets/mc-ui/McIcon';

interface EmptyStateProps {
  icon: string;
  title: string;
  hint: string;
}

/** 空状态：未生成 spec 或无数据 */
export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
      <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <McIcon scope="pixel" name={icon} size={32} className="text-mc-mute" />
      </div>
      <div className="text-sm font-medium text-mc-dim">{title}</div>
      <div className="text-xs text-mc-mute">{hint}</div>
    </div>
  );
}
