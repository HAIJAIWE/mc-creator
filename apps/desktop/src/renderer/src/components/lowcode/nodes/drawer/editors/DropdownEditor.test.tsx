// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownEditor } from './DropdownEditor.js';
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

describe('DropdownEditor', () => {
  const schema: FieldSchema = {
    key: 'rarity',
    label: '稀有度',
    type: 'dropdown',
    options: ['common', 'uncommon', 'rare', 'epic'],
  };

  it('渲染 select 含所有选项', () => {
    render(<DropdownEditor value="common" onChange={() => {}} schema={schema} graph={graph} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    expect(screen.getByText('common')).toBeTruthy();
    expect(screen.getByText('epic')).toBeTruthy();
  });

  it('选择新值触发 onChange', () => {
    const onChange = vi.fn();
    render(<DropdownEditor value="common" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rare' } });
    expect(onChange).toHaveBeenCalledWith('rare');
  });
});
