// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedEditor } from './SegmentedEditor.js';
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

describe('SegmentedEditor', () => {
  const schema: FieldSchema = {
    key: 'glow',
    label: '发光',
    type: 'segmented',
    options: ['false', 'true'],
  };

  it('渲染分段按钮组', () => {
    render(<SegmentedEditor value="false" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByText('false')).toBeTruthy();
    expect(screen.getByText('true')).toBeTruthy();
  });

  it('点击分段触发 onChange', () => {
    const onChange = vi.fn();
    render(<SegmentedEditor value="false" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByText('true'));
    expect(onChange).toHaveBeenCalledWith('true');
  });

  it('当前选中段高亮', () => {
    render(<SegmentedEditor value="true" onChange={() => {}} schema={schema} graph={graph} />);
    const activeBtn = screen.getByText('true');
    expect(activeBtn.className).toContain('bg-mc-accent');
  });
});
