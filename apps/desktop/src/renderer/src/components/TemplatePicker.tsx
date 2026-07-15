import { useEffect } from 'react';
import { TEMPLATES_BY_TYPE, type SpecTemplate, type GeneratorType } from '@mc-creator/shared';
import { X } from 'lucide-react';

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
 * - 深色主题：bg-zinc-900 + border-zinc-700 + text-zinc-100，字体最小 text-xs(12px)
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
        className="w-[520px] max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">
            选择模板
            <span className="ml-2 text-xs font-normal text-zinc-400">
              （{generatorType}）
            </span>
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500">
            暂无可用模板
          </div>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onPick(t)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800/60 p-3 text-left transition hover:border-blue-500 hover:bg-zinc-800"
                >
                  <div className="flex items-center gap-2">
                    {t.icon && (
                      <span className="text-base">{t.icon}</span>
                    )}
                    <span className="text-sm font-medium text-zinc-100">
                      {t.title}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs text-zinc-400">
                    {t.description}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 text-right text-xs text-zinc-500">
          点击模板将填充到描述框
        </div>
      </div>
    </div>
  );
}
