import { describe, it, expect } from 'vitest';
import { ModSpec, NodeGraph, type ModSpec as ModSpecType } from '@mc-creator/shared';
import { specToNodeGraph } from './specToNodeGraph.js';
import { compileNodeGraph } from './compileNodeGraph.js';
import { mergeCompiledSpec } from './mergeCompiledSpec.js';

/**
 * 双视图往返一致性测试（P0 数据安全）。
 *
 * 低代码画布与纯代码/表单是同一份 ModSpec 的两个视图：
 *   spec --specToNodeGraph--> NodeGraph --compileNodeGraph--> spec'
 *
 * 若 spec' 丢失了 spec 的内容且用户无感知，用户在画布点「编译并应用」就会静默丢数据。
 * 本文件用一个「差异清单」把这件事锁死：
 * - 任何【未登记】的差异 → 测试失败（新引入的内容丢失必须显式登记）
 * - 任何【已登记】的差异一旦消失 → 测试失败（提醒把该项从清单移除，保持清单真实）
 *
 * 清单里的每一项都是当前节点数据模型表达不了的字段（有损映射），
 * 修复某项后请同步更新 KNOWN_LOSSY。
 */

// === 差异提取工具 ===

/** 把嵌套对象/数组拍平成 path → 叶子值（数组用下标，长度记 path.length） */
function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = { [`${prefix}.length`]: value.length };
    value.forEach((v, i) => Object.assign(out, flatten(v, `${prefix}.${i}`)));
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
    return out;
  }
  return { [prefix]: value };
}

/** 返回 a 与 b 的全部叶子差异（path: a → b），按 path 排序 */
function diffLeaves(a: unknown, b: unknown): string[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const out: string[] = [];
  for (const k of keys) {
    if (fa[k] !== fb[k]) {
      out.push(`${k}: ${JSON.stringify(fa[k])} → ${JSON.stringify(fb[k])}`);
    }
  }
  return out.sort();
}

/** 取 "path: a → b" 里的 path */
function pathOf(diffLine: string): string {
  return diffLine.slice(0, diffLine.indexOf(': '));
}

/**
 * 已知有损项：节点数据模型无法表达的 spec 字段。
 * 每项 { path: 拍平路径前缀, reason: 为什么丢失 }。
 */
const KNOWN_LOSSY: Array<{ path: string; reason: string }> = [
  // 注：Mod 元信息（name/description/version/license/authors/credits/dependencies/website）
  // 与数据包类内容（lootTables/advancements/tags/functions/structures）曾在此登记为有损，
  // 现由 mergeCompiledSpec 在「编译并应用」时从原 spec 透传，故不再有损。
  // —— item：ItemNodeData 无这些字段 ——
  { path: 'items.0.fuelTick', reason: 'ItemNodeData 无燃料字段' },
  { path: 'items.0.lore', reason: 'ItemNodeData 无 lore 字段（编译时用 note 顶替）' },
  { path: 'items.0.attributes', reason: 'ItemNodeData 无属性修饰符字段' },
  { path: 'items.0.defaultEnchantments', reason: 'ItemNodeData 无默认附魔字段' },
  { path: 'items.0.creativeTab', reason: 'ItemNodeData 无创造标签页字段' },
  { path: 'items.0.food', reason: 'ItemNodeData 无食物字段' },
  // —— block：材质/音效为反推，其余字段画布无承载 ——
  { path: 'blocks.0.material', reason: 'BlockNodeData 无材质字段（由透明/固体反推）' },
  { path: 'blocks.0.soundType', reason: 'BlockNodeData 无音效字段（由透明性反推）' },
  { path: 'blocks.0.miningLevel', reason: 'BlockNodeData 无挖掘等级字段' },
  { path: 'blocks.0.dropSelf', reason: 'BlockNodeData 无掉落设置字段' },
  { path: 'blocks.0.dropItem', reason: 'BlockNodeData 无掉落物品字段' },
  { path: 'blocks.0.stateProperties', reason: 'BlockNodeData 无方块状态字段' },
  { path: 'blocks.0.collisionShapes', reason: 'BlockNodeData 无碰撞体积字段' },
  // —— recipe：输入数量/格子位在画布上只由连边表达 ——
  { path: 'recipes.0.inputs.0.count', reason: '画布 recipe 输入只存 item id，数量恒为 1' },
  { path: 'recipes.0.inputs.0.slot', reason: '画布 recipe 输入无 shaped 格子位字段' },
  // —— biome：颜色为画布未承载，category 为编译固定值 ——
  { path: 'biomes.0.grassColor', reason: 'BiomeNodeData 无草色字段' },
  { path: 'biomes.0.foliageColor', reason: 'BiomeNodeData 无树叶色字段' },
  { path: 'biomes.0.category', reason: '编译时固定 plains' },
  // —— dimension：多处编译时固定值 ——
  { path: 'dimensions.0.coordinateScale', reason: '编译时固定 1.0' },
  { path: 'dimensions.0.logicalHeight', reason: '编译时等于 height' },
  { path: 'dimensions.0.ambientLight', reason: '编译时固定 0' },
  { path: 'dimensions.0.piglinSafe', reason: '编译时固定 false' },
  { path: 'dimensions.0.bedWorks', reason: '编译时固定 true' },
  { path: 'dimensions.0.respawnAnchorWorks', reason: '编译时固定 false' },
  // —— procedure / event：调用参数绑定未还原为画布 data 边 ——
  {
    path: 'procedures.0.procedureCallArgs',
    reason: '参数绑定表达式未还原为 data 边（specToNodeGraph 已发 warning）',
  },
  {
    path: 'eventHandlers.0.procedureCallArgs',
    reason: '参数绑定表达式未还原为 data 边（specToNodeGraph 已发 warning）',
  },
];

