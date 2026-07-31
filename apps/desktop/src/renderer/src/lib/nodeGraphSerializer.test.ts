// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  serializeGraph,
  deserializeGraph,
  safeDeserializeGraph,
  validateGraph,
  downloadGraphAsJson,
  SERIALIZER_VERSION,
  SERIALIZER_FORMAT,
} from './nodeGraphSerializer.js';
import type { NodeGraph, ModNode, ModEdge, NodeData, NodeKind, NodePort } from '@mc-creator/shared';
import { LATEST_FORMAT_VERSION } from '@mc-creator/shared';

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
    codeLocked: false,
    // P1-1：复刻 store 的 createDefaultNodeData，含 formatVersion（反序列化时 migrateGraph 会校验/补全）
    formatVersion: LATEST_FORMAT_VERSION,
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
    case 'variable':
      return {
        ...base,
        kind: 'variable',
        varName: 'var1',
        varType: 'int',
        value: 0,
        isConstant: false,
      } as NodeData;
    case 'subgraph':
      return {
        ...base,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: null,
        customFields: {},
      } as NodeData;
    case 'loop':
      return {
        ...base,
        kind: 'loop',
        loopType: 'for',
        init: 'int i = 0',
        condition: 'i < 10',
        update: 'i++',
        loopVarName: 'i',
        loopVarType: 'int',
      } as NodeData;
    case 'procedure':
      // P1-3：过程节点默认数据（测试辅助）
      return {
        ...base,
        kind: 'procedure',
        procedureName: 'myProcedure',
        displayName: '新过程',
      } as NodeData;
    default:
      throw new Error(`Unknown node kind: ${kind satisfies never}`);
  }
}

