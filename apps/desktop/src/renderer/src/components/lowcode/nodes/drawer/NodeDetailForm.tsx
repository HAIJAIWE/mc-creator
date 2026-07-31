import { memo, useMemo, useCallback } from 'react';
import type { NodeData, NodeGraph } from '@mc-creator/shared';
import { useDrawerStore } from '../../../../store/drawer-store.js';
import { useNodeGraphStore } from '../../../../store/node-graph-store.js';
import { getFieldSchemas } from './fieldSchemas.js';
import type { FieldSchema } from './editors/types.js';
import { NumberStepperEditor } from './editors/NumberStepperEditor.js';
import { DropdownEditor } from './editors/DropdownEditor.js';
import { SegmentedEditor } from './editors/SegmentedEditor.js';
import { ColorEditor } from './editors/ColorEditor.js';
import { ResourceIdEditor } from './editors/ResourceIdEditor.js';
import { NbtEditor } from './editors/NbtEditor.js';
import { NodeRefEditor } from './editors/NodeRefEditor.js';
import { CodeEditor } from './editors/CodeEditor.js';
import { FieldLabel } from './FieldLabel.js';
import { getTooltip } from './fieldTooltips.js';
import { ErrorRecovery, getErrorSuggestion, getFixLabel } from './ErrorRecovery.js';

/**
 * 字段级校验：返回错误文字或 undefined。
 * 覆盖 required 缺失、number 超限、resourceId 格式错误三类常见错误。
 */
function validateField(field: FieldSchema, value: unknown): string | undefined {
  if (field.required) {
    if (value === undefined || value === null || value === '') {
      return `${field.label}为必填项`;
    }
  }
  if (field.type === 'number' && typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      return `值 ${value} 小于最小值 ${field.min}`;
    }
    if (field.max !== undefined && value > field.max) {
      return `值 ${value} 大于最大值 ${field.max}`;
    }
  }
  if (field.type === 'resourceId' && typeof value === 'string' && value.length > 0) {
    if (!/^[a-z0-9_]+:[a-z0-9_/]+$/.test(value)) {
      return `格式错误，应为 modid:path（全小写+下划线）`;
    }
  }
  // P1-4 dogfood：pattern 正则校验（如 Java 标识符合法性）
  if (field.pattern && typeof value === 'string' && value.length > 0) {
    if (!new RegExp(field.pattern).test(value)) {
      return field.patternMessage ?? `格式不匹配：${field.pattern}`;
    }
  }
  return undefined;
}

/** 根据 field.type 渲染对应编辑器 */
function renderEditor(
  field: FieldSchema,
  value: unknown,
  onChange: (v: unknown) => void,
  graph: NodeGraph,
) {
  switch (field.type) {
    case 'number':
      return (
        <NumberStepperEditor
          value={Number(value ?? 0)}
          onChange={onChange}
          schema={field}
          graph={graph}
        />
      );
    case 'dropdown':
      return (
        <DropdownEditor
          value={String(value ?? '')}
          onChange={onChange}
          schema={field}
          graph={graph}
        />
      );
    case 'segmented':
      return (
        <SegmentedEditor
          value={String(value ?? 'false')}
          onChange={onChange}
          schema={field}
          graph={graph}
        />
      );
    case 'color':
      return (
        <ColorEditor
          value={String(value ?? '#FFFFFF')}
          onChange={onChange}
          schema={field}
          graph={graph}
        />
      );
    case 'resourceId':
      return (
        <ResourceIdEditor
          value={String(value ?? '')}
          onChange={onChange}
          schema={field}
          graph={graph}
        />
      );
    case 'nbt':
      return (
        <NbtEditor value={String(value ?? '{}')} onChange={onChange} schema={field} graph={graph} />
      );
    case 'noderef':
      return (
        <NodeRefEditor
          value={String(value ?? '')}
          onChange={onChange}
          schema={field}
          graph={graph}
        />
      );
    case 'code':
      return (
        <CodeEditor value={String(value ?? '')} onChange={onChange} schema={field} graph={graph} />
      );
    case 'text':
    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        />
      );
  }
}

