import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 分段切换编辑器：MC 标签页风格分段控件。
 * 切换后表单字段根据 condition 自动显隐。
 *
 * 可访问性：每个按钮带 aria-label=`${label}: ${opt}`，避免屏幕阅读器
 * 在多个 segmented 编辑器同屏时只读到 "true"/"false" 而不知所属字段。
 */
function SegmentedEditorComponent({ value, onChange, schema }: EditorProps<string>) {
  const options = schema.options ?? [];

  return (
    <div className="flex border-2 border-t-white border-l-white border-b-black border-r-black">
      {options.map((opt, i) => (
        <button
          key={opt}
          type="button"
          aria-label={`${schema.label}: ${opt}`}
          onClick={() => onChange(opt)}
          className={`flex-1 px-2 py-0.5 text-[11px] ${
            i > 0 ? 'border-l-2 border-l-black border-t-white' : ''
          } ${
            value === opt
              ? 'bg-mc-accent text-white'
              : 'bg-mc-btn text-mc-text hover:bg-mc-btn-hover'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export const SegmentedEditor = memo(SegmentedEditorComponent);
