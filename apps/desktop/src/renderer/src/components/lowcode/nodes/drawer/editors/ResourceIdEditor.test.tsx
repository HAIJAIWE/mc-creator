// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResourceIdEditor } from './ResourceIdEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = {
  version: 1,
  modId: 'test',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  subgraphs: {},
};

describe('ResourceIdEditor', () => {
  const schema: FieldSchema = {
    key: 'itemId',
    label: '物品 ID',
    type: 'resourceId',
    required: true,
  };

  it('解析 modid:path 格式', () => {
    render(
      <ResourceIdEditor
        value="mymod:iron_sword"
        onChange={() => {}}
        schema={schema}
        graph={graph}
      />,
    );
    expect(screen.getByDisplayValue('mymod')).toBeTruthy();
    expect(screen.getByDisplayValue('iron_sword')).toBeTruthy();
  });

  it('只有 path 时 modid 默认为 minecraft', () => {
    render(
      <ResourceIdEditor value="iron_sword" onChange={() => {}} schema={schema} graph={graph} />,
    );
    expect(screen.getByDisplayValue('minecraft')).toBeTruthy();
    expect(screen.getByDisplayValue('iron_sword')).toBeTruthy();
  });

  it('编辑 path 触发 onChange 拼接 modid:path', () => {
    const onChange = vi.fn();
    render(
      <ResourceIdEditor
        value="mymod:iron_sword"
        onChange={onChange}
        schema={schema}
        graph={graph}
      />,
    );
    const pathInput = screen.getByDisplayValue('iron_sword');
    fireEvent.change(pathInput, { target: { value: 'diamond_sword' } });
    expect(onChange).toHaveBeenCalledWith('mymod:diamond_sword');
  });

  it('格式不合法时显示错误', () => {
    render(
      <ResourceIdEditor
        value="INVALID"
        onChange={() => {}}
        schema={schema}
        graph={graph}
        error="格式错误"
      />,
    );
    expect(screen.getByText('格式错误')).toBeTruthy();
  });
});
