// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubgraphWorkspace } from './SubgraphWorkspace.js';

vi.mock('./SubgraphEditor.js', () => ({
  SubgraphEditor: ({ subgraph }: { subgraph: { name: string } }) => (
    <div data-testid="subgraph-editor">{subgraph.name}</div>
  ),
}));

vi.mock('../../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (
    sel: (s: {
      editingSubgraphId: string | null;
      setEditingSubgraphId: (id: string | null) => void;
      graph: {
        subgraphs: Record<
          string,
          {
            id: string;
            name: string;
            nodes: never[];
            edges: never[];
            portMappings: never[];
          }
        >;
      };
    }) => unknown,
  ) =>
    sel({
      editingSubgraphId: 'sg_1',
      setEditingSubgraphId: () => {},
      graph: {
        subgraphs: {
          sg_1: { id: 'sg_1', name: '我的子图', nodes: [], edges: [], portMappings: [] },
        },
      },
    }),
}));

describe('SubgraphWorkspace', () => {
  it('渲染子图编辑器 + 返回按钮', () => {
    render(<SubgraphWorkspace />);
    expect(screen.getByTestId('subgraph-editor').textContent).toBe('我的子图');
    expect(screen.getByText(/返回主图/)).toBeTruthy();
  });
});
