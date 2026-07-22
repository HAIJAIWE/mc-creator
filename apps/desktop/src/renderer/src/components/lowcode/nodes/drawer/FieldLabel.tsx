import { memo, useState, useCallback } from 'react';

interface FieldLabelProps {
  /** 字段显示名 */
  label: string;
  /** 是否必填（渲染 * 标记） */
  required?: boolean;
  /** MC 领域解释文本（hover ? 显示，无则不渲染 ? 图标） */
  tooltip?: string;
}

function FieldLabelComponent({ label, required, tooltip }: FieldLabelProps) {
  const [show, setShow] = useState(false);
  const onEnter = useCallback(() => setShow(true), []);
  const onLeave = useCallback(() => setShow(false), []);

  return (
    <div className="mb-1 flex items-center gap-1 text-[11px] text-mc-text">
      <span>{label}</span>
      {required && (
        <span className="text-red-400" aria-label="必填">
          *
        </span>
      )}
      {tooltip && (
        <span
          className="relative inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-mc-border text-[9px] text-mc-mute hover:text-mc-text"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          role="img"
          aria-label={`提示：${tooltip}`}
        >
          ?
          {show && (
            <span
              className="absolute left-4 top-0 z-10 w-48 rounded-mc border border-purple-500 bg-black/95 p-2 text-[10px] font-normal leading-relaxed text-white shadow-[2px_2px_0_rgba(0,0,0,0.6)]"
              role="tooltip"
            >
              {tooltip}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export const FieldLabel = memo(FieldLabelComponent);
