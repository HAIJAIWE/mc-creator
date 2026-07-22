// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberStepperEditor } from './NumberStepperEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = {
  version: 1,
  modId: 'test',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
};

describe('NumberStepperEditor', () => {
  const schema: FieldSchema = {
    key: 'maxDamage',
    label: '耐久',
    type: 'number',
    min: 0,
    max: 99999,
  };

  it('渲染当前值', () => {
    render(<NumberStepperEditor value={250} onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByDisplayValue('250')).toBeTruthy();
  });

  it('点击 + 按钮增加值', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={10} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('增加'));
    expect(onChange).toHaveBeenCalledWith(11);
  });

  it('点击 - 按钮减少值', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={10} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('减少'));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('不超过 max', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={99999} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('增加'));
    expect(onChange).toHaveBeenCalledWith(99999);
  });

  it('不低于 min', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={0} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('减少'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('输入框直接编辑触发 onChange', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={10} onChange={onChange} schema={schema} graph={graph} />);
    const input = screen.getByDisplayValue('10');
    fireEvent.change(input, { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(42);
  });
});