/** diff 中不属于 KNOWN_LOSSY 的项（即未登记的内容丢失） */
function unexpectedLosses(diffs: string[]): string[] {
  return diffs.filter((d) => {
    const path = pathOf(d);
    return !KNOWN_LOSSY.some((k) => path === k.path || path.startsWith(`${k.path}.`));
  });
}

/** KNOWN_LOSSY 中在本次 diff 里没出现的项（清单过期 / 夹具取值未覆盖） */
function staleKnownLossy(diffs: string[]): string[] {
  return KNOWN_LOSSY.filter((k) => {
    const hit = diffs.some((d) => {
      const path = pathOf(d);
      return path === k.path || path.startsWith(`${k.path}.`);
    });
    return !hit;
  }).map((k) => k.path);
}

/**
 * 覆盖全部内容类型、且字段尽量取非默认值的 spec。
 * 注意：配方引用的物品（ruby_ingot）必须也在 spec.items 中，
 * 否则 specToNodeGraph 会造「引用型」item 节点，编译回来会凭空多出一个物品
 * （该已知缺陷由单独的用例覆盖，见文件末尾）。
 */
function richSpec(): ModSpecType {
  return ModSpec.parse({
    modId: 'round_trip',
    version: '2.3.4',
    name: '往返测试模组',
    description: '用于验证 spec ↔ 节点图往返不丢内容',
    license: 'Apache-2.0',
    authors: ['alice'],
    credits: '感谢测试',
    website: 'https://example.com',
    dependencies: [{ modId: 'fabric-api', version: '0.91.0', mandatory: true }],
    lootTables: [
      {
        id: 'round_trip:blocks/ruby_ore',
        type: 'block',
        pools: [
          { rolls: 1, entries: [{ item: 'round_trip:ruby', weight: 1, countMin: 1, countMax: 3 }] },
        ],
      },
    ],
    advancements: [
      {
        id: 'round_trip:root',
        display: { title: '起点', description: '获得红宝石', icon: 'round_trip:ruby' },
        criteria: [{ name: 'has_ruby', trigger: 'minecraft:inventory_changed' }],
      },
    ],
    tags: [{ id: 'round_trip:ruby', values: ['round_trip:ruby'], replace: false }],
    functions: [{ id: 'round_trip:hello', commands: ['say hi'] }],
    structures: [
      {
        structureId: 'ruby_house',
        displayName: '红宝石小屋',
        startPool: 'round_trip:house/start_pool',
        size: 7,
      },
    ],
    items: [
      {
        id: 'ruby',
        name: '红宝石',
        rarity: 'epic',
        maxStackSize: 16,
        maxDamage: 250,
        fuelTick: 400,
        lore: '闪闪发光',
        food: { hunger: 4, saturation: 0.6 },
        itemCategory: 'sword',
        creativeTab: 'combat',
        attributes: [{ attribute: 'generic.attack_damage', operation: 'add_value', value: 3 }],
        defaultEnchantments: [{ enchantmentId: 'minecraft:sharpness', level: 3 }],
        texturePath: 'textures/item/ruby.png',
      },
      { id: 'ruby_ingot', name: '红宝石锭' },
    ],
    blocks: [
      {
        id: 'ruby_ore',
        name: '红宝石矿石',
        material: 'metal',
        hardness: 3.5,
        resistance: 9,
        lightLevel: 4,
        miningLevel: 2,
        soundType: 'anvil',
        dropSelf: false,
        dropItem: 'round_trip:ruby',
        stateProperties: [{ name: 'facing', type: 'enum', values: ['north', 'south'] }],
        collisionShapes: [{ minX: 0, minY: 0, minZ: 0, maxX: 16, maxY: 8, maxZ: 16 }],
        blockType: 'full_block',
        transparent: false,
        noCollision: false,
        texturePath: 'textures/block/ruby_ore.png',
      },
    ],
    entities: [
      {
        entityId: 'ruby_golem',
        displayName: '红宝石傀儡',
        maxHealth: 40,
        attackDamage: 6,
        movementSpeed: 0.25,
        classification: 'monster',
        modelType: 'zombie',
        spawnWeight: 8,
        spawnBiomes: ['minecraft:plains'],
        texturePath: 'textures/entity/ruby_golem.png',
      },
    ],
    machines: [
      {
        machineId: 'ruby_forge',
        displayName: '红宝石熔炉',
        energyCapacity: 50000,
        maxEnergyTransfer: 500,
        inputSlots: 2,
        outputSlots: 1,
        defaultProcessTime: 120,
        defaultEnergyPerTick: 25,
        guiWidth: 200,
        guiHeight: 180,
        recipeMap: { ruby: 'ruby_ingot' },
      },
    ],
    recipes: [
      {
        recipeId: 'ruby_smelt',
        recipeType: 'smelting',
        inputs: [{ item: 'ruby', count: 2, slot: 'A' }],
        output: 'ruby_ingot',
        outputCount: 2,
        cookTime: 150,
        experience: 0.8,
      },
    ],
    fluids: [
      {
        fluidId: 'liquid_ruby',
        displayName: '液态红宝石',
        color: 0xff0044,
        temperature: 900,
        viscosity: 2000,
        density: 1500,
        luminous: true,
      },
    ],
    biomes: [
      {
        biomeId: 'ruby_biome',
        displayName: '红宝石群系',
        precipitation: 'snow',
        temperature: -0.5,
        temperatureModifier: 'frozen',
        downfall: 0.8,
        skyColor: 0x88aaff,
        waterColor: 0x2200ff,
        waterFogColor: 0x1100aa,
        fogColor: 0x99bbff,
        surfaceBuilder: 'stone',
        spawnWeight: 5,
        spawnDimensions: ['minecraft:overworld'],
        grassColor: 0x00ff00,
        foliageColor: 0x00aa00,
        category: 'taiga',
      },
    ],
    dimensions: [
      {
        dimensionId: 'ruby_dim',
        displayName: '红宝石维度',
        baseType: 'nether',
        fixedTime: 6000,
        hasSkyLight: false,
        hasCeiling: true,
        ultrawarm: true,
        natural: false,
        coordinateScale: 8,
        minY: 0,
        height: 128,
        ambientLight: 0.4,
        piglinSafe: true,
        bedWorks: false,
        respawnAnchorWorks: true,
        effects: 'the_nether',
      },
    ],
    guis: [
      {
        guiId: 'ruby_gui',
        displayName: '红宝石界面',
        width: 200,
        height: 190,
        slots: [{ slotId: 'slot_in', slotType: 'input', x: 10, y: 20 }],
        showEnergyBar: true,
        showProgressBar: true,
      },
    ],
    multiblocks: [
      {
        structureId: 'ruby_altar',
        displayName: '红宝石祭坛',
        width: 3,
        height: 3,
        depth: 3,
        hollow: false,
        controllerOffset: { x: 1, y: 1, z: 1 },
      },
    ],
    conditions: [
      {
        conditionId: 'cond_has_item',
        conditionType: 'has_item',
        args: { item: 'ruby' },
        invert: true,
      },
    ],
    actions: [{ actionId: 'act_give', actionType: 'give_item', args: { item: 'ruby', count: 3 } }],
    procedures: [
      {
        procedureId: 'proc_reward',
        procedureName: 'reward',
        displayName: '发奖',
        inputs: [{ name: 'amount', type: 'int' }],
        conditionIds: ['cond_has_item'],
        actionIds: ['act_give'],
        procedureCallIds: [],
        procedureCallArgs: { proc_reward: ['3'] },
      },
    ],
    eventHandlers: [
      {
        handlerId: 'evt_join',
        eventType: 'player_join',
        eventArgs: { message: '欢迎' },
        conditionIds: ['cond_has_item'],
        actionIds: ['act_give'],
        procedureCallIds: ['proc_reward'],
        procedureCallArgs: { proc_reward: ['3'] },
      },
    ],
    customCode: [
      {
        snippetId: 'snippet_tick',
        language: 'java',
        code: 'int x = 1;',
        inputSignature: { in: 'integer' },
        outputSignature: { out: 'integer' },
        methodName: 'tickHandler',
      },
    ],
  });
}

