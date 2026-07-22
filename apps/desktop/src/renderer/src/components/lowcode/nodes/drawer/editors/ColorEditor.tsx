import { memo } from 'react';
import type { EditorProps } from './types.js';

/** MC 16 色染色色板 */
const MC_DYE_COLORS: { name: string; value: string }[] = [
  { name: '白色', value: '#FFFFFF' },
  { name: '橙色', value: '#D87F33' },
  { name: '品红色', value: '#B24CD8' },
  { name: '淡蓝色', value: '#6699D8' },
  { name: '黄色', value: '#E5E533' },
  { name: '黄绿色', value: '#7FCC19' },
  { name: '粉色', value: '#F27FA5' },
  { name: '灰色', value: '#4C4C4C' },
  { name: '浅灰色', value: '#999999' },
  { name: '青色', value: '#4C7F99' },
  { name: '紫色', value: '#7F3FB2' },
  { name: '蓝色', value: '#334CB2' },
  { name: '棕色', value: '#664C33' },
  { name: '绿色', value: '#667F33' },
  { name: '红色', value: '#993333' },
  { name: '黑色', value: '#191919' },
];

/**
 * MC 颜色选择编辑器：16 色染色色板 + 自定义 hex 输入。
 */
function ColorEditorComponent({ value, onChange }: EditorProps<string>) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-8 gap-1">
        {MC_DYE_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(c.value)}
            className="h-5 w-5 border border-t-white border-l-white border-b-black border-r-black"
            style={{ backgroundColor: c.value }}
          />
        ))}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
      />
    </div>
  );
}

export const ColorEditor = memo(ColorEditorComponent);
