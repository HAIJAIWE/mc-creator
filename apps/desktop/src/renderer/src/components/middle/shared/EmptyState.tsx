import { McIcon } from '../../../assets/mc-ui/McIcon';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: string;
  title: string;
  hint: string;
  /** 可选行动按钮（如「打开命令面板」「添加物品」），渲染在 hint 下方 */
  action?: EmptyStateAction;
}

/** 空状态：未生成 spec 或无数据 */
export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
      <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <McIcon scope="pixel" name={icon} size={32} className="text-mc-mute" />
      </div>
      <div className="text-sm font-medium text-mc-dim">{title}</div>
      <div className="text-xs text-mc-mute">{hint}</div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 rounded-mc-md border border-mc-border bg-mc-surface-2 px-4 py-2 text-xs text-mc-dim transition-colors hover:border-mc-accent hover:text-mc-accent"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