/**
 * 模拟真实「编译并应用」链路：
 * spec → 画布（specToNodeGraph）→ 编译（compileNodeGraph）→ 合并回原 spec（mergeCompiledSpec）
 */
async function applyRoundTrip(spec: ModSpecType) {
  const { graph, warnings } = specToNodeGraph(spec);
  const compiled = await compileNodeGraph(graph);
  return { graph, warnings, compiled, applied: mergeCompiledSpec(spec, compiled.spec) };
}

describe('spec ↔ 节点图 往返一致性', () => {
  it('spec → 画布 → 编译并应用：差异恰好等于已登记的有损项', async () => {
    const spec = richSpec();
    const { compiled, applied } = await applyRoundTrip(spec);
    expect(compiled.errors).toEqual([]);

    const diffs = diffLeaves(spec, applied);
    expect(unexpectedLosses(diffs)).toEqual([]);
  });

  it('KNOWN_LOSSY 清单无过期项（每项都真实发生）', async () => {
    const spec = richSpec();
    const { applied } = await applyRoundTrip(spec);

    const diffs = diffLeaves(spec, applied);
    expect(staleKnownLossy(diffs)).toEqual([]);
  });

  it('spec → 画布 → spec → 画布：第二次往返不再新增丢失（收敛）', async () => {
    const spec = richSpec();
    const first = specToNodeGraph(spec);
    const compiled = await compileNodeGraph(first.graph);

    const second = specToNodeGraph(compiled.spec);
    const recompiled = await compileNodeGraph(second.graph);

    // 第二次往返的节点/边规模与第一次一致 → 不会越用越少
    expect(second.graph.nodes.length).toBe(first.graph.nodes.length);
    expect(second.graph.edges.length).toBe(first.graph.edges.length);
    // 第二次往返相对第一次编译结果应完全无损（图已是规范形态）
    expect(diffLeaves(compiled.spec, recompiled.spec)).toEqual([]);
  });

  it('画布能表达 richSpec 覆盖的全部 15 种节点类型', () => {
    const { graph } = specToNodeGraph(richSpec());
    const kinds = new Set(graph.nodes.map((n) => n.data.kind));
    for (const kind of [
      'item',
      'block',
      'entity',
      'machine',
      'recipe',
      'fluid',
      'biome',
      'dimension',
      'gui',
      'multiblock',
      'condition',
      'action',
      'procedure',
      'event',
      'code',
    ] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
  });
});

describe('specToNodeGraph 有损告警', () => {
  it('无法上画布的内容会产出 warning（元信息 / 数据包内容 / 物品字段）', () => {
    const { warnings } = specToNodeGraph(richSpec());
    const joined = warnings.join('\n');
    // mod 元信息
    expect(joined).toContain('名称');
    // 数据包类内容
    expect(joined).toContain('战利品表');
    expect(joined).toContain('进度');
    expect(joined).toContain('标签');
    // 物品 / 方块上画布不承载的字段（按 id 列出）
    expect(joined).toMatch(/物品 [^\n]*ruby/);
    expect(joined).toMatch(/方块 [^\n]*ruby_ore/);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('WP3.1 缺陷修复', () => {
  it('配方引用的外部物品不再被编译成本 mod 的自定义物品', async () => {
    // spec 只声明 1 个物品，配方输出引用外部物品 minecraft:diamond
    const spec = ModSpec.parse({
      modId: 'phantom',
      name: '幽灵物品',
      items: [{ id: 'ruby', name: '红宝石' }],
      recipes: [{ recipeId: 'r1', inputs: [{ item: 'ruby' }], output: 'minecraft:diamond' }],
    });

    const { graph, warnings } = specToNodeGraph(spec);
    // 画布仍会为外部物品建"引用节点"并给出提示
    expect(warnings.some((w) => w.includes('minecraft:diamond'))).toBe(true);

    const compiled = await compileNodeGraph(graph);
    // 引用节点不产出物品，不会凭空多出 minecraft:diamond
    expect(compiled.spec.items.map((i) => i.id)).toEqual(['ruby']);
    // 但配方依然正确引用外部物品
    expect(compiled.spec.recipes[0].output).toBe('minecraft:diamond');
    expect(compiled.spec.recipes[0].inputs[0].item).toBe('ruby');
  });

  it('引用节点经序列化往返后仍被正确识别（schema 声明了 isReference）', () => {
    const spec = ModSpec.parse({
      modId: 'phantom',
      name: '幽灵物品',
      items: [{ id: 'ruby', name: '红宝石' }],
      recipes: [{ recipeId: 'r1', inputs: [{ item: 'ruby' }], output: 'minecraft:diamond' }],
    });
    const { graph } = specToNodeGraph(spec);

    // 模拟保存→重新加载：NodeGraph.parse 会剥离未在 schema 中声明的字段
    const roundTripped = NodeGraph.parse(JSON.parse(JSON.stringify(graph)));
    const refNodes = roundTripped.nodes.filter((n) => n.data.kind === 'item' && n.data.isReference);
    expect(refNodes).toHaveLength(1);
  });

  it('「编译并应用」保留模组元信息与数据包类内容', async () => {
    const spec = richSpec();
    const { applied } = await applyRoundTrip(spec);

    expect(applied.name).toBe('往返测试模组');
    expect(applied.description).toBe('用于验证 spec ↔ 节点图往返不丢内容');
    expect(applied.version).toBe('2.3.4');
    expect(applied.license).toBe('Apache-2.0');
    expect(applied.authors).toEqual(['alice']);
    expect(applied.credits).toBe('感谢测试');
    expect(applied.dependencies).toEqual(spec.dependencies);
    expect(applied.website).toBe('https://example.com');
    expect(applied.lootTables).toEqual(spec.lootTables);
    expect(applied.advancements).toEqual(spec.advancements);
    expect(applied.tags).toEqual(spec.tags);
    expect(applied.functions).toEqual(spec.functions);
    expect(applied.structures).toEqual(spec.structures);
  });

  it('画布上的编辑仍然生效（画布拥有字段以编译结果为准）', async () => {
    const spec = richSpec();
    const { graph } = specToNodeGraph(spec);
    // 模拟用户在画布上删除了实体节点
    const trimmed = {
      ...graph,
      nodes: graph.nodes.filter((n) => n.data.kind !== 'entity'),
    };

    const compiled = await compileNodeGraph(trimmed);
    const applied = mergeCompiledSpec(spec, compiled.spec);

    expect(applied.entities).toEqual([]); // 删除生效
    expect(applied.name).toBe('往返测试模组'); // 元信息仍保留
  });
});
