import { memo, useState, useEffect, useCallback, type ChangeEvent } from 'react';
import type { EditorProps } from './types.js';
import { listExternalMods, type ExternalMod } from '../../../custom/externalModList.js';

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
 *
 * 阶段 C：命名空间下拉加载外部 mod 列表（listExternalMods），
 * 支持 minecraft / forge / create 等命名空间切换。
 */
function ResourceIdEditorComponent({ value, onChange, error }: EditorProps<string>) {
  const [mods, setMods] = useState<ExternalMod[]>([
    { namespace: 'minecraft', name: 'Minecraft', version: '', installed: true },
  ]);
  const { modid, path } = parseResourceId(value);
  const [modidValue, setModidValue] = useState(modid);
  const [pathValue, setPathValue] = useState(path);

  // 加载外部 mod 列表
  useEffect(() => {
    let mounted = true;
    listExternalMods().then((m) => {
      if (mounted) setMods(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const parsed = parseResourceId(value);
    setModidValue(parsed.modid);
    setPathValue(parsed.path);
  }, [value]);

  const handleModidChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const newModid = e.target.value;
      setModidValue(newModid);
      onChange(`${newModid}:${pathValue}`);
    },
    [pathValue, onChange],
  );

  const handlePathChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newPath = e.target.value;
      setPathValue(newPath);
      onChange(`${modidValue}:${newPath}`);
    },
    [modidValue, onChange],
  );

  // 合并外部 mod 列表与当前 modid（若当前值不在列表中，动态追加）
  const visibleMods: ExternalMod[] =
    mods.some((m) => m.namespace === modidValue) || !modidValue
      ? mods
      : [...mods, { namespace: modidValue, name: modidValue, version: '', installed: true }];

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <select
          data-testid="namespace-select"
          value={modidValue}
          onChange={handleModidChange}
          aria-label="命名空间"
          className="w-24 border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-1 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        >
          {visibleMods.map((m) => (
            <option key={m.namespace} value={m.namespace}>
              {m.namespace}
              {m.installed ? '' : ' (未安装)'}
            </option>
          ))}
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
