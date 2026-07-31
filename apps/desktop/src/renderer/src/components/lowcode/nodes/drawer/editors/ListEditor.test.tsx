// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListEditor } from './ListEditor.js';
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

const schema: FieldSchema = {
  key: 'inputs',
  label: '输入参数',
  type: 'list',
  listItemSchema: [
    { key: 'name', label: '参数名', type: 'text' },
    { key: 'type', label: '类型', type: 'dropdown', options: ['int', 'string', 'boolean'] },
  ],
};

describe('ListEditor', () => {
  it('空值时显示添加按钮', () => {
    render(<ListEditor value={[]} onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByText('+ 添加参数')).toBeTruthy();
  });

  it('点击添加按钮追加一行（带类型默认值）', () => {
    const onChange = vi.fn();
    render(<ListEditor value={[]} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByText('+ 添加参数'));
    expect(onChange).toHaveBeenCalledWith([{ name: '', type: 'int' }]);
  });

  it('渲染已有行并编辑字段', () => {
    const onChange = vi.fn();
    render(
      <ListEditor
        value={[{ name: 'amount', type: 'int' }]}
        onChange={onChange}
        schema={schema}
        graph={graph}
      />,
    );
    const nameInput = screen.getByDisplayValue('amount');
    fireEvent.change(nameInput, { target: { value: 'count' } });
    expect(onChange).toHaveBeenCalledWith([{ name: 'count', type: 'int' }]);
  });

  it('类型下拉切换', () => {
    const onChange = vi.fn();
    render(
      <ListEditor
        value={[{ name: 'item', type: 'int' }]}
        onChange={onChange}
        schema={schema}
        graph={graph}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('int'), { target: { value: 'string' } });
    expect(onChange).toHaveBeenCalledWith([{ name: 'item', type: 'string' }]);
  });

  it('删除行', () => {
    const onChange = vi.fn();
    render(
      <ListEditor
        value={[
          { name: 'a', type: 'int' },
          { name: 'b', type: 'string' },
        ]}
        onChange={onChange}
        schema={schema}
        graph={graph}
      />,
    );
    const deleteButtons = screen.getAllByLabelText('删除');
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([{ name: 'b', type: 'string' }]);
  });
});
