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

/** 检查字段是否应该显示（基于 condition） */
function shouldShow(field: FieldSchema, draft: NodeData): boolean {
  if (!field.condition) return true;
  const fieldValue = (draft as Record<string, unknown>)[field.condition.field];
  if (field.condition.equals !== undefined) return fieldValue === field.condition.equals;
  if (field.condition.in !== undefined) return field.condition.in.includes(String(fieldValue));
  return true;
}

interface FieldRowProps {
  field: FieldSchema;
  draft: NodeData;
  updateField: (key: string, value: unknown) => void;
  graph: NodeGraph;
  errors: Record<string, string>;
}

function FieldRow({ field, draft, updateField, graph, errors }: FieldRowProps) {
  const value = (draft as Record<string, unknown>)[field.key];
  const onChange = (v: unknown) => updateField(field.key, v);
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
