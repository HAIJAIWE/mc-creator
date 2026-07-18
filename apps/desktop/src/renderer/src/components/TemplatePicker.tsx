import { useEffect } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { TEMPLATES_BY_TYPE, type SpecTemplate, type GeneratorType } from '@mc-creator/shared';

interface Props {
  generatorType: GeneratorType;
  onPick: (template: SpecTemplate) => void;
  onClose: () => void;
}

/**
 * 模板选择器模态框。
 *
 * - 从 @mc-creator/shared 导入 TEMPLATES_BY_TYPE
 * - 按 generatorType 显示对应模板列表
 * - 点击模板 → 调 onPick → 关闭
 * - 深色主题：bg-mc-surface + border-mc-border-strong + text-mc-text，字体最小 text-xs(12px)
 * - 模态框居中，背景 bg-black/60 遮罩
 */
export function TemplatePicker({ generatorType, onPick, onClose }: Props) {
  const templates = TEMPLATES_BY_TYPE[generatorType] ?? [];

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-mc-lg border border-mc-border-strong bg-mc-surface shadow-mc-pop p-4 text-mc-text animate-mc-dialog-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">
            选择模板
            <span className="ml-2 text-xs font-normal text-mc-text-dim">（{generatorType}）</span>
          </h2>
          <button
            onClick={onClose}
            className="text-mc-text-dim hover:text-mc-text"
            aria-label="关闭"
          >
            <McIcon scope="pixel" name="close" size={16} />
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="py-8 text-center text-xs text-mc-text-dim">暂无可用模板</div>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onPick(t)}
                  className="mc-card w-full p-3 text-left hover:border-mc-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {t.icon && <span className="text-base">{t.icon}</span>}
                    <span className="text-sm font-medium text-mc-text">{t.title}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs text-mc-text-dim">{t.description}</p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 text-right text-xs text-mc-text-dim">点击模板将填充到描述框</div>
      </div>
    </div>
  );
}
