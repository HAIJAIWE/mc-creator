import { memo, useState, useEffect } from 'react';
import type { EditorProps } from './types.js';

/** 解析 modid:path 格式 */
function parseResourceId(value: string): { modid: string; path: string } {
  const idx = value.indexOf(':');
  if (idx >= 0) {
    return { modid: value.slice(0, idx), path: value.slice(idx + 1) };
  }
  return { modid: 'minecraft', path: value };
}

/**
 * 资源 ID 编辑器：命名空间下拉 + path 输入 + 实时格式校验。
 * 格式：^[a-z0-9_]+:[a-z0-9_/]+$
 */
function ResourceIdEditorComponent({ value, onChange, error }: EditorProps<string>) {
  const { modid, path } = parseResourceId(value);
  const [modidValue, setModidValue] = useState(modid);
  const [pathValue, setPathValue] = useState(path);

  useEffect(() => {
    const parsed = parseResourceId(value);
    setModidValue(parsed.modid);
    setPathValue(parsed.path);
  }, [value]);

  const handleModidChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModid = e.target.value;
    setModidValue(newModid);
    onChange(`${newModid}:${pathValue}`);
  };

  const handlePathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPath = e.target.value;
    setPathValue(newPath);
    onChange(`${modidValue}:${newPath}`);
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <select
          value={modidValue}
          onChange={handleModidChange}
          aria-label="命名空间"
          className="w-24 border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-1 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        >
          <option value="minecraft">minecraft</option>
          <option value="mymod">mymod</option>
        </select>
        <span className="self-center text-mc-dim">:</span>
        <input
          type="text"
          value={pathValue}
          onChange={handlePathChange}
          aria-label="资源路径"
          className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        />
      </div>
      {error && (
        <div role="alert" className="text-[10px] text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

export const ResourceIdEditor = memo(ResourceIdEditorComponent);
