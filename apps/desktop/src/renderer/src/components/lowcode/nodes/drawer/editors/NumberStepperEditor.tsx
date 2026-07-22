import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 数字步进编辑器：凹陷输入框 + 左右 [-][+] MC 按钮。
 * 支持 min/max/step 校验。
 */
function NumberStepperEditorComponent({ value, onChange, schema }: EditorProps<number>) {
  const min = schema.min ?? -Infinity;
  const max = schema.max ?? Infinity;
  const step = schema.step ?? 1;

  const handleDecrement = () => {
    const next = Math.max(min, Number(value) - step);
    onChange(next);
  };

  const handleIncrement = () => {
    const next = Math.min(max, Number(value) + step);
    onChange(next);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    onChange(Math.max(min, Math.min(max, num)));
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="减少"
        onClick={handleDecrement}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 text-[11px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        -
      </button>
      <input
        type="number"
        value={value}
        onChange={handleInput}
        min={schema.min}
        max={schema.max}
        step={step}
        className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
      />
      <button
        type="button"
        aria-label="增加"
        onClick={handleIncrement}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 text-[11px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        +
      </button>
    </div>
  );
}

export const NumberStepperEditor = memo(NumberStepperEditorComponent);
