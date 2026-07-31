import { memo, useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
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
 *
 * P1 dogfood 修复：使用 ref 跟踪本地编辑状态，避免外部 value prop
 * 在用户输入时立即回写导致竞态闪烁。只有当 value 真正来自外部（非本组件
 * 刚触发的 onChange）时才同步本地 state。
 */
function ResourceIdEditorComponent({ value, onChange, error }: EditorProps<string>) {
  const [mods, setMods] = useState<ExternalMod[]>([
    { namespace: 'minecraft', name: 'Minecraft', version: '', installed: true },
  ]);
  const { modid, path } = parseResourceId(value);
  const [modidValue, setModidValue] = useState(modid);
  const [pathValue, setPathValue] = useState(path);

  // P1 修复：ref 记录本组件最后一次 onChange 发出的完整值，
  // 仅当外部 value 与上次发出的不同时才同步本地 state
  const lastEmittedRef = useRef<string>(value);

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
    // 仅当外部 value 非本组件刚发出时才同步本地 state
    if (value !== lastEmittedRef.current) {
      const parsed = parseResourceId(value);
      setModidValue(parsed.modid);
      setPathValue(parsed.path);
    }
    lastEmittedRef.current = value;
  }, [value]);

  const handleModidChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const newModid = e.target.value;
      setModidValue(newModid);
      const emitted = `${newModid}:${pathValue}`;
      lastEmittedRef.current = emitted;
      onChange(emitted);
    },
    [pathValue, onChange],
  );

  const handlePathChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newPath = e.target.value;
      setPathValue(newPath);
      const emitted = `${modidValue}:${newPath}`;
      lastEmittedRef.current = emitted;
      onChange(emitted);
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
