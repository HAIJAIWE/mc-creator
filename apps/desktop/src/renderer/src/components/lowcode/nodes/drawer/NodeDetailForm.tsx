import { memo } from 'react';
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

function NodeDetailFormComponent() {
  const draft = useDrawerStore((s) => s.draft);
  const updateField = useDrawerStore((s) => s.updateField);
  const graph = useNodeGraphStore((s) => s.graph);

  if (!draft) return null;

  const fields = getFieldSchemas(draft.kind);

  return (
    <div className="space-y-2">
      {fields
        .filter((f) => shouldShow(f, draft))
        .map((field) => {
          const value = (draft as Record<string, unknown>)[field.key];
          const tooltip = getTooltip(draft.kind, field.key);
          return (
            <div key={field.key} className="space-y-0.5">
              <FieldLabel label={field.label} required={field.required} tooltip={tooltip} />
              {renderEditor(field, value, (v) => updateField(field.key, v), graph)}
            </div>
          );
        })}
    </div>
  );
}

export const NodeDetailForm = memo(NodeDetailFormComponent);
