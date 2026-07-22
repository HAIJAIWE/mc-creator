import { describe, it, expect } from 'vitest';
import type { Connection, Edge } from 'reactflow';
import type { ModNode, NodeGraph, NodePort, PortType } from '@mc-creator/shared';
import { findPort, arePortTypesCompatible, isValidConnection } from './connectionRules.js';

/**
 * connectionRules 单元测试
 *
 * 覆盖端口查找、类型兼容性判断、连线合法性校验的全部规则：
 * - 自连拒绝
 * - 节点不存在拒绝
 * - 节点禁用拒绝
 * - 端口不存在拒绝
 * - 类型不兼容拒绝
 * - 方向不匹配拒绝（in→in / out→out / in→out）
 * - 合法连线通过
 *
 * 纯逻辑测试，无需 jsdom 环境，无需 React 渲染。
 */

// === 测试夹具 ===

/** 构造一个端口 */
function makePort(id: string, type: PortType, direction: 'in' | 'out'): NodePort {
  return {
    id,
    label: id,
    type,
    direction,
    required: false,
    multiple: false,
  };
}

/** 构造一个最小可用的 ModNode（仅包含校验关心的字段） */
function makeNode(id: string, ports: NodePort[], options: { disabled?: boolean } = {}): ModNode {
  return {
    id,
    type: 'item',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      label: id,
      note: '',
      disabled: options.disabled ?? false,
      collapsed: false,
      // ItemNodeData 必填字段
      kind: 'item',
      itemId: id,
      displayName: id,
      category: 'misc',
      maxStackSize: 64,
      maxDamage: 0,
      rarity: 'common',
      glow: false,
    },
    ports,
    selected: false,
  };
}

/** 构造一个空图（可传入 nodes） */
function makeGraph(nodes: ModNode[]): NodeGraph {
  return {
    version: 1,
    modId: 'test-mod',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges: [],
  };
}

// === findPort ===

describe('findPort', () => {
  it('找到对应 id 的端口', () => {
    const node = makeNode('n1', [
      makePort('in', 'item_stack', 'in'),
      makePort('out', 'item_stack', 'out'),
    ]);
    const port = findPort(node, 'out');
    expect(port).toBeDefined();
    expect(port?.id).toBe('out');
    expect(port?.type).toBe('item_stack');
    expect(port?.direction).toBe('out');
  });

  it('端口 id 不存在时返回 undefined', () => {
    const node = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    expect(findPort(node, 'nonexistent')).toBeUndefined();
  });

  it('portId 为 undefined 时返回 undefined', () => {
    const node = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    expect(findPort(node, undefined)).toBeUndefined();
  });

  it('portId 为 null 时返回 undefined', () => {
    const node = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    expect(findPort(node, null)).toBeUndefined();
  });

  it('portId 为空字符串时返回 undefined', () => {
    const node = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    expect(findPort(node, '')).toBeUndefined();
  });
});

// === arePortTypesCompatible ===

describe('arePortTypesCompatible', () => {
  describe('相同类型兼容', () => {
    const cases: PortType[] = [
      'item_stack',
      'block_state',
      'entity',
      'fluid',
      'energy',
      'redstone',
      'player',
      'world',
      'boolean',
      'integer',
      'number',
      'string',
      'nbt',
      'void',
      'any',
    ];
    for (const t of cases) {
      it(`${t} ↔ ${t} → true`, () => {
        expect(arePortTypesCompatible(t, t)).toBe(true);
      });
    }
  });

  describe('不同类型不兼容', () => {
    const pairs: Array<[PortType, PortType]> = [
      ['item_stack', 'energy'],
      ['energy', 'item_stack'],
      ['fluid', 'redstone'],
      ['void', 'item_stack'],
      ['item_stack', 'void'],
      ['boolean', 'integer'],
      ['number', 'string'],
      ['entity', 'block_state'],
    ];
    for (const [a, b] of pairs) {
      it(`${a} ↔ ${b} → false`, () => {
        expect(arePortTypesCompatible(a, b)).toBe(false);
      });
    }
  });

  describe("'any' 类型兼容所有", () => {
    const others: PortType[] = [
      'item_stack',
      'block_state',
      'entity',
      'fluid',
      'energy',
      'redstone',
      'player',
      'world',
      'boolean',
      'integer',
      'number',
      'string',
      'nbt',
      'void',
    ];
    for (const t of others) {
      it(`any → ${t} → true`, () => {
        expect(arePortTypesCompatible('any', t)).toBe(true);
      });
      it(`${t} → any → true`, () => {
        expect(arePortTypesCompatible(t, 'any')).toBe(true);
      });
    }
    it('any ↔ any → true', () => {
      expect(arePortTypesCompatible('any', 'any')).toBe(true);
    });
  });

  describe('控制流 void 类型', () => {
    it('void ↔ void → true（控制流可连）', () => {
      expect(arePortTypesCompatible('void', 'void')).toBe(true);
    });
    it('void → item_stack → false（控制流不能连数据流）', () => {
      expect(arePortTypesCompatible('void', 'item_stack')).toBe(false);
    });
    it('energy → void → false', () => {
      expect(arePortTypesCompatible('energy', 'void')).toBe(false);
    });
  });
});

// === isValidConnection ===

