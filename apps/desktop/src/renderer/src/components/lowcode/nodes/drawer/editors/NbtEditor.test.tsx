// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NbtEditor } from './NbtEditor.js';
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

describe('NbtEditor', () => {
  const schema: FieldSchema = { key: 'nbt', label: 'NBT', type: 'nbt' };

  it('空字符串渲染为空树', () => {
    render(<NbtEditor value="" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByText('（空）')).toBeTruthy();
  });

  it('渲染已有键值对', () => {
    const value = '{"count":5,"name":"sword"}';
    render(<NbtEditor value={value} onChange={() => {}} schema={schema} graph={graph} />);
    // 键渲染为 span 文本
    expect(screen.getByText('count')).toBeTruthy();
    expect(screen.getByText('name')).toBeTruthy();
    // 值渲染为 input defaultValue（renderValue 给字符串加引号）
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    expect(screen.getByDisplayValue('"sword"')).toBeTruthy();
  });

  it('添加新键触发 onChange', () => {
    const onChange = vi.fn();
    render(<NbtEditor value="{}" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('添加键'));
    expect(onChange).toHaveBeenCalled();
    const newJson = onChange.mock.calls[0][0] as string;
    const parsed = JSON.parse(newJson);
    expect(Object.keys(parsed)).toHaveLength(1);
  });

  it('非法 JSON 显示错误提示', () => {
    render(
      <NbtEditor
        value="INVALID"
        onChange={() => {}}
        schema={schema}
        graph={graph}
        error="解析失败"
      />,
    );
    expect(screen.getByText('解析失败')).toBeTruthy();
  });
});