function createDefaultPorts(kind: NodeKind): NodePort[] {
  switch (kind) {
    case 'item':
      return [
        {
          id: 'out',
          label: '物品',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'block':
      return [
        {
          id: 'out',
          label: '方块',
          type: 'block_state',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'entity':
      return [
        {
          id: 'out',
          label: '实体',
          type: 'entity',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'recipe':
      return [
        {
          id: 'in',
          label: '材料',
          type: 'item_stack',
          direction: 'in',
          required: true,
          multiple: true,
        },
        {
          id: 'out',
          label: '产物',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'machine':
      return [
        {
          id: 'in_item',
          label: '输入物品',
          type: 'item_stack',
          direction: 'in',
          required: false,
          multiple: true,
        },
        {
          id: 'in_energy',
          label: '能源输入',
          type: 'energy',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'out_item',
          label: '输出物品',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'multiblock':
      return [
        {
          id: 'controller',
          label: '控制器',
          type: 'block_state',
          direction: 'in',
          required: true,
          multiple: false,
        },
        {
          id: 'out',
          label: '结构',
          type: 'block_state',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
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
    case 'comment':
      return [];
    default:
      return [];
  }
}

/** 构造测试用节点，覆盖默认 data 字段，可通过 overrides 覆盖 */
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

/** 构造测试用边 */
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
    kind: opts?.kind ?? 'craft',
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
    subgraphs: {},
  };
}

// === 测试用例 ===

describe('serializeGraph', () => {
  it('round-trip：序列化 → 反序列化 → 与原始 graph deep-equal', () => {
    const original = makeGraph(
      [
        makeNode('n1', 'item', { itemId: 'sword_iron', displayName: '铁剑' }),
        makeNode('n2', 'block', { blockId: 'ore_copper', displayName: '铜矿石' }),
      ],
      [makeEdge('e1', 'n1', 'n2', { sourceHandle: 'out' })],
      'my_mod',
    );

    const json = serializeGraph(original);
    const restored = deserializeGraph(json);

    // deep-equal 校验（含 nodes/edges/viewport/modId/version）
    expect(restored).toEqual(original);
  });

  it(`序列化结果包含 format: '${SERIALIZER_FORMAT}'`, () => {
    const graph = makeGraph([]);
    const json = serializeGraph(graph);
    const parsed = JSON.parse(json) as { format: string };
    expect(parsed.format).toBe(SERIALIZER_FORMAT);
  });

  it(`序列化结果包含当前 SERIALIZER_VERSION (${SERIALIZER_VERSION})`, () => {
    const graph = makeGraph([]);
    const json = serializeGraph(graph);
    const parsed = JSON.parse(json) as { version: number };
    expect(parsed.version).toBe(SERIALIZER_VERSION);
  });

  it('exportedAt 是合法 ISO 时间戳', () => {
    const graph = makeGraph([]);
    const json = serializeGraph(graph);
    const parsed = JSON.parse(json) as { exportedAt: string };

    // 必须是非空字符串
    expect(typeof parsed.exportedAt).toBe('string');
    expect(parsed.exportedAt.length).toBeGreaterThan(0);

    // 必须能被 Date 解析为有效时间
    const date = new Date(parsed.exportedAt);
    expect(Number.isNaN(date.getTime())).toBe(false);

    // 必须是 ISO 格式（包含 T 和时区标记）
    expect(parsed.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('序列化输出为格式化 JSON（2 空格缩进，便于 diff）', () => {
    const graph = makeGraph([]);
    const json = serializeGraph(graph);
    // 2 空格缩进应该出现在格式化输出中
    expect(json).toContain('\n  "format"');
    expect(json).toContain('\n  "version"');
  });
});

describe('deserializeGraph 抛错场景', () => {
  it('非法 JSON 字符串时抛错', () => {
    expect(() => deserializeGraph('{ not valid json')).toThrow(/JSON 解析错误/);
  });

  it('缺少 format 字段时抛错', () => {
    const json = JSON.stringify({ version: 1, graph: {} });
    expect(() => deserializeGraph(json)).toThrow(/缺少 format 字段/);
  });

  it('format 不匹配时抛错', () => {
    const json = JSON.stringify({
      format: 'some-other-format',
      version: 1,
      graph: {},
    });
    expect(() => deserializeGraph(json)).toThrow(/format 字段不匹配/);
  });

  it('缺少 version 字段时抛错', () => {
    const json = JSON.stringify({ format: SERIALIZER_FORMAT, graph: {} });
    expect(() => deserializeGraph(json)).toThrow(/缺少 version 字段/);
  });

  it('缺少 graph 字段时抛错', () => {
    const json = JSON.stringify({ format: SERIALIZER_FORMAT, version: 1 });
    expect(() => deserializeGraph(json)).toThrow(/缺少 graph 字段/);
  });

  it('version 高于当前版本时抛错（前向不兼容）', () => {
    const json = JSON.stringify({
      format: SERIALIZER_FORMAT,
      version: SERIALIZER_VERSION + 1,
      graph: {},
    });
    expect(() => deserializeGraph(json)).toThrow(/前向不兼容/);
  });

  it('version 非整数时抛错', () => {
    const json = JSON.stringify({
      format: SERIALIZER_FORMAT,
      version: '1',
      graph: {},
    });
    expect(() => deserializeGraph(json)).toThrow(/version 字段必须是整数/);
  });

  it('graph 字段非对象时抛错', () => {
    const json = JSON.stringify({
      format: SERIALIZER_FORMAT,
      version: 1,
      graph: [],
    });
    expect(() => deserializeGraph(json)).toThrow(/graph 字段必须是对象/);
  });
});

describe('safeDeserializeGraph', () => {
  it('合法 JSON 返回 { ok: true, graph }', () => {
    const original = makeGraph([makeNode('n1', 'item', { itemId: 'test_item' })]);
    const json = serializeGraph(original);
    const result = safeDeserializeGraph(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph).toEqual(original);
    }
  });

  it('非法 JSON 返回 { ok: false, error }', () => {
    const result = safeDeserializeGraph('not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/JSON 解析错误/);
    }
  });

  it('缺少 format 字段返回 { ok: false, error }', () => {
    const json = JSON.stringify({ version: 1, graph: {} });
    const result = safeDeserializeGraph(json);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/缺少 format 字段/);
    }
  });

  it('format 不匹配返回 { ok: false, error }', () => {
    const json = JSON.stringify({
      format: 'wrong-format',
      version: 1,
      graph: {},
    });
    const result = safeDeserializeGraph(json);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/format 字段不匹配/);
    }
  });

  it('缺少 version 字段返回 { ok: false, error }', () => {
    const json = JSON.stringify({ format: SERIALIZER_FORMAT, graph: {} });
    const result = safeDeserializeGraph(json);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/缺少 version 字段/);
    }
  });

  it('缺少 graph 字段返回 { ok: false, error }', () => {
    const json = JSON.stringify({ format: SERIALIZER_FORMAT, version: 1 });
    const result = safeDeserializeGraph(json);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/缺少 graph 字段/);
    }
  });
});

describe('validateGraph', () => {
  it('合法图返回空数组', () => {
    const graph = makeGraph(
      [
        makeNode('n1', 'item', { itemId: 'sword_iron' }),
        makeNode('n2', 'block', { blockId: 'ore_copper' }),
      ],
      [makeEdge('e1', 'n1', 'n2', { sourceHandle: 'out' })],
    );
    expect(validateGraph(graph)).toEqual([]);
  });

  it('检测节点 id 重复', () => {
    const graph = makeGraph([
      makeNode('dup', 'item', { itemId: 'a' }),
      makeNode('dup', 'item', { itemId: 'b' }),
    ]);
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.includes('节点 id 重复') && e.includes('dup'))).toBe(true);
  });

  it('检测边引用不存在的源节点', () => {
    const graph = makeGraph(
      [makeNode('n1', 'item', { itemId: 'a' })],
      [makeEdge('e1', 'ghost', 'n1')],
    );
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.includes('引用了不存在的源节点') && e.includes('ghost'))).toBe(
      true,
    );
  });

  it('检测边引用不存在的目标节点', () => {
    const graph = makeGraph(
      [makeNode('n1', 'item', { itemId: 'a' })],
      [makeEdge('e1', 'n1', 'ghost')],
    );
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.includes('引用了不存在的目标节点') && e.includes('ghost'))).toBe(
      true,
    );
  });

  it('检测节点 type 与 data.kind 不一致', () => {
    // 构造一个 type='item' 但 data.kind='block' 的非法节点
    const node = makeNode('n1', 'item');
    // 通过 as unknown 强制改写 data.kind，模拟数据损坏
    const corruptedNode: ModNode = {
      ...node,
      type: 'item',
      data: { ...node.data, kind: 'block' } as unknown as NodeData,
    };
    const graph = makeGraph([corruptedNode]);
    const errors = validateGraph(graph);
    expect(
      errors.some((e) => e.includes('type') && e.includes('data.kind') && e.includes('n1')),
    ).toBe(true);
  });

  it('检测 item 节点缺少必填字段 itemId', () => {
    const node = makeNode('n1', 'item');
    // 删除必填字段
    const data = { ...node.data } as Record<string, unknown>;
    delete data.itemId;
    const brokenNode: ModNode = { ...node, data: data as unknown as NodeData };
    const graph = makeGraph([brokenNode]);
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.includes('物品节点') && e.includes('itemId'))).toBe(true);
  });

  it('检测 block 节点缺少必填字段 blockId', () => {
    const node = makeNode('n1', 'block');
    const data = { ...node.data } as Record<string, unknown>;
    delete data.blockId;
    const brokenNode: ModNode = { ...node, data: data as unknown as NodeData };
    const graph = makeGraph([brokenNode]);
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.includes('方块节点') && e.includes('blockId'))).toBe(true);
  });

  it('comment 节点无必填字段校验通过', () => {
    const graph = makeGraph([makeNode('n1', 'comment')]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it('空图（无节点无边）通过校验', () => {
    const graph = makeGraph([]);
    expect(validateGraph(graph)).toEqual([]);
  });
});

describe('downloadGraphAsJson', () => {
  // 注意：jsdom 环境下 URL.createObjectURL / revokeObjectURL 默认未实现，
  // 需要先注入空函数，再通过 vi.spyOn 进行 mock。
  // 同时 jsdom 的 HTMLAnchorElement.click() 会异步触发导航（不支持的 blob: URL），
  // 在原型上 mock click 实现，避免测试输出噪音并便于断言调用。
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let bodyAppendSpy: ReturnType<typeof vi.spyOn>;
  let bodyRemoveSpy: ReturnType<typeof vi.spyOn>;
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;
  // 保存原始 URL 属性以便 afterEach 恢复
  let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    // 保存原始值（undefined 表示原本不存在）
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    // jsdom 未实现 createObjectURL/revokeObjectURL，先注入空函数占位
    if (!URL.createObjectURL) {
      URL.createObjectURL = () => 'blob:placeholder';
    }
    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = () => undefined;
    }

    // spy URL.createObjectURL 并 mock 返回值（便于断言）
    // 注意：vi.spyOn 的不同重载返回 MockInstance<具体签名>，
    // 与变量声明的宽泛 ReturnType<typeof vi.spyOn> 不直接兼容，需用 as unknown as 类型断言。
    createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url') as unknown as typeof createObjectURLSpy;
    // spy URL.revokeObjectURL（不 mock 实现，调用空函数即可）
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL') as unknown as typeof revokeObjectURLSpy;

    // spy document.createElement（保留 jsdom 原生实现，便于检查 <a> 元素属性）
    createElementSpy = vi.spyOn(document, 'createElement') as unknown as typeof createElementSpy;

    // spy document.body.appendChild / removeChild（保留原生实现，便于验证调用）
    bodyAppendSpy = vi.spyOn(document.body, 'appendChild') as unknown as typeof bodyAppendSpy;
    bodyRemoveSpy = vi.spyOn(document.body, 'removeChild') as unknown as typeof bodyRemoveSpy;

    // mock HTMLAnchorElement.prototype.click，避免 jsdom 异步导航副作用（blob URL 不支持导航）
    anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // 恢复 URL.createObjectURL / revokeObjectURL 原始状态
    if (originalCreateObjectURL === undefined) {
      delete (URL as Partial<typeof URL>).createObjectURL;
    } else {
      URL.createObjectURL = originalCreateObjectURL;
    }
    if (originalRevokeObjectURL === undefined) {
      delete (URL as Partial<typeof URL>).revokeObjectURL;
    } else {
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('调用 URL.createObjectURL 与 URL.revokeObjectURL', () => {
    const json = serializeGraph(makeGraph([]));
    downloadGraphAsJson(json, 'my_mod-node-graph.json');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    // revokeObjectURL 应在下载完成后调用一次，参数为 createObjectURL 返回的 URL
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('创建 <a> 元素并设置 href 与 download 属性', () => {
    const json = serializeGraph(makeGraph([]));
    downloadGraphAsJson(json, 'project-node-graph.json');

    expect(createElementSpy).toHaveBeenCalledWith('a');
    // 通过 createElementSpy.mock.results 获取返回的 <a> 元素
    const anchorEl = createElementSpy.mock.results[0].value as HTMLAnchorElement;
    // href 属性应被设置为 createObjectURL 返回的 blob URL
    expect(anchorEl.href).toBe('blob:mock-url');
    expect(anchorEl.download).toBe('project-node-graph.json');
  });

  it('触发 <a> 元素的 click 方法（通过原型 spy 验证）', () => {
    // beforeEach 中已在原型上 mock click，避免 jsdom 异步导航副作用
    const json = serializeGraph(makeGraph([]));
    downloadGraphAsJson(json, 'click-test.json');

    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
  });

  it('将 <a> 元素附加到 document.body 并在下载后移除', () => {
    const json = serializeGraph(makeGraph([]));
    downloadGraphAsJson(json, 'attach-test.json');

    // 应调用 appendChild 添加 <a>，再调用 removeChild 移除
    expect(bodyAppendSpy).toHaveBeenCalledTimes(1);
    expect(bodyRemoveSpy).toHaveBeenCalledTimes(1);

    // appendChild 和 removeChild 处理的应该是同一个 <a> 元素
    const appendedNode = bodyAppendSpy.mock.calls[0][0] as HTMLAnchorElement;
    const removedNode = bodyRemoveSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(appendedNode).toBe(removedNode);
    expect(appendedNode.tagName).toBe('A');
    expect(appendedNode.download).toBe('attach-test.json');
  });
});