describe('isValidConnection', () => {
  // ============================================================
  // 基础拒绝场景
  // ============================================================

  it('source 为 null 拒绝', () => {
    const graph = makeGraph([makeNode('n1', [makePort('out', 'item_stack', 'out')])]);
    const conn: Connection = {
      source: null,
      target: 'n1',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('target 为 null 拒绝', () => {
    const graph = makeGraph([makeNode('n1', [makePort('out', 'item_stack', 'out')])]);
    const conn: Connection = {
      source: 'n1',
      target: null,
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('source === target（自连）拒绝', () => {
    const node = makeNode('n1', [
      makePort('in', 'item_stack', 'in'),
      makePort('out', 'item_stack', 'out'),
    ]);
    const graph = makeGraph([node]);
    const conn: Connection = {
      source: 'n1',
      target: 'n1',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('源节点不存在拒绝', () => {
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([target]);
    const conn: Connection = {
      source: 'nonexistent',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('目标节点不存在拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const graph = makeGraph([source]);
    const conn: Connection = {
      source: 'n1',
      target: 'nonexistent',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('源节点 disabled 拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')], { disabled: true });
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('目标节点 disabled 拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')], { disabled: true });
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  // ============================================================
  // 端口存在校验
  // ============================================================

  it('源端口 sourceHandle 不存在拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'nonexistent_port',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('目标端口 targetHandle 不存在拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'nonexistent_port',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('sourceHandle 为 null 拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: null,
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  // ============================================================
  // 类型兼容校验
  // ============================================================

  it('类型相同（item_stack → item_stack）允许', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('类型相同（energy → energy）允许', () => {
    const source = makeNode('n1', [makePort('out', 'energy', 'out')]);
    const target = makeNode('n2', [makePort('in', 'energy', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('控制流（void → void）允许', () => {
    const source = makeNode('n1', [makePort('out', 'void', 'out')]);
    const target = makeNode('n2', [makePort('in', 'void', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('类型不兼容（item_stack → energy）拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'energy', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('类型不兼容（void → item_stack）拒绝', () => {
    const source = makeNode('n1', [makePort('out', 'void', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('源端口为 any 允许连接任意类型目标', () => {
    const source = makeNode('n1', [makePort('out', 'any', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('目标端口为 any 允许连接任意类型源', () => {
    const source = makeNode('n1', [makePort('out', 'energy', 'out')]);
    const target = makeNode('n2', [makePort('in', 'any', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('源和目标都是 any 允许', () => {
    const source = makeNode('n1', [makePort('out', 'any', 'out')]);
    const target = makeNode('n2', [makePort('in', 'any', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  // ============================================================
  // 方向校验
  // ============================================================

  it('out → in 允许（正确方向）', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('in → in 拒绝（源端口方向错误）', () => {
    const source = makeNode('n1', [makePort('in', 'item_stack', 'in')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'in',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('out → out 拒绝（目标端口方向错误）', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('out', 'item_stack', 'out')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'out',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('in → out 拒绝（双向都错）', () => {
    const source = makeNode('n1', [makePort('in', 'item_stack', 'in')]);
    const target = makeNode('n2', [makePort('out', 'item_stack', 'out')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'in',
      targetHandle: 'out',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  // ============================================================
  // Edge 类型兼容（isValidConnection 也接受 Edge）
  // ============================================================

  it('接受 Edge 类型入参（合法连线返回 true）', () => {
    const source = makeNode('n1', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('n2', [makePort('in', 'item_stack', 'in')]);
    const graph = makeGraph([source, target]);
    const edge: Edge = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, edge)).toBe(true);
  });

  it('接受 Edge 类型入参（自连返回 false）', () => {
    const node = makeNode('n1', [
      makePort('in', 'item_stack', 'in'),
      makePort('out', 'item_stack', 'out'),
    ]);
    const graph = makeGraph([node]);
    const edge: Edge = {
      id: 'e1',
      source: 'n1',
      target: 'n1',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, edge)).toBe(false);
  });

  // ============================================================
  // 综合场景（接近真实节点配置）
  // ============================================================

  it('machine 节点的能源输入端口可连 energy 输出', () => {
    // 模拟 energy 源节点（虚构）：out:energy
    const source = makeNode('energy_source', [makePort('out', 'energy', 'out')]);
    // 模拟 machine 节点：in_energy:energy
    const target = makeNode('machine_1', [makePort('in_energy', 'energy', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'energy_source',
      target: 'machine_1',
      sourceHandle: 'out',
      targetHandle: 'in_energy',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('machine 节点的能源端口不能连 item_stack 输出', () => {
    const source = makeNode('item_source', [makePort('out', 'item_stack', 'out')]);
    const target = makeNode('machine_1', [makePort('in_energy', 'energy', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'item_source',
      target: 'machine_1',
      sourceHandle: 'out',
      targetHandle: 'in_energy',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });

  it('event → condition 控制流允许（void → void）', () => {
    // event 节点 trigger:void/out
    const source = makeNode('event_1', [makePort('trigger', 'void', 'out')]);
    // condition 节点 in:void/in
    const target = makeNode('cond_1', [makePort('in', 'void', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'event_1',
      target: 'cond_1',
      sourceHandle: 'trigger',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('code 节点的 any 输入端口可接受任意类型源', () => {
    const source = makeNode('block_1', [makePort('out', 'block_state', 'out')]);
    // code 节点 in:any/in（与 store 中 createDefaultPorts('code') 一致）
    const target = makeNode('code_1', [makePort('in', 'any', 'in')]);
    const graph = makeGraph([source, target]);
    const conn: Connection = {
      source: 'block_1',
      target: 'code_1',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(true);
  });

  it('空图拒绝任何连线', () => {
    const graph = makeGraph([]);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(isValidConnection(graph, conn)).toBe(false);
  });
});
