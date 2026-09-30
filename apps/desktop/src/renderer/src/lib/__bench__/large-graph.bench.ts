/**
 * 大图性能基线测试
 *
 * 生成 500/1000 节点的随机连线图，测量 compileNodeGraph + FabricAdapter.translate 耗时
 * 运行方式：在 desktop 包下执行 `pnpm vitest run --reporter=verbose src/renderer/src/lib/__bench__/large-graph.bench.ts`
 * 或直接用 tsx 运行：`pnpm tsx src/renderer/src/lib/__bench__/large-graph.bench.ts`
 */

import { compileNodeGraph } from '../compileNodeGraph.js';
import { FabricAdapter } from '@mc-creator/core/generators/mod/fabric-adapter.js';
import type { NodeGraph, ModNode, ModEdge, NodeKind, NodeData, EdgeKind } from '@mc-creator/shared';

// ===== 工具函数：生成随机图 =====

const NODE_KINDS: NodeKind[] = [
  'item',
  'block',
  'entity',
  'recipe',
  'machine',
  'multiblock',
  'event',
  'condition',
  'action',
  'code',
  'variable',
  'biome',
  'dimension',
  'fluid',
  'gui',
];

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function randomPosition(): { x: number; y: number } {
  return { x: Math.random() * 5000, y: Math.random() * 5000 };
}

function createNodeData(kind: NodeKind): NodeData {
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
    codeLocked: false,
    lockedCode: undefined,
    formatVersion: 1,
  };

  switch (kind) {
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: randomId('item'),
        displayName: 'Item',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      };
    case 'block':
      return {
        ...base,
        kind: 'block',
        blockId: randomId('block'),
        displayName: 'Block',
        hardness: 1.0,
        blastResistance: 3.0,
        luminance: 0,
        transparent: false,
        solid: true,
        modelType: 'cube_all',
        isBlockEntity: false,
      };
    case 'entity':
      return {
        ...base,
        kind: 'entity',
        entityId: randomId('entity'),
        displayName: 'Entity',
        maxHealth: 20,
        attackDamage: 0,
        movementSpeed: 0.3,
        classification: 'misc',
        modelType: 'pig',
        spawnWeight: 0,
        spawnBiomes: [],
      };
    case 'recipe':
      return {
        ...base,
        kind: 'recipe',
        recipeId: randomId('recipe'),
        recipeType: 'crafting_shaped',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
        template: 'minecraft:netherite_upgrade_smithing_template',
        base: '',
        addition: '',
        inputPotion: 'minecraft:water',
        ingredientItem: '',
        outputPotion: '',
      };
    case 'machine':
      return {
        ...base,
        kind: 'machine',
        machineId: randomId('machine'),
        displayName: 'Machine',
        energyCapacity: 10000,
        maxEnergyTransfer: 100,
        inputSlots: 1,
        outputSlots: 1,
        defaultProcessTime: 200,
        defaultEnergyPerTick: 10,
        guiWidth: 176,
        guiHeight: 166,
        recipeMapJson: '{}',
      };
    case 'multiblock':
      return {
        ...base,
        kind: 'multiblock',
        structureId: randomId('mb'),
        displayName: 'Multiblock',
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        controllerOffset: { x: 1, y: 1, z: 0 },
      };
    case 'event':
      return { ...base, kind: 'event', eventType: 'tick', eventArgs: '{}' };
    case 'condition':
      return {
        ...base,
        kind: 'condition',
        conditionType: 'has_item',
        conditionArgs: '{}',
        customCode: '',
        invert: false,
      };
    case 'action':
      return { ...base, kind: 'action', actionType: 'give_item', actionArgs: '{}', customCode: '' };
    case 'code':
      return {
        ...base,
        kind: 'code',
        language: 'java',
        code: '// benchmark code',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'process',
      };
    case 'variable':
      return {
        ...base,
        kind: 'variable',
        varName: `var_${Math.random().toString(36).slice(2, 6)}`,
        varType: 'int',
        value: 0,
        isConstant: false,
      };
    case 'biome':
      return {
        ...base,
        kind: 'biome',
        biomeId: randomId('biome'),
        displayName: 'Biome',
        precipitation: 'rain',
        temperature: 0.5,
        temperatureModifier: 'none',
        downfall: 0.5,
        skyColor: 0x78a7ff,
        waterColor: 0x3f76e4,
        waterFogColor: 0x050533,
        fogColor: 0xc0d8ff,
        surfaceBuilder: 'minecraft:grass',
        spawnWeight: 10,
        spawnDimensions: ['minecraft:overworld'],
      };
    case 'dimension':
      return {
        ...base,
        kind: 'dimension',
        dimensionId: randomId('dim'),
        displayName: 'Dimension',
        baseType: 'overworld',
        fixedTime: null,
        hasSkyLight: true,
        hasCeiling: false,
        ultrawarm: false,
        natural: true,
        minY: -64,
        height: 384,
        effects: 'overworld',
      };
    case 'fluid':
      return {
        ...base,
        kind: 'fluid',
        fluidId: randomId('fluid'),
        displayName: 'Fluid',
        color: 0x00aaff,
        temperature: 300,
        viscosity: 1000,
        density: 1000,
        luminous: false,
      };
    case 'gui':
      return {
        ...base,
        kind: 'gui',
        guiId: randomId('gui'),
        displayName: 'GUI',
        width: 176,
        height: 166,
        slotsJson: '[]',
        showEnergyBar: false,
        showProgressBar: false,
      };
    default:
      return {
        ...base,
        kind: 'item',
        itemId: randomId('item'),
        displayName: 'Item',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      };
  }
}

