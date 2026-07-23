// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SubgraphEditor } from './SubgraphEditor.js';
import type { SubgraphDefinition } from '@mc-creator/shared';

vi.mock('reactflow', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="reactflow">{children}</div>,
  Background: () => <div data-testid="background" />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />,
}));

const mockSg: SubgraphDefinition = {
  id: 'sg_1',
  name: '测试子图',
  nodes: [],
  edges: [],
  portMappings: [],
};

describe('SubgraphEditor', () => {
  it('渲染子图名 + React Flow 画布', () => {
    render(<SubgraphEditor subgraph={mockSg} onChange={() => {}} />);
    expect(screen.getByText(/测试子图/)).toBeTruthy();
    expect(screen.getByTestId('reactflow')).toBeTruthy();
  });

  it('渲染边界节点添加按钮', () => {
    render(<SubgraphEditor subgraph={mockSg} onChange={() => {}} />);
    expect(screen.getByText('添加输入边界')).toBeTruthy();
    expect(screen.getByText('添加输出边界')).toBeTruthy();
  });
});
