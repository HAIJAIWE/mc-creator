import { Card } from '@mc-creator/ui';
import { McIcon } from '../assets/mc-ui/McIcon';

interface Props {
  warnings: string[];
  onClose?: () => void;
}

/**
 * 生成提示（警告）条。
 *
 * 容器改用 ui `Card`：圆角/边框/顶面受光交给设计系统的 `.mc-card`，黄色
 * 警告调由 className 覆盖。标题行与列表都在 Card 的内容槽里自绘 ——
 * Card 的 `title` 槽渲染的是 heading + 边框分隔，跟「一条紧凑提示」的
 * 视觉不符，且关闭按钮需要落在标题行右端。
 */
export function WarningBanner({ warnings, onClose }: Props) {
  return (
    <Card
      padding="none"
      className="animate-mc-panel-in border-yellow-500/60 bg-yellow-500/15 text-yellow-300"
    >
      <div className="px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="warning-box" size={16} className="flex-shrink-0" />
          <span className="flex-1 font-medium">生成提示（{warnings.length}）</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              // title 是既有的悬浮提示契约（AgentPanel 面板有依赖），aria-label 补可访问名
              title="关闭警告"
              aria-label="关闭警告"
              className="text-yellow-300 hover:text-mc-text"
            >
              <McIcon scope="pixel" name="close" size={16} />
            </button>
          )}
        </div>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-xs leading-relaxed">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
