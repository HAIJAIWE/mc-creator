import { describe, it, expect, beforeEach } from 'vitest';
import { compileNodeGraph, preloadExternalMods } from './compileNodeGraph.js';
import { useNodeGraphStore } from '../store/node-graph-store.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type { ModNode } from '@mc-creator/shared';

/**
 * 阶段 C 端到端集成测试
 *
 * 验证 spec §11-14 的核心流程：
 * 1. 变量节点 → 编译 → customCode 含 Java 字段声明
 * 2. 封装子图 → 内联展开 → 编译 → 内部节点出现在 spec.items
 * 3. 循环节点 → 编译 → customCode 含 Java 循环代码
 * 4. 导入自定义节点 → 编译 → Mustache 渲染 codeTemplate
 * 5. 混合图：变量 + 物品 + 子图 + 循环 + 自定义节点共存编译
 * 6. 自定义节点 required 字段缺失 → 编译报 error
 * 7. 子图循环引用检测 → 编译加 warning
 */
describe('阶段 C 端到端集成', () => {
  beforeEach(() => {
    subgraphManager.clear();
    customNodeRegistry.clear();
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: { ...useNodeGraphStore.getState().graph, modId: 'integ_test' },
    });
    // 默认所有外部 mod 已安装（不触发 warning）：preload 空列表会把缓存设为空 Set，
    // 但测试中物品 id 均不含命名空间冒号，不会触发外部 mod 检测。
    preloadExternalMods([]);
  });

  it('流程 1：添加变量节点 → 编译 → customCode 含变量 snippet', () => {
    const store = useNodeGraphStore.getState();
    const varId = store.addNode('variable', { x: 0, y: 0 });
    // 修改变量名和值
    useNodeGraphStore.getState().updateNode(varId, {
      varName: 'MAX_SPEED',
      value: 100,
      isConstant: true,
    } as Partial<never>);
    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const snippet = result.spec.customCode.find((c) => c.snippetId === varId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('MAX_SPEED');
    expect(snippet!.code).toContain('100');
    expect(snippet!.code).toContain('static final');
  });

  it('流程 2：封装子图 → 内联展开 → 编译 → 内部 item 出现在 spec.items', () => {
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
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([id1, id2], '装备包');
    expect(sgNodeId).not.toBeNull();

    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    // 内联后两个 item 被编译到 spec.items
    expect(result.spec.items.some((i) => i.id === 'sword_1')).toBe(true);
    expect(result.spec.items.some((i) => i.id === 'shield_1')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('流程 3：添加循环节点 → 编译 → customCode 含 Java 循环', () => {
    const store = useNodeGraphStore.getState();
    const loopId = store.addNode('loop', { x: 0, y: 0 });
    useNodeGraphStore.getState().updateNode(loopId, {
      loopType: 'forEach',
      loopVarName: 'item',
      loopVarType: 'item',
      iterable: 'items',
    } as Partial<never>);
    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    const snippet = result.spec.customCode.find((c) => c.snippetId === loopId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('for (');
    expect(snippet!.code).toContain('ItemStack');
    expect(snippet!.code).toContain('item');
  });

  it('流程 4：导入自定义节点 → 编译 → Mustache 渲染 codeTemplate', () => {
    // 注册自定义节点 schema
    customNodeRegistry.register({
      typeId: 'integ:crafter',
      label: '集成合成台',
      description: '测试用',
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
    // 填写字段值
    useNodeGraphStore.getState().updateNode(nodeId, {
      customFields: { speed: 42, name: 'FastCrafter' },
    } as Partial<never>);

    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const snippet = result.spec.customCode.find((c) => c.snippetId === nodeId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('speed = 42');
    expect(snippet!.code).toContain('FastCrafter');
  });

  it('流程 5：混合图（变量 + 物品 + 子图 + 循环 + 自定义）共存编译', () => {
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
      label: '混合自定义',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'power', label: '力量', type: 'number', required: true }],
      codeTemplate: 'int power = {{field:power}};',
    });
    const customId = useNodeGraphStore.getState().addCustomNode('integ:mixed', { x: 300, y: 0 });
    useNodeGraphStore.getState().updateNode(customId, {
      customFields: { power: 999 },
    } as Partial<never>);

    // 5. 封装物品+循环为子图
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([itemId, loopId], '复合逻辑');
    expect(sgNodeId).not.toBeNull();

    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);

    // 变量编译到 customCode
    expect(result.spec.customCode.some((c) => c.snippetId === varId)).toBe(true);
    // 物品内联展开后编译到 items
    expect(result.spec.items.some((i) => i.id === 'gem_1')).toBe(true);
    // 循环内联展开后编译到 customCode
    expect(result.spec.customCode.some((c) => c.snippetId === loopId)).toBe(true);
    // 自定义节点编译到 customCode
    expect(
      result.spec.customCode.some((c) => c.snippetId === customId && c.code.includes('999')),
    ).toBe(true);
    // 无致命错误
    expect(result.errors).toHaveLength(0);
  });

  it('流程 6：自定义节点 required 字段缺失 → 编译报 error', () => {
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
    const result = compileNodeGraph(graph);
    expect(result.errors.some((e) => e.includes(nodeId) && e.includes('Required'))).toBe(true);
  });

  it('流程 7：子图循环引用检测 → 编译加 warning', () => {
    // 构造 sg_a 内部引用 sg_b，sg_b 内部引用 sg_a（循环）
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
    const result = compileNodeGraph(graph);
    expect(result.warnings.some((w) => w.includes('循环引用') || w.includes('cycle'))).toBe(true);
  });
});
