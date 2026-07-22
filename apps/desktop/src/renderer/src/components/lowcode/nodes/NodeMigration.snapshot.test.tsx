// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { type ReactElement } from 'react';
import { ReactFlowProvider, type NodeProps } from 'reactflow';
import type { NodeData, NodeKind } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { ItemNode } from './ItemNode.js';
import { BlockNode } from './BlockNode.js';
import { EntityNode } from './EntityNode.js';
import { RecipeNode } from './RecipeNode.js';
import { MachineNode } from './MachineNode.js';
import { MultiBlockNode } from './MultiBlockNode.js';
import { EventNode } from './EventNode.js';
import { ConditionNode } from './ConditionNode.js';
import { ActionNode } from './ActionNode.js';
import { CodeNode } from './CodeNode.js';
import { CommentNode } from './CommentNode.js';

const NODE_COMPONENTS: Record<NodeKind, React.ComponentType<any>> = {
  item: ItemNode,
  block: BlockNode,
  entity: EntityNode,
  recipe: RecipeNode,
  machine: MachineNode,
  multiblock: MultiBlockNode,
  event: EventNode,
  condition: ConditionNode,
  action: ActionNode,
  code: CodeNode,
  comment: CommentNode,
};

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('节点迁移快照测试', () => {
  beforeEach(() => {
    // 固定时间，避免 genId 使用 Date.now() 生成非确定性 ID 影响快照
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    useNodeGraphStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 每种节点 × 展开状态 快照
  for (const kind of Object.keys(NODE_COMPONENTS) as NodeKind[]) {
    const Component = NODE_COMPONENTS[kind];

    it(`${kind} 节点展开状态快照`, () => {
      const id = useNodeGraphStore.getState().addNode(kind, { x: 0, y: 0 });
      const data = useNodeGraphStore.getState().graph.nodes[0].data;
      const props = { id, data, selected: false } as unknown as NodeProps<NodeData>;

      const { container } = renderWithProvider(<Component {...props} />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it(`${kind} 节点折叠状态快照`, () => {
      const id = useNodeGraphStore.getState().addNode(kind, { x: 0, y: 0 });
      useNodeGraphStore.getState().toggleCollapse(id);
      const data = useNodeGraphStore.getState().graph.nodes[0].data;
      const props = { id, data, selected: false } as unknown as NodeProps<NodeData>;

      const { container } = renderWithProvider(<Component {...props} />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it(`${kind} 节点选中状态快照`, () => {
      const id = useNodeGraphStore.getState().addNode(kind, { x: 0, y: 0 });
      const data = useNodeGraphStore.getState().graph.nodes[0].data;
      const props = { id, data, selected: true } as unknown as NodeProps<NodeData>;

      const { container } = renderWithProvider(<Component {...props} />);
      expect(container.firstChild).toMatchSnapshot();
    });
  }
});
