// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { McNodePort } from './McNodePort.js';
import type { NodePort } from '@mc-creator/shared';

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('McNodePort', () => {
  const outPort: NodePort = {
    id: 'out',
    label: '物品',
    type: 'item_stack',
    direction: 'out',
    required: false,
    multiple: false,
  };
  const inPort: NodePort = {
    id: 'in',
    label: '材料',
    type: 'item_stack',
    direction: 'in',
    required: true,
    multiple: true,
  };

  it('输出端口渲染标签', () => {
    renderWithProvider(<McNodePort port={outPort} />);
    expect(screen.getByText('物品')).toBeTruthy();
  });

  it('输入端口渲染标签', () => {
    renderWithProvider(<McNodePort port={inPort} />);
    expect(screen.getByText('材料')).toBeTruthy();
  });

  it('必填端口显示 * 标记', () => {
    renderWithProvider(<McNodePort port={inPort} />);
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('非必填端口不显示 * 标记', () => {
    const { container } = renderWithProvider(<McNodePort port={outPort} />);
    expect(container.querySelector('.text-red-400')).toBeNull();
  });
});
