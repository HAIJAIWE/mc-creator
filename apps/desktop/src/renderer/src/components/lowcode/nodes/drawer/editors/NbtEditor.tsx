import { memo, useMemo } from 'react';
import type { EditorProps } from './types.js';

type NbtValue = string | number | boolean | null | NbtValue[] | { [key: string]: NbtValue };

/**
 * NBT 树编辑器（基础版）：支持 string/int/compound 三种类型。
 * - 输入为 JSON 字符串
 * - 解析为键值对列表显示
 * - 添加键（默认 string 类型）
 * - 修改值触发 onChange（重新序列化为 JSON）
 */
function NbtEditorComponent({ value, onChange, error }: EditorProps<string>) {
  // 同步派生 parseError，避免渲染期间 setState
  const { parsed, parseError } = useMemo(() => {
    if (value.trim() === '') return { parsed: {} as Record<string, NbtValue>, parseError: null };
    try {
      return { parsed: JSON.parse(value) as Record<string, NbtValue>, parseError: null };
    } catch {
      return { parsed: {} as Record<string, NbtValue>, parseError: 'JSON 格式错误' };
    }
  }, [value]);

  const entries = Object.entries(parsed);

  const handleAddKey = () => {
    const newKey = `key_${entries.length + 1}`;
    const next = { ...parsed, [newKey]: 'new_value' };
    onChange(JSON.stringify(next, null, 2));
  };

  const handleValueChange = (key: string, newValue: NbtValue) => {
    const next = { ...parsed, [key]: newValue };
    onChange(JSON.stringify(next, null, 2));
  };

  const handleDeleteKey = (key: string) => {
    const next = { ...parsed };
    delete next[key];
    onChange(JSON.stringify(next, null, 2));
  };

  const renderValue = (v: NbtValue): string => {
    if (v === null) return 'null';
    if (typeof v === 'string') return `"${v}"`;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };

  const displayError = error ?? parseError;

  return (
    <div className="space-y-1">
      {entries.length === 0 && !parseError && (
        <div className="text-[11px] text-mc-mute">（空）</div>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <span className="w-20 truncate text-[11px] text-mc-accent">{k}</span>
          <span className="text-mc-dim">:</span>
          <input
            type="text"
            defaultValue={renderValue(v)}
            onChange={(e) => {
              const raw = e.target.value;
              let next: NbtValue = raw;
              // 尝试解析为数字/布尔/null
              if (raw === 'true') next = true;
              else if (raw === 'false') next = false;
              else if (raw === 'null') next = null;
              else if (/^-?\d+(\.\d+)?$/.test(raw)) next = Number(raw);
              else if (raw.startsWith('"') && raw.endsWith('"')) next = raw.slice(1, -1);
              handleValueChange(k, next);
            }}
            className="flex-1 border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-1 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
          />
          <button
            type="button"
            aria-label={`删除 ${k}`}
            onClick={() => handleDeleteKey(k)}
            className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 text-[11px] hover:bg-mc-btn-hover"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="添加键"
        onClick={handleAddKey}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 py-0.5 text-[11px] hover:bg-mc-btn-hover"
      >
        + 添加键
      </button>
      {displayError && (
        <div role="alert" className="text-[10px] text-red-400">
          {displayError}
        </div>
      )}
    </div>
  );
}

export const NbtEditor = memo(NbtEditorComponent);
