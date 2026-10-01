import { memo, useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import type { EditorProps } from './types.js';

/**
 * 本地标识符编辑器（**定义型** ID）。
 *
 * 用于本 mod 自身内容的标识字段：物品/方块/实体/配方/机器/结构/群系/维度/流体/GUI。
 *
 * 与 ResourceIdEditor 的区别：
 * - ResourceIdEditor 服务**引用型**字段，取值必须带命名空间（`modid:path`），命名空间可切换
 * - 本编辑器服务**定义型**字段，取值就是本 mod 内的裸 id；命名空间恒为当前 mod，
 *   只作为只读前缀展示，不参与取值
 *
 * 这样数据层始终保持裸 id，与 ModSpec 的 `^[a-z0-9_]+$` 约束一致，避免出现
 * 「在抽屉里改一次 ID 就导致节点图存不下 / 生成失败」。
 *
 * 与 ResourceIdEditor 一致：本组件不自行校验格式，格式错误的展示由
 * FieldRow 的 ErrorRecovery 统一负责（避免同一错误出现两处）。
 *
 * P1 修复（与 ResourceIdEditor 同）：用 ref 跟踪本组件最后一次发出的值，
 * 仅当外部 value 与之不同时才回写本地 state，避免输入过程中的竞态闪烁。
 */
function LocalIdEditorComponent({ value, onChange, schema, graph }: EditorProps<string>) {
  const namespace = graph.modId || '';
  const [local, setLocal] = useState(value);
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) setLocal(value);
    lastEmittedRef.current = value;
  }, [value]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocal(next);
      lastEmittedRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-1">
      <span
        data-testid="local-id-namespace"
        className="shrink-0 border border-t-black border-l-black border-b-white border-r-white bg-mc-btn px-1 py-0.5 text-[11px] text-mc-dim"
      >
        {namespace || '(未设置)'}
      </span>
      <span className="text-mc-dim">:</span>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        aria-label={`${schema.label}（本地名，不含命名空间）`}
        className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
      />
    </div>
  );
}

export const LocalIdEditor = memo(LocalIdEditorComponent);
