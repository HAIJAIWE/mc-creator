// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import type { NodeGraph, ModNode, ModEdge, NodeData, NodeKind, NodePort } from '@mc-creator/shared';
import {
  initDebugger,
  stepForward,
  runUntilBreakpoint,
  resetDebugger,
  getNextNodes,
  evaluateNode,
} from './nodeGraphDebugger.js';

/**
 * 节点图调试器引擎测试
 *
 * 覆盖：
 * - initDebugger：空图 / 无 event / 单 event / 多 event / disabled event
 * - stepForward：event→condition / true 分支 / false 分支 / action 链 / 终止 / 已结束 / 非 control 边
 * - runUntilBreakpoint：断点暂停 / 无断点跑完 / 环形图防无限循环 / 已 finished
 * - resetDebugger：重置回初始
 * - getNextNodes：control 边目标 / 无边 / disabled 边
 * - evaluateNode：event / condition(has_item 有/无输入) / chance / invert / action / code(warning) / 其他
 */

// === 测试辅助函数 ===
// 复刻 node-graph-store.ts 中的 createDefaultNodeData / createDefaultPorts 逻辑，
// 用于构造合法测试节点（任务约束不允许修改 store 文件）。

function createDefaultNodeData(kind: NodeKind): NodeData {
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
  };
  switch (kind) {
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: 'new_item',
        displayName: '新物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      } as NodeData;
    case 'block':
      return {
        ...base,
        kind: 'block',
        blockId: 'new_block',
        displayName: '新方块',
        hardness: 1.0,
        blastResistance: 3.0,
        luminance: 0,
        transparent: false,
        solid: true,
        modelType: 'cube_all',
        isBlockEntity: false,
      } as NodeData;
    case 'entity':
      return {
        ...base,
        kind: 'entity',
        entityId: 'new_entity',
        displayName: '新生物',
        maxHealth: 20,
        attackDamage: 0,
        movementSpeed: 0.3,
        classification: 'misc',
        modelType: 'pig',
        spawnWeight: 0,
        spawnBiomes: [],
      } as NodeData;
    case 'recipe':
      return {
        ...base,
        kind: 'recipe',
        recipeId: 'new_recipe',
        recipeType: 'crafting_shaped',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      } as NodeData;
    case 'machine':
      return {
        ...base,
        kind: 'machine',
        machineId: 'new_machine',
        displayName: '新机器',
        energyCapacity: 10000,
        maxEnergyTransfer: 100,
        inputSlots: 1,
        outputSlots: 1,
        defaultProcessTime: 200,
        defaultEnergyPerTick: 10,
        guiWidth: 176,
        guiHeight: 166,
      } as NodeData;
    case 'multiblock':
      return {
        ...base,
        kind: 'multiblock',
        structureId: 'new_structure',
        displayName: '新多方块结构',
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        controllerOffset: { x: 1, y: 1, z: 0 },
      } as NodeData;
    case 'event':
      return {
        ...base,
        kind: 'event',
        eventType: 'player_right_click_block',
        eventArgs: '{}',
      } as NodeData;
    case 'condition':
      return {
        ...base,
        kind: 'condition',
        conditionType: 'has_item',
        conditionArgs: '{}',
        invert: false,
      } as NodeData;
    case 'action':
      return {
        ...base,
        kind: 'action',
        actionType: 'spawn_entity',
        actionArgs: '{}',
      } as NodeData;
    case 'code':
      return {
        ...base,
        kind: 'code',
        language: 'java',
        code: '// test',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'process',
      } as NodeData;
    case 'comment':
      return {
        ...base,
        kind: 'comment',
        text: '备注',
        color: 'yellow',
      } as NodeData;
    default:
      throw new Error(`Unknown node kind: ${kind satisfies never}`);
  }
}

