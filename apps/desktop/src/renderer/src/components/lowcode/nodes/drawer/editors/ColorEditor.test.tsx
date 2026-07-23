// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorEditor } from './ColorEditor.js';
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

describe('ColorEditor', () => {
  const schema: FieldSchema = { key: 'color', label: '染色', type: 'color' };

  it('渲染 16 色 MC 色板', () => {
    render(<ColorEditor value="#FFFFFF" onChange={() => {}} schema={schema} graph={graph} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(16);
  });

  it('点击色块触发 onChange', () => {
    const onChange = vi.fn();
    render(<ColorEditor value="#FFFFFF" onChange={onChange} schema={schema} graph={graph} />);
    const redBtn = screen.getByLabelText('红色');
    fireEvent.click(redBtn);
    expect(onChange).toHaveBeenCalledWith('#993333');
  });

  it('渲染自定义输入框', () => {
    render(<ColorEditor value="#FF0000" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByDisplayValue('#FF0000')).toBeTruthy();
  });
});