/** 检查字段是否应该显示（基于 condition + excludeKinds） */
function shouldShow(field: FieldSchema, draft: NodeData): boolean {
  // excludeKinds：字段不在指定 kind 的抽屉里显示
  if (field.excludeKinds?.includes(draft.kind)) return false;
  if (!field.condition) return true;
  const fieldValue = (draft as Record<string, unknown>)[field.condition.field];
  // 兼容 boolean 字段：true/false 转 'true'/'false' 字符串再与 condition 字符串比较
  // （codeLocked=true 时 condition.equals:'true' 应匹配）
  const comparableValue = typeof fieldValue === 'boolean' ? String(fieldValue) : fieldValue;
  if (field.condition.equals !== undefined) return comparableValue === field.condition.equals;
  if (field.condition.in !== undefined) return field.condition.in.includes(String(comparableValue));
  return true;
}

/**
 * 检测 segmented 字段是否为布尔切换（options 恰为 ['false','true'] 或 ['true','false']）。
 *
 * SegmentedEditor 内部以字符串 'true'/'false' 表示选项，但 schema 字段是 `z.boolean()`。
 * 不做转换会让 `glow: 'false'`（字符串）在 Mustache `{{#if glow}}` 中被当作 truthy（非空字符串），
 * 导致条件代码块误渲染。此处统一在 FieldRow 边界做 string→boolean 转换。
 */
function isBooleanSegmented(field: FieldSchema): boolean {
  if (field.type !== 'segmented') return false;
  const opts = field.options ?? [];
  if (opts.length !== 2) return false;
  return (opts[0] === 'false' && opts[1] === 'true') || (opts[0] === 'true' && opts[1] === 'false');
}

/** 布尔 segmented 字段：把字符串值转回布尔（'true'→true，其他→false） */
function coerceBooleanValue(field: FieldSchema, raw: unknown): unknown {
  if (!isBooleanSegmented(field)) return raw;
  return raw === 'true' || raw === true;
}

interface FieldRowProps {
  field: FieldSchema;
  draft: NodeData;
  updateField: (key: string, value: unknown) => void;
  graph: NodeGraph;
  errors: Record<string, string>;
}

function FieldRow({ field, draft, updateField, graph, errors }: FieldRowProps) {
  // 布尔 segmented 字段：读取时把 boolean 转 string 给编辑器显示
  const rawValue = (draft as Record<string, unknown>)[field.key];
  const value = isBooleanSegmented(field) ? String(rawValue === true ? 'true' : 'false') : rawValue;
  // 布尔 segmented 字段：写入时把 string 转回 boolean
  const onChange = (v: unknown) => {
    updateField(field.key, coerceBooleanValue(field, v));
  };
  const tooltip = getTooltip(draft.kind, field.key);
  const error = errors[field.key];
  const suggestion = getErrorSuggestion(field, error, value);
  const fixLabel = getFixLabel(field, error);

  const handleFix = useCallback(() => {
    if (field.type === 'number') {
      if (field.max !== undefined && typeof value === 'number' && value > field.max) {
        updateField(field.key, field.max);
        return;
      }
      if (field.min !== undefined && typeof value === 'number' && value < field.min) {
        updateField(field.key, field.min);
        return;
      }
    }
  }, [field, value, updateField]);

  return (
    <div className="space-y-0.5">
      <FieldLabel label={field.label} required={field.required} tooltip={tooltip} />
      {renderEditor(field, value, onChange, graph)}
      <ErrorRecovery error={error} suggestion={suggestion} fixLabel={fixLabel} onFix={handleFix} />
    </div>
  );
}

function NodeDetailFormComponent() {
  const draft = useDrawerStore((s) => s.draft);
  const updateField = useDrawerStore((s) => s.updateField);
  const storeErrors = useDrawerStore((s) => s.errors);
  const graph = useNodeGraphStore((s) => s.graph);

  // 字段级校验：基于 draft 当前值计算错误（不依赖 drawer-store 是否实现校验）
  const computedErrors = useMemo(() => {
    if (!draft) return {} as Record<string, string>;
    const fields = getFieldSchemas(draft.kind);
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const v = (draft as Record<string, unknown>)[f.key];
      const e = validateField(f, v);
      if (e) errs[f.key] = e;
    }
    return errs;
  }, [draft]);

  // store errors 优先（外部校验覆盖内部计算），再合并
  const mergedErrors = useMemo(
    () => ({ ...computedErrors, ...storeErrors }),
    [computedErrors, storeErrors],
  );

  if (!draft) return null;

  const fields = getFieldSchemas(draft.kind);

  return (
    <div className="space-y-2">
      {fields
        .filter((f) => shouldShow(f, draft))
        .map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            draft={draft}
            updateField={updateField}
            graph={graph}
            errors={mergedErrors}
          />
        ))}
    </div>
  );
}

export const NodeDetailForm = memo(NodeDetailFormComponent);
