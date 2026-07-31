import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 列表编辑器（P40）：编辑 `{name, type}[]` 形式的参数/键值对数组。
 *
 * 每行按 listItemSchema 渲染子字段（text 输入框 / dropdown 下拉），行尾删除按钮，
 * 底部"添加"按钮追加一行默认值。
 * 值为对象数组：value 为 Array<Record<string, string>>，缺失键补默认值。
 */
function ListEditorComponent({ value, onChange, schema }: EditorProps<unknown>) {
  const items = Array.isArray(value) ? (value as Array<Record<string, string>>) : [];
  const sub = schema.listItemSchema ?? [];

  const updateItem = (index: number, key: string, v: string) => {
    const next = items.map((item, i) => (i === index ? { ...item, [key]: v } : item));
    onChange(next);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    const defaults: Record<string, string> = {};
    for (const f of sub) {
      defaults[f.key] = f.type === 'dropdown' ? (f.options?.[0] ?? '') : '';
    }
    onChange([...items, defaults]);
  };

  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          {sub.map((f) => (
            <div key={f.key} className="flex-1">
              {f.type === 'dropdown' ? (
                <select
                  value={item[f.key] ?? f.options?.[0] ?? ''}
                  onChange={(e) => updateItem(index, f.key, e.target.value)}
                  className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-1 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
                >
                  {f.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={item[f.key] ?? ''}
                  placeholder={f.label}
                  onChange={(e) => updateItem(index, f.key, e.target.value)}
                  className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
                />
              )}
            </div>
          ))}
          <button
            type="button"
            aria-label="删除"
            onClick={() => removeItem(index)}
            className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1.5 text-[11px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="w-full border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 py-0.5 text-[11px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        + 添加{items.length === 0 ? '参数' : ''}
      </button>
    </div>
  );
}

export const ListEditor = memo(ListEditorComponent);
