import { McIcon } from '../assets/mc-ui/McIcon';

interface Props {
  warnings: string[];
  onClose?: () => void;
}

export function WarningBanner({ warnings, onClose }: Props) {
  return (
    <div className="animate-mc-panel-in rounded-mc-lg border border-yellow-500/60 bg-yellow-500/15 px-3 py-2 text-sm text-yellow-300">
      <div className="flex items-center gap-2">
        <McIcon scope="pixel" name="warning-box" size={16} className="flex-shrink-0" />
        <span className="flex-1 font-medium">生成提示（{warnings.length}）</span>
        {onClose && (
          <button onClick={onClose} title="关闭警告" className="text-yellow-300 hover:text-mc-text">
            <McIcon scope="pixel" name="close" size={16} />
          </button>
        )}
      </div>
      <ul className="mt-1.5 space-y-0.5 pl-6 text-xs leading-relaxed">
        {warnings.map((w, i) => (
          <li key={i} className="list-disc">
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}