function createDefaultPorts(kind: NodeKind): NodePort[] {
  switch (kind) {
    case 'event':
      return [
        {
          id: 'trigger',
          label: '触发',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'condition':
      return [
        {
          id: 'in',
          label: '输入',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'true',
          label: '真',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
        {
          id: 'false',
          label: '假',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'action':
      return [
        {
          id: 'in',
          label: '执行',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'out',
          label: '完成',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'code':
      return [
        { id: 'in', label: '输入', type: 'any', direction: 'in', required: false, multiple: false },
        {
          id: 'out',
          label: '输出',
          type: 'any',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    default:
      return [];
  }
}

/** 构造测试用节点，覆盖默认 data 字段 */
function makeNode(id: string, kind: NodeKind, overrides?: Record<string, unknown>): ModNode {
  const baseData = createDefaultNodeData(kind);
  const merged = { ...baseData, ...overrides, nodeId: id } as NodeData;
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: merged,
    ports: createDefaultPorts(kind),
    selected: false,
  };
}

/** 构造测试用边（默认 kind=control） */
function makeEdge(
  id: string,
  source: string,
  target: string,
  opts?: {
    sourceHandle?: string;
    targetHandle?: string;
    kind?: ModEdge['kind'];
    disabled?: boolean;
  },
): ModEdge {
  return {
    id,
    source,
    target,
    sourceHandle: opts?.sourceHandle,
    targetHandle: opts?.targetHandle,
    kind: opts?.kind ?? 'control',
    disabled: opts?.disabled ?? false,
  };
}

/** 构造合法的测试用节点图 */
function makeGraph(nodes: ModNode[], edges: ModEdge[] = [], modId = 'test'): NodeGraph {
  return {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
  };
}

// === 测试用例 ===

describe('initDebugger', () => {
  it('1. 空图 → finished=true（无 event 节点）', () => {
    const graph = makeGraph([]);
    const state = initDebugger(graph);
    expect(state.finished).toBe(true);
    expect(state.currentNodeId).toBeNull();
    expect(state.visitedNodeIds).toEqual([]);
    expect(state.logs.length).toBeGreaterThan(0);
    expect(state.logs[state.logs.length - 1].action).toBe('error');
  });

  it('2. 无 event 节点 → finished=true', () => {
    const graph = makeGraph([makeNode('n_action', 'action'), makeNode('n_item', 'item')]);
    const state = initDebugger(graph);
    expect(state.finished).toBe(true);
    expect(state.currentNodeId).toBeNull();
  });

  it('3. 单 event 节点 → currentNodeId=event，visitedNodeIds=[event]', () => {
    const graph = makeGraph([makeNode('n_event', 'event', { label: '玩家右键方块' })]);
    const state = initDebugger(graph);
    expect(state.finished).toBe(false);
    expect(state.currentNodeId).toBe('n_event');
    expect(state.visitedNodeIds).toEqual(['n_event']);
    expect(state.callStack).toEqual(['n_event']);
    expect(state.logs.length).toBe(1);
    expect(state.logs[0].action).toBe('enter');
    expect(state.logs[0].nodeId).toBe('n_event');
    expect(state.logs[0].kind).toBe('event');
  });

  it('4. 多个 event 节点 → 取第一个作为入口', () => {
    const graph = makeGraph([
      makeNode('n_event_1', 'event', { label: '事件A' }),
      makeNode('n_event_2', 'event', { label: '事件B' }),
    ]);
    const state = initDebugger(graph);
    expect(state.currentNodeId).toBe('n_event_1');
    expect(state.visitedNodeIds).toEqual(['n_event_1']);
  });

  it('5. 跳过 disabled 的 event 节点，取下一个未禁用的', () => {
    const graph = makeGraph([
      makeNode('n_event_disabled', 'event', { disabled: true }),
      makeNode('n_event_active', 'event'),
    ]);
    const state = initDebugger(graph);
    expect(state.currentNodeId).toBe('n_event_active');
  });
});

describe('stepForward', () => {
  it('6. 从 event 沿 control 边到 condition', () => {
    const graph = makeGraph(
      [
        makeNode('n_event', 'event'),
        makeNode('n_condition', 'condition', { conditionType: 'is_day' }),
      ],
      [makeEdge('e1', 'n_event', 'n_condition', { sourceHandle: 'trigger' })],
    );
    const init = initDebugger(graph);
    expect(init.currentNodeId).toBe('n_event');

    const next = stepForward(graph, init);
    expect(next.currentNodeId).toBe('n_condition');
    expect(next.visitedNodeIds).toEqual(['n_event', 'n_condition']);
    expect(next.traversedEdgeIds).toEqual(['e1']);
    // event 节点应被评估并写入 variables
    expect(next.variables['n_event']).toBeDefined();
    expect(next.variables['n_event'].triggered).toBe(true);
    expect(next.finished).toBe(false);
    const lastLog = next.logs[next.logs.length - 1];
    expect(lastLog.action).toBe('enter');
    expect(lastLog.nodeId).toBe('n_condition');
  });

  it('7. 从 condition 走 true 分支（custom+chance 类型固定 true）', () => {
    const graph = makeGraph(
      [
        makeNode('n_event', 'event'),
        makeNode('n_condition', 'condition', {
          conditionType: 'custom',
          conditionArgs: '{"chance":0.5}',
        }),
        makeNode('n_action_true', 'action', { actionType: 'give_item' }),
        makeNode('n_action_false', 'action', { actionType: 'take_item' }),
      ],
      [
        makeEdge('e1', 'n_event', 'n_condition', { sourceHandle: 'trigger' }),
        makeEdge('e2', 'n_condition', 'n_action_true', { sourceHandle: 'true' }),
        makeEdge('e3', 'n_condition', 'n_action_false', { sourceHandle: 'false' }),
      ],
    );
    let state = stepForward(graph, initDebugger(graph));
    expect(state.currentNodeId).toBe('n_condition');
    state = stepForward(graph, state);
    expect(state.currentNodeId).toBe('n_action_true');
    expect(state.traversedEdgeIds).toContain('e2');
    expect(state.traversedEdgeIds).not.toContain('e3');
    const branchLog = state.logs.find((l) => l.action === 'branch-true');
    expect(branchLog).toBeDefined();
    expect(branchLog?.nodeId).toBe('n_condition');
  });

  it('8. 从 condition 走 false 分支（has_item 无输入时）', () => {
    const graph = makeGraph(
      [
        makeNode('n_event', 'event'),
        makeNode('n_condition', 'condition', { conditionType: 'has_item' }),
        makeNode('n_action_true', 'action'),
        makeNode('n_action_false', 'action'),
      ],
      [
        makeEdge('e1', 'n_event', 'n_condition', { sourceHandle: 'trigger' }),
        makeEdge('e2', 'n_condition', 'n_action_true', { sourceHandle: 'true' }),
        makeEdge('e3', 'n_condition', 'n_action_false', { sourceHandle: 'false' }),
      ],
    );
    let state = stepForward(graph, initDebugger(graph));
    expect(state.currentNodeId).toBe('n_condition');
    // event 输出不含 item_stack，has_item 应判定 false
    state = stepForward(graph, state);
    expect(state.currentNodeId).toBe('n_action_false');
    expect(state.traversedEdgeIds).toContain('e3');
    expect(state.traversedEdgeIds).not.toContain('e2');
    const branchLog = state.logs.find((l) => l.action === 'branch-false');
    expect(branchLog).toBeDefined();
  });

  it('9. 从 action 继续走（链式 action）', () => {
    const graph = makeGraph(
      [
        makeNode('n_event', 'event'),
        makeNode('n_action_1', 'action', { actionType: 'give_item' }),
        makeNode('n_action_2', 'action', { actionType: 'send_message' }),
      ],
      [
        makeEdge('e1', 'n_event', 'n_action_1', { sourceHandle: 'trigger' }),
        makeEdge('e2', 'n_action_1', 'n_action_2', { sourceHandle: 'out' }),
      ],
    );
    let state = stepForward(graph, initDebugger(graph));
    expect(state.currentNodeId).toBe('n_action_1');
    state = stepForward(graph, state);
    expect(state.currentNodeId).toBe('n_action_2');
    expect(state.traversedEdgeIds).toEqual(['e1', 'e2']);
    expect(state.variables['n_action_1'].executed).toBe(true);
  });

  it('10. 到无下一节点 → finished=true', () => {
    const graph = makeGraph(
      [makeNode('n_event', 'event'), makeNode('n_action', 'action')],
      [makeEdge('e1', 'n_event', 'n_action', { sourceHandle: 'trigger' })],
    );
    let state = stepForward(graph, initDebugger(graph));
    expect(state.currentNodeId).toBe('n_action');
    expect(state.finished).toBe(false);
    state = stepForward(graph, state);
    expect(state.finished).toBe(true);
    expect(state.currentNodeId).toBe('n_action');
    const lastLog = state.logs[state.logs.length - 1];
    expect(lastLog.action).toBe('leave');
  });

  it('11. 已结束时再调用 → 不变化（返回同一引用）', () => {
    const graph = makeGraph([makeNode('n_event', 'event')]);
    const state = stepForward(graph, initDebugger(graph));
    expect(state.finished).toBe(true);
    const afterCall = stepForward(graph, state);
    expect(afterCall).toBe(state);
    expect(afterCall.finished).toBe(true);
    expect(afterCall.logs.length).toBe(state.logs.length);
  });

  it('12. event 无下游 control 边 → step 后 finished', () => {
    const graph = makeGraph(
      [makeNode('n_event', 'event')],
      // data 边不应被走
      [makeEdge('e1', 'n_event', 'n_event', { kind: 'data' })],
    );
    const state = stepForward(graph, initDebugger(graph));
    expect(state.finished).toBe(true);
  });

  it('13. 不沿非 control 边推进', () => {
    const graph = makeGraph(
      [makeNode('n_event', 'event'), makeNode('n_action', 'action')],
      // craft 边不应被走
      [makeEdge('e1', 'n_event', 'n_action', { kind: 'craft', sourceHandle: 'trigger' })],
    );
    const state = stepForward(graph, initDebugger(graph));
    expect(state.finished).toBe(true);
    expect(state.currentNodeId).toBe('n_event');
  });
});

describe('runUntilBreakpoint', () => {
  it('14. 遇到断点停下', () => {
    const graph = makeGraph(
      [
        makeNode('n_event', 'event'),
        makeNode('n_action_1', 'action'),
        makeNode('n_action_2', 'action'),
      ],
      [
        makeEdge('e1', 'n_event', 'n_action_1', { sourceHandle: 'trigger' }),
        makeEdge('e2', 'n_action_1', 'n_action_2', { sourceHandle: 'out' }),
      ],
    );
    const init = initDebugger(graph);
    const breakpoints = new Set<string>(['n_action_2']);
    const state = runUntilBreakpoint(graph, init, breakpoints);
    expect(state.finished).toBe(false);
    expect(state.currentNodeId).toBe('n_action_2');
    expect(state.visitedNodeIds).toContain('n_action_2');
  });

  it('15. 无断点跑到结束', () => {
    const graph = makeGraph(
      [
        makeNode('n_event', 'event'),
        makeNode('n_action_1', 'action'),
        makeNode('n_action_2', 'action'),
      ],
      [
        makeEdge('e1', 'n_event', 'n_action_1', { sourceHandle: 'trigger' }),
        makeEdge('e2', 'n_action_1', 'n_action_2', { sourceHandle: 'out' }),
      ],
    );
    const init = initDebugger(graph);
    const breakpoints = new Set<string>();
    const state = runUntilBreakpoint(graph, init, breakpoints);
    expect(state.finished).toBe(true);
    expect(state.visitedNodeIds).toEqual(['n_event', 'n_action_1', 'n_action_2']);
  });

  it('16. 防止无限循环（环形图）', () => {
    // 构造环形图：event → action → event
    const graph = makeGraph(
      [makeNode('n_event', 'event'), makeNode('n_action', 'action')],
      [
        makeEdge('e1', 'n_event', 'n_action', { sourceHandle: 'trigger' }),
        makeEdge('e2', 'n_action', 'n_event', { sourceHandle: 'out' }),
      ],
    );
    const init = initDebugger(graph);
    const breakpoints = new Set<string>();
    const state = runUntilBreakpoint(graph, init, breakpoints);
    expect(state.finished).toBe(true);
    expect(state.error).toBeNull();
    const leaveLog = state.logs.find((l) => l.action === 'leave' && l.message?.includes('环路'));
    expect(leaveLog).toBeDefined();
  });

  it('17. 已 finished 状态调用 → 直接返回同一引用', () => {
    const graph = makeGraph([makeNode('n_event', 'event')]);
    const init = initDebugger(graph);
    const finished = stepForward(graph, init);
    expect(finished.finished).toBe(true);
    const result = runUntilBreakpoint(graph, finished, new Set());
    expect(result).toBe(finished);
  });
});

describe('resetDebugger', () => {
  it('18. 重置回初始状态', () => {
    const graph = makeGraph(
      [makeNode('n_event', 'event'), makeNode('n_action', 'action')],
      [makeEdge('e1', 'n_event', 'n_action', { sourceHandle: 'trigger' })],
    );
    const init = initDebugger(graph);
    const advanced = stepForward(graph, init);
    expect(advanced.currentNodeId).toBe('n_action');
    const reset = resetDebugger(graph);
    expect(reset.currentNodeId).toBe('n_event');
    expect(reset.visitedNodeIds).toEqual(['n_event']);
    expect(reset.callStack).toEqual(['n_event']);
    expect(reset.traversedEdgeIds).toEqual([]);
    expect(reset.variables).toEqual({});
    expect(reset.finished).toBe(false);
  });
});

describe('getNextNodes', () => {
  it('19. 返回 control 边目标节点', () => {
    const graph = makeGraph(
      [
        makeNode('n_event', 'event'),
        makeNode('n_action_1', 'action'),
        makeNode('n_action_2', 'action'),
      ],
      [
        makeEdge('e1', 'n_event', 'n_action_1', { sourceHandle: 'trigger' }),
        makeEdge('e2', 'n_event', 'n_action_2', { sourceHandle: 'trigger' }),
        // 非 control 边不应返回
        makeEdge('e3', 'n_event', 'n_action_1', { kind: 'data' }),
      ],
    );
    const next = getNextNodes(graph, 'n_event');
    expect(next.length).toBe(2);
    const ids = next.map((n) => n.id);
    expect(ids).toContain('n_action_1');
    expect(ids).toContain('n_action_2');
  });

  it('20. 无 control 边返回空数组', () => {
    const graph = makeGraph(
      [makeNode('n_event', 'event')],
      [makeEdge('e1', 'n_event', 'n_event', { kind: 'data' })],
    );
    const next = getNextNodes(graph, 'n_event');
    expect(next).toEqual([]);
  });

  it('21. 跳过 disabled 的 control 边', () => {
    const graph = makeGraph(
      [makeNode('n_event', 'event'), makeNode('n_action', 'action')],
      [makeEdge('e1', 'n_event', 'n_action', { sourceHandle: 'trigger', disabled: true })],
    );
    const next = getNextNodes(graph, 'n_event');
    expect(next).toEqual([]);
  });
});

describe('evaluateNode', () => {
  it('22. event 节点：触发，输出 triggered=true', () => {
    const node = makeNode('n_event', 'event', { eventType: 'block_break' });
    const result = evaluateNode(node, {});
    expect(result.outputs.triggered).toBe(true);
    expect(result.outputs.eventType).toBe('block_break');
    expect(result.branchDecision).toBeUndefined();
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it('23. condition 节点（has_item 有输入 → true）', () => {
    const node = makeNode('n_cond', 'condition', { conditionType: 'has_item' });
    const result = evaluateNode(node, { item_stack: { id: 'minecraft:diamond', count: 1 } });
    expect(result.branchDecision).toBe('true');
    expect(result.outputs.result).toBe(true);
  });

  it('24. condition 节点（has_item 无输入 → false）', () => {
    const node = makeNode('n_cond', 'condition', { conditionType: 'has_item' });
    const result = evaluateNode(node, {});
    expect(result.branchDecision).toBe('false');
    expect(result.outputs.result).toBe(false);
  });

  it('25. condition 节点（custom+chance 固定 → true）', () => {
    const node = makeNode('n_cond', 'condition', {
      conditionType: 'custom',
      conditionArgs: '{"chance":0.5}',
    });
    const result = evaluateNode(node, {});
    expect(result.branchDecision).toBe('true');
  });

  it('26. condition 节点（invert 反转结果）', () => {
    const node = makeNode('n_cond', 'condition', {
      conditionType: 'has_item',
      invert: true,
    });
    // 有输入但 invert=true → false
    const result = evaluateNode(node, { item_stack: { id: 'x' } });
    expect(result.branchDecision).toBe('false');
    expect(result.outputs.result).toBe(false);
  });

  it('27. action 节点：执行，输出 executed=true', () => {
    const node = makeNode('n_action', 'action', { actionType: 'teleport' });
    const result = evaluateNode(node, {});
    expect(result.outputs.executed).toBe(true);
    expect(result.outputs.actionType).toBe('teleport');
    expect(result.branchDecision).toBeUndefined();
  });

  it('28. code 节点：标记 warning（无法模拟）', () => {
    const node = makeNode('n_code', 'code', { language: 'java' });
    const result = evaluateNode(node, {});
    expect(result.outputs).toEqual({});
    // 日志应包含"无法"语义
    const hasWarning = result.logs.some((l) => l.includes('无法'));
    expect(hasWarning).toBe(true);
  });

  it('29. item 节点：跳过（输出空）', () => {
    const node = makeNode('n_item', 'item');
    const result = evaluateNode(node, {});
    expect(result.outputs).toEqual({});
    expect(result.branchDecision).toBeUndefined();
  });

  it('30. comment 节点：跳过', () => {
    const node = makeNode('n_comment', 'comment');
    const result = evaluateNode(node, {});
    expect(result.outputs).toEqual({});
  });
});
