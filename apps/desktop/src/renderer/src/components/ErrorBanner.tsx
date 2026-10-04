import { Card } from '@mc-creator/ui';
import { McIcon } from '../assets/mc-ui/McIcon';

interface Props {
  message: string;
  onClose?: () => void;
}

/**
 * 内联错误提示条。
 *
 * 容器改用 ui `Card`（`.mc-card` 的圆角/边框/顶面受光统一由设计系统提供），
 * 红色语调仍由 className 覆盖（Tailwind utilities 层优先级高于 components 层）。
 * `padding="none"` 是为了自己控制单行的紧凑内边距 —— Card 默认的 p-4 太厚。
 */
export function ErrorBanner({ message, onClose }: Props) {
  return (
    <Card
      padding="none"
      className="animate-mc-panel-in border-mc-redstone bg-mc-redstone/15 text-mc-redstone"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <McIcon scope="pixel" name="square-alert" size={16} className="flex-shrink-0" />
        <span className="flex-1 whitespace-pre-wrap">{message}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭错误提示"
            className="flex-shrink-0 text-mc-redstone hover:text-mc-text"
          >
            <McIcon scope="pixel" name="close" size={16} />
          </button>
        )}
      </div>
    </Card>
  );
}
