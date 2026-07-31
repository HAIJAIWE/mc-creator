import { memo, useMemo, useState, useEffect, useRef } from 'react';
import type { EditorProps } from './types.js';

type NbtValue = string | number | boolean | null | NbtValue[] | { [key: string]: NbtValue };

/** 空 NBT 对象（类型注解避免 `as` 断言） */
const EMPTY_PARSED: Record<string, NbtValue> = {};

/**
 * 类型守卫：判断 JSON.parse 结果是否为 NBT 编辑器期望的「对象记录」结构。
 *
 * 拒绝数组、原始值（string/number/boolean/null）——这些虽然合法 JSON，
 * 但 NBT 编辑器只处理 compound 类型（键值对对象）。原本直接 `as Record`
 * 会让数组被错误地当成记录渲染（Object.entries(['a']) 产出 [['0','a']]）。
 */
function isNbtRecord(v: unknown): v is Record<string, NbtValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * NBT 树编辑器（基础版）：支持 string/int/compound 三种类型。
 * - 输入为 JSON 字符串
 * - 解析为键值对列表显示
 * - 添加键（默认 string 类型）
 * - 修改值触发 onChange（重新序列化为 JSON）
 *
 * P2 dogfood 修复：每个键的输入框用本地 state 管理显示值，
 * 避免受控 value + onChange 导致光标在每次输入后跳到末尾。
 * 仅在初始挂载或外部 value 变化时从 renderValue 初始化本地显示值。
 */
function NbtEditorComponent({ value, onChange, error }: EditorProps<string>) {
  // 同步派生 parseError，避免渲染期间 setState
  const { parsed, parseError } = useMemo(() => {
    if (value.trim() === '') return { parsed: EMPTY_PARSED, parseError: null };
    try {
      const raw: unknown = JSON.parse(value);
      // 类型守卫替代 `as Record`：非对象结构（数组/原始值）视为格式错误
      if (isNbtRecord(raw)) return { parsed: raw, parseError: null };
      return { parsed: EMPTY_PARSED, parseError: 'JSON 必须为对象' };
    } catch {
      return { parsed: EMPTY_PARSED, parseError: 'JSON 格式错误' };
    }
  }, [value]);

  // P2 修复：本地编辑状态，key → 显示文本的映射。
  // 用户输入时只更新本地显示文本 + 触发 onChange，不重新格式化显示值。
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  // 追踪上次 parsed 的 key 集合，当 key 变化时重置对应的本地值
  const prevKeysRef = useRef<Set<string>>(new Set());

  const entries = Object.entries(parsed);

  // 当 parsed 的 key 集合变化时（新增/删除键），同步本地显示值
  useEffect(() => {
    const currentKeys = new Set(entries.map(([k]) => k));
    const newLocalValues: Record<string, string> = {};
    for (const [k, v] of entries) {
      // 保留已有本地值（用户正在编辑），新键用格式化值初始化
      newLocalValues[k] = localValues[k] ?? renderValue(v);
    }
    prevKeysRef.current = currentKeys;
    setLocalValues(newLocalValues);
    // 仅在 entries key 集合变化时执行，不依赖 localValues 避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const handleAddKey = () => {
    const newKey = `key_${entries.length + 1}`;
    const next = { ...parsed, [newKey]: 'new_value' };
    onChange(JSON.stringify(next, null, 2));
  };

  const handleValueChange = (key: string, displayText: string) => {
    // 更新本地显示文本（不格式化，保留用户原始输入）
    setLocalValues((prev) => ({ ...prev, [key]: displayText }));
    // 解析用户输入为 NBT 值
    let next: NbtValue = displayText;
    if (displayText === 'true') next = true;
    else if (displayText === 'false') next = false;
    else if (displayText === 'null') next = null;
    else if (/^-?\d+(\.\d+)?$/.test(displayText)) next = Number(displayText);
    else if (displayText.startsWith('"') && displayText.endsWith('"'))
      next = displayText.slice(1, -1);
    const updated = { ...parsed, [key]: next };
    onChange(JSON.stringify(updated, null, 2));
  };

  const handleDeleteKey = (key: string) => {
    const next = { ...parsed };
    delete next[key];
    setLocalValues((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
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
            value={localValues[k] ?? renderValue(v)}
            onChange={(e) => handleValueChange(k, e.target.value)}
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