function generateGraph(nodeCount: number, edgeFactor: number = 1.5): NodeGraph {
  const nodes: ModNode[] = [];
  const edges: ModEdge[] = [];
  const nodeIds: string[] = [];

  // 生成节点
  for (let i = 0; i < nodeCount; i++) {
    const kind = NODE_KINDS[Math.floor(Math.random() * NODE_KINDS.length)];
    const id = randomId(kind);
    nodeIds.push(id);

    const data = createNodeData(kind);
    data.nodeId = id;
    data.label = `${kind}_${i}`;

    nodes.push({
      id,
      type: kind,
      position: randomPosition(),
      data,
      ports: [],
      selected: false,
    });
  }

  // 生成随机连线（边数约为 nodeCount * edgeFactor）
  const edgeCount = Math.floor(nodeCount * edgeFactor);
  const edgeKinds: EdgeKind[] = ['craft', 'structure', 'flow', 'control', 'depends', 'data'];

  for (let i = 0; i < edgeCount; i++) {
    const sourceIdx = Math.floor(Math.random() * nodeCount);
    let targetIdx = Math.floor(Math.random() * nodeCount);

    // 避免自环
    while (targetIdx === sourceIdx && nodeCount > 1) {
      targetIdx = Math.floor(Math.random() * nodeCount);
    }

    const source = nodeIds[sourceIdx];
    const target = nodeIds[targetIdx];
    const kind = edgeKinds[Math.floor(Math.random() * edgeKinds.length)];

    edges.push({
      id: randomId('edge'),
      source,
      target,
      sourceHandle: undefined,
      targetHandle: undefined,
      kind,
      label: undefined,
      disabled: false,
    });
  }

  return {
    version: 1,
    modId: 'benchmark_mod',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };
}

// ===== 基准测试主函数 =====

