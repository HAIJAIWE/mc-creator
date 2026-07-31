import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 数字步进编辑器：凹陷输入框 + 左右 [-][+] MC 按钮。
 * 支持 min/max/step 校验。
 *
 * P1 dogfood 修复：输入过程中不立即 clamp，允许用户输入中间值（如先输 1 再输 2 → 12）。
 * 仅在失焦（onBlur）时 clamp 到 [min, max] 范围。
 * 空输入或非数字输入保持原值不变。
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

  /** 输入中：直接传递原始数值，不 clamp（允许输入中间值） */
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // 空字符串或纯负号不触发 onChange（用户还在输入）
    if (raw === '' || raw === '-') return;
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    onChange(num);
  };

  /** 失焦时：clamp 到合法范围 */
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // 空字符串或纯负号不触发 onChange（与 handleInput 一致，避免 Number('')===0 把空输入回退为 0）
    if (raw === '' || raw === '-') return;
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      const clamped = Math.max(min, Math.min(max, num));
      // 仅当值变化时才触发 onChange，避免不必要的重渲染
      if (clamped !== num) onChange(clamped);
    }
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
        onBlur={handleBlur}
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
