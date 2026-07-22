import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 枚举下拉编辑器：MC 风格 select。
 */
function DropdownEditorComponent({ value, onChange, schema }: EditorProps<string>) {
  const options = schema.options ?? [];

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

export const DropdownEditor = memo(DropdownEditorComponent);