async function runBench() {
  const sizes = [500, 1000];
  const results: Array<{
    nodes: number;
    compileMs: number;
    translateMs: number;
    totalMs: number;
    fileCount: number;
  }> = [];

  console.log('=== 大图性能基线测试 ===\n');
  console.log(`Node.js ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB used\n`);

  for (const nodeCount of sizes) {
    console.log(`\n--- 测试 ${nodeCount} 节点图 ---`);

    // 生成图（不计入计时）
    const graph = generateGraph(nodeCount);
    console.log(`节点: ${graph.nodes.length}, 连线: ${graph.edges.length}`);

    // 预热（首次运行包含 JIT 编译、模块初始化等）
    console.log('预热中...');
    await compileNodeGraph(graph);
    new FabricAdapter().translate({
      modId: 'bench',
      loader: 'fabric',
      mcVersion: '1.20.1',
      projectPath: '/tmp/bench',
      spec: {
        modId: 'bench',
        version: '1.0.0',
        name: 'Bench',
        description: '',
        items: [],
        blocks: [],
        recipes: [],
        entities: [],
        machines: [],
        multiblocks: [],
        biomes: [],
        dimensions: [],
        fluids: [],
        guis: [],
        structures: [],
        customCode: [],
        eventHandlers: [],
        conditions: [],
        actions: [],
        procedures: [],
        license: 'MIT',
        authors: [],
        credits: '',
        dependencies: [],
        website: '',
        lootTables: [],
        advancements: [],
        tags: [],
        functions: [],
      },
    });

    // 正式测量：compileNodeGraph
    const compileStart = performance.now();
    const compileResult = await compileNodeGraph(graph);
    const compileEnd = performance.now();
    const compileMs = compileEnd - compileStart;

    console.log(`compileNodeGraph: ${compileMs.toFixed(2)} ms`);
    console.log(
      `  - 节点: ${compileResult.spec.items.length + compileResult.spec.blocks.length + compileResult.spec.entities.length + compileResult.spec.recipes.length + compileResult.spec.machines.length + compileResult.spec.multiblocks.length + compileResult.spec.biomes.length + compileResult.spec.dimensions.length + compileResult.spec.fluids.length + compileResult.spec.guis.length + compileResult.spec.customCode.length + compileResult.spec.eventHandlers.length + compileResult.spec.conditions.length + compileResult.spec.actions.length + compileResult.spec.procedures.length} 个编译产出`,
    );
    console.log(
      `  - Warnings: ${compileResult.warnings.length}, Errors: ${compileResult.errors.length}`,
    );

    // 正式测量：FabricAdapter.translate
    const translateStart = performance.now();
    const files = new FabricAdapter().translate({
      modId: 'benchmark_mod',
      loader: 'fabric',
      mcVersion: '1.20.1',
      projectPath: '/tmp/benchmark_mod',
      spec: compileResult.spec,
    });
    const translateEnd = performance.now();
    const translateMs = translateEnd - translateStart;

    console.log(`FabricAdapter.translate: ${translateMs.toFixed(2)} ms`);
    console.log(`  - 生成文件: ${files.length} 个`);

    const totalMs = compileMs + translateMs;
    console.log(`总计: ${totalMs.toFixed(2)} ms`);

    results.push({
      nodes: nodeCount,
      compileMs: Math.round(compileMs * 100) / 100,
      translateMs: Math.round(translateMs * 100) / 100,
      totalMs: Math.round(totalMs * 100) / 100,
      fileCount: files.length,
    });

    // 内存快照
    const mem = process.memoryUsage();
    console.log(
      `内存: heapUsed=${Math.round(mem.heapUsed / 1024 / 1024)} MB, heapTotal=${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
    );
  }

  // 打印汇总表格
  console.log('\n=== 汇总 ===');
  console.table(
    results.map((r) => ({
      节点数: r.nodes,
      '编译 (ms)': r.compileMs,
      '翻译 (ms)': r.translateMs,
      '总计 (ms)': r.totalMs,
      生成文件数: r.fileCount,
    })),
  );

  // 输出 JSON 供 CI 归档
  console.log('\n=== JSON 输出 ===');
  console.log(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        results,
      },
      null,
      2,
    ),
  );
}

// 运行
runBench().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
