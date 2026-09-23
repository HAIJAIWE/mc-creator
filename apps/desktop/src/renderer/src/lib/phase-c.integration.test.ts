import { describe, it, expect, beforeEach } from 'vitest';
import { compileNodeGraph, preloadExternalMods } from './compileNodeGraph.js';
import { useNodeGraphStore } from '../store/node-graph-store.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type { ModNode } from '@mc-creator/shared';

/**
 * 阶段 C 端到端集成
 *
 * 对应 spec 11-14 核心编译流程：
 * 1. 添加变量节点 → 编译 → customCode 含变量 snippet
 * 2. 封装子图 → 内联展开 → 编译 → 内部 item 出现 spec.items
 * 3. 添加循环节点 → 编译 → customCode 含 Java 循环
 * 4. 导入自定义节点 → 编译 → Mustache 渲染 codeTemplate
 * 5. 混合图（变量 + 物品 + 循环 + 自定义）共存编译
 * 6. 自定义节点 required 字段缺失 → 编译 error
 * 7. 子图循环引用检测 → warning
 */
describe('阶段 C 端到端集成', () => {
  beforeEach(() => {
    subgraphManager.clear();
    customNodeRegistry.clear();
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: { ...useNodeGraphStore.getState().graph, modId: 'integ_test' },
    });
    // 默认预加载无外部 mod，避免外部依赖 warning 污染 preload 外部 mod 列表时写入了 Set
    // 避免物品 id 匹配到外部命名空间而误报
    preloadExternalMods([]);
  });

  it('流程 1：添加变量节点 → 编译 → customCode 含变量 snippet', async () => {
    const store = useNodeGraphStore.getState();
    const varId = store.addNode('variable', { x: 0, y: 0 });
    // 设置变量值
    useNodeGraphStore.getState().updateNode(varId, {
      varName: 'MAX_SPEED',
      value: 100,
      isConstant: true,
    } as Partial<never>);
    const graph = useNodeGraphStore.getState().graph;
    const result = await compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const snippet = result.spec.customCode.find((c) => c.snippetId === varId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('MAX_SPEED');
    expect(snippet!.code).toContain('100');
    expect(snippet!.code).toContain('static final');
  });

  it('流程 2：封装子图 → 内联展开 → 编译 → 内部 item 出现 spec.items', async () => {
    const store = useNodeGraphStore.getState();
    const id1 = store.addNode('item', { x: 0, y: 0 });
    useNodeGraphStore
      .getState()
      .updateNode(id1, { itemId: 'sword_1', displayName: '剑' } as Partial<never>);
    const id2 = store.addNode('item', { x: 100, y: 0 });
    useNodeGraphStore
      .getState()
      .updateNode(id2, { itemId: 'shield_1', displayName: '盾' } as Partial<never>);

    // 封装为子图
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([id1, id2], '子图测试');
    expect(sgNodeId).not.toBeNull();

    const graph = useNodeGraphStore.getState().graph;
    const result = await compileNodeGraph(graph);
    // 子图内部的 item 应被编译进 spec.items
    expect(result.spec.items.some((i) => i.id === 'sword_1')).toBe(true);
    expect(result.spec.items.some((i) => i.id === 'shield_1')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('流程 3：添加循环节点 → 编译 → customCode 含 Java 循环', async () => {
    const store = useNodeGraphStore.getState();
    const loopId = store.addNode('loop', { x: 0, y: 0 });
    useNodeGraphStore.getState().updateNode(loopId, {
      loopType: 'forEach',
      loopVarName: 'item',
      loopVarType: 'item',
      iterable: 'items',
    } as Partial<never>);
    const graph = useNodeGraphStore.getState().graph;
    const result = await compileNodeGraph(graph);
    const snippet = result.spec.customCode.find((c) => c.snippetId === loopId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('for (');
    expect(snippet!.code).toContain('ItemStack');
    expect(snippet!.code).toContain('item');
  });

  it('流程 4：导入自定义节点 → 编译 → Mustache 渲染 codeTemplate', async () => {
    // 注册自定义节点 schema
    customNodeRegistry.register({
      typeId: 'integ:crafter',
      label: '合成器',
      description: '自定义合成',
      icon: 'crafting-table',
      color: 'mc-custom',
      ports: [],
      fields: [
        { key: 'speed', label: '速度', type: 'number', required: true, min: 1, max: 100 },
        { key: 'name', label: '名称', type: 'text', required: false },
      ],
      codeTemplate:
        'public class Crafter { int speed = {{field:speed}}; String name = "{{field:name}}"; }',
    });

    // 通过 store 添加自定义节点
    const nodeId = useNodeGraphStore.getState().addCustomNode('integ:crafter', { x: 50, y: 50 });
    // 写入字段值
    useNodeGraphStore.getState().updateNode(nodeId, {
      customFields: { speed: 42, name: 'FastCrafter' },
    } as Partial<never>);

    const graph = useNodeGraphStore.getState().graph;
    const result = await compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const snippet = result.spec.customCode.find((c) => c.snippetId === nodeId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('speed = 42');
    expect(snippet!.code).toContain('FastCrafter');
  });

  it('流程 5：混合图（变量 + 物品 + 循环 + 自定义）共存编译', async () => {
    // 1. 变量节点
    const varId = useNodeGraphStore.getState().addNode('variable', { x: 0, y: 0 });
    useNodeGraphStore.getState().updateNode(varId, {
      varName: 'COUNT',
      varType: 'int',
      value: 5,
      isConstant: true,
    } as Partial<never>);

    // 2. 物品节点
    const itemId = useNodeGraphStore.getState().addNode('item', { x: 100, y: 0 });
    useNodeGraphStore
      .getState()
      .updateNode(itemId, { itemId: 'gem_1', displayName: '宝石' } as Partial<never>);

    // 3. 循环节点
    const loopId = useNodeGraphStore.getState().addNode('loop', { x: 200, y: 0 });
    useNodeGraphStore.getState().updateNode(loopId, {
      loopType: 'for',
      condition: 'i < COUNT',
      init: 'int i = 0',
      update: 'i++',
    } as Partial<never>);

    // 4. 自定义节点
    customNodeRegistry.register({
      typeId: 'integ:mixed',
      label: '混合测试',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'power', label: '功率', type: 'number', required: true }],
      codeTemplate: 'int power = {{field:power}};',
    });
    const customId = useNodeGraphStore.getState().addCustomNode('integ:mixed', { x: 300, y: 0 });
    useNodeGraphStore.getState().updateNode(customId, {
      customFields: { power: 999 },
    } as Partial<never>);

    // 5. 封装物品+循环为子图
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([itemId, loopId], '混合子图');
    expect(sgNodeId).not.toBeNull();

    const graph = useNodeGraphStore.getState().graph;
    const result = await compileNodeGraph(graph);

    // 变量应被编译进 customCode
    expect(result.spec.customCode.some((c) => c.snippetId === varId)).toBe(true);
    // 物品应被内联展开编译进 items
    expect(result.spec.items.some((i) => i.id === 'gem_1')).toBe(true);
    // 循环应编译进 customCode
    expect(result.spec.customCode.some((c) => c.snippetId === loopId)).toBe(true);
    // 自定义节点应编译进 customCode
    expect(
      result.spec.customCode.some((c) => c.snippetId === customId && c.code.includes('999')),
    ).toBe(true);
    // 无错误
    expect(result.errors).toHaveLength(0);
  });

  it('流程 6：自定义节点 required 字段缺失 → 编译 error', async () => {
    customNodeRegistry.register({
      typeId: 'integ:strict',
      label: '严格',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'Required', label: '必填', type: 'text', required: true }],
      codeTemplate: 'String x = "{{field:Required}}";',
    });
    const nodeId = useNodeGraphStore.getState().addCustomNode('integ:strict', { x: 0, y: 0 });
    // 不填 Required 字段（customFields 为空）
    const graph = useNodeGraphStore.getState().graph;
    const result = await compileNodeGraph(graph);
    expect(result.errors.some((e) => e.includes(nodeId) && e.includes('Required'))).toBe(true);
  });

  it('流程 7：子图循环引用检测 → warning', async () => {
    // 构造 sg_a 引用 sg_b，sg_b 引用 sg_a 的循环引用
    const nodeInA: ModNode = {
      id: 'node_in_a',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 'node_in_a',
        label: 'a',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_b',
        subgraphName: 'B',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      },
      ports: [],
      selected: false,
    };
    const nodeInB: ModNode = {
      id: 'node_in_b',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 'node_in_b',
        label: 'b',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_a',
        subgraphName: 'A',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      },
      ports: [],
      selected: false,
    };
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: {
        version: 1,
        modId: 'cycle_test',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [nodeInA],
        edges: [],
        subgraphs: {
          sg_a: { id: 'sg_a', name: 'A', nodes: [nodeInA], edges: [], portMappings: [] },
          sg_b: { id: 'sg_b', name: 'B', nodes: [nodeInB], edges: [], portMappings: [] },
        },
      },
    });
    const graph = useNodeGraphStore.getState().graph;
    const result = await compileNodeGraph(graph);
    expect(result.warnings.some((w) => w.includes('循环') || w.includes('cycle'))).toBe(true);
  });
});
