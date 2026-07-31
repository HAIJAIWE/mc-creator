import { describe, it, expect } from 'vitest';
import {
  // spec-compliant 接口
  demoteJavaToNodeGraphSimple,
  extractModId,
  extractItems,
  extractBlocks,
  extractCodeNodes,
  extractRecipes,
  layoutNodes,
  // 已有接口（同级 Agent 创建，保持覆盖）
  demoteJavaToNodeGraph,
} from './demoteFromPurecode.js';
import { promoteMultipleCodeNodes, type CodeNodeDataForPromotion } from './promoteToPurecode.js';
import type { FileNode, ModNode, NodeGraph } from '@mc-creator/shared';

// === 测试辅助函数 ===

/** 构造一个 FileNode */
function makeFile(path: string, content: string): FileNode {
  return { path, content };
}

/** 取出指定 kind 的所有节点（返回完整 ModNode[]，便于访问 position/data 等字段） */
function nodesOfKind(graph: NodeGraph, kind: string): ModNode[] {
  return graph.nodes.filter((n) => n.data.kind === kind);
}

// === Java 源码样例（贴近 promoteToPurecode.ts 生成的真实风格） ===

const MOD_MAIN_JAVA = `package com.example.demo_mod;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class DemoModMod implements ModInitializer {
    public static final String MOD_ID = "demo_mod";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ModCustomCode.initialize();
        LOGGER.info("Initializing demo_mod (promoted from L2 code node)");
    }
}
`;

const MOD_ITEMS_JAVA = `package com.example.demo_mod;

import net.minecraft.item.Item;
import net.minecraft.util.Rarity;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModItems {
    public static final Item RUBY_SWORD = register(
        "ruby_sword",
        new Item(new Item.Settings().rarity(Rarity.RARE))
    );

    public static final Item RUBY_INGOT = register(
        "ruby_ingot",
        new Item(new Item.Settings())
    );

    private static Item register(String name, Item item) {
        return Registry.register(
            Registries.ITEM,
            Identifier.of(ModMain.MOD_ID, name),
            item
        );
    }

    public static void initialize() {
    }
}
`;

const MOD_BLOCKS_JAVA = `package com.example.demo_mod;

import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;

public class ModBlocks {
    public static final Block RUBY_ORE = register(
        "ruby_ore",
        new Block(AbstractBlock.Settings.copy(Blocks.IRON_BLOCK).strength(3.0f, 6.0f).luminance(8))
    );

    private static Block register(String name, Block block) {
        return Registry.register(Registries.BLOCK, Identifier.of(ModMain.MOD_ID, name), block);
    }
}
`;

const MOD_CUSTOM_CODE_JAVA = `package com.example.demo_mod;

public class ModCustomCode {
    public static final String MOD_ID = "demo_mod";

    // === 从节点图 Code 节点提升生成 ===
    // nodeId: code_process
    // label: 处理逻辑
    // note: 示例代码节点
    // language: java
    // inputSignature:  {}
    // outputSignature: {}
    public static void process() {
        System.out.println("hello world");
    }

    // === 从节点图 Code 节点提升生成 ===
    // nodeId: code_compute
    // label: 计算逻辑
    // note: 返回 42
    // language: java
    // inputSignature:  {}
    // outputSignature: {}
    public static int compute() {
        return 42;
    }

    public static void initialize() {
        // 自定义代码片段已加载（共 2 个方法）
    }
}
`;

const UNKNOWN_JAVA = `package com.example.demo_mod;

import net.minecraft.util.math.BlockPos;

public class BlockPosHelper {
    public static BlockPos offset(BlockPos pos, int dx, int dy, int dz) {
        return pos.add(dx, dy, dz);
    }
}
`;

const FABRIC_MOD_JSON = `{
  "schemaVersion": 1,
  "id": "demo_mod",
  "version": "1.0.0",
  "name": "Demo Mod",
  "entrypoints": {
    "main": ["com.example.demo_mod.DemoModMod"]
  }
}
`;

const BUILD_GRADLE = `plugins {
    id 'fabric-loom' version '1.7-SNAPSHOT'
    id 'java'
}
`;

const RECIPE_RUBY_SWORD_JSON = `{
  "type": "minecraft:crafting_shaped",
  "pattern": [
    "R",
    "S"
  ],
  "key": {
    "R": {"item": "demo_mod:ruby_ingot"},
    "S": {"item": "minecraft:stick"}
  },
  "result": {
    "item": "demo_mod:ruby_sword",
    "count": 1
  }
}
`;

const RECIPE_INVALID_JSON = `{not valid json`;

const _RECIPE_NOT_RECIPE_JSON = `{
  "type": "minecraft:mob_spawner",
  "spawnType": "zombie"
}
`;

// ============================================================================
// === extractModId 测试 ===
// ============================================================================

describe('extractModId', () => {
  it('1. 从 ModMain.java 提取 MOD_ID（最高优先级）', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/DemoModMod.java', MOD_MAIN_JAVA),
      makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON),
    ];
    expect(extractModId(files)).toBe('demo_mod');
  });

  it('2. 无 Java 文件时回退到 fabric.mod.json', () => {
    const files = [makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON)];
    expect(extractModId(files)).toBe('demo_mod');
  });

  it('3. 既无 Java MOD_ID 也无 fabric.mod.json 时回退到 untitled', () => {
    const files = [makeFile('build.gradle', BUILD_GRADLE)];
    expect(extractModId(files)).toBe('untitled');
  });

  it('4. 空文件列表回退到 untitled', () => {
    expect(extractModId([])).toBe('untitled');
  });

  it('5. Java 文件中无 MOD_ID 模式时回退到 fabric.mod.json', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/BlockPosHelper.java', UNKNOWN_JAVA),
      makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON),
    ];
    expect(extractModId(files)).toBe('demo_mod');
  });
});

// ============================================================================
// === extractItems 测试 ===
// ============================================================================

describe('extractItems', () => {
  it('6. 正常提取多个 item 注册（含稀有度）', () => {
    const items = extractItems(MOD_ITEMS_JAVA);
    expect(items).toHaveLength(2);
    const ids = items.map((i) => i.itemId).sort();
    expect(ids).toEqual(['ruby_ingot', 'ruby_sword']);
    const sword = items.find((i) => i.itemId === 'ruby_sword');
    expect(sword?.rarity).toBe('rare');
    const ingot = items.find((i) => i.itemId === 'ruby_ingot');
    expect(ingot?.rarity).toBe('common');
  });

  it('7. 无 item 注册时返回空数组', () => {
    expect(extractItems(MOD_BLOCKS_JAVA)).toEqual([]);
    expect(extractItems('')).toEqual([]);
  });

  it('8. 边界：register 调用中带额外空格仍能匹配', () => {
    const content = `register(  "test_item"  ,  new  Item(new Item.Settings()))`;
    const items = extractItems(content);
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('test_item');
  });

  it('9. 错误：非 Java 文本不产生匹配', () => {
    expect(extractItems(BUILD_GRADLE)).toEqual([]);
    expect(extractItems(FABRIC_MOD_JSON)).toEqual([]);
  });
});

// ============================================================================
// === extractBlocks 测试 ===
// ============================================================================

describe('extractBlocks', () => {
  it('10. 正常提取 block 注册（含 hardness + luminance）', () => {
    const blocks = extractBlocks(MOD_BLOCKS_JAVA);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockId).toBe('ruby_ore');
    expect(blocks[0].hardness).toBeCloseTo(3.0, 5);
    expect(blocks[0].luminance).toBe(8);
  });

  it('11. 无 block 注册时返回空数组', () => {
    expect(extractBlocks(MOD_ITEMS_JAVA)).toEqual([]);
    expect(extractBlocks('')).toEqual([]);
  });

  it('12. 边界：仅有 .hardness() 无 .strength() 时仍能提取硬度', () => {
    const content = `register("test_block", new Block(Settings.copy(Blocks.STONE).hardness(2.5f).luminance(4)))`;
    const blocks = extractBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hardness).toBeCloseTo(2.5, 5);
    expect(blocks[0].luminance).toBe(4);
  });
});

// ============================================================================
// === extractCodeNodes 测试（L2→L3→L2 往返等价关键） ===
// ============================================================================

describe('extractCodeNodes', () => {
  it('13. 正常提取多个代码节点（nodeId + methodName + code 完整还原）', () => {
    const nodes = extractCodeNodes(MOD_CUSTOM_CODE_JAVA);
    expect(nodes).toHaveLength(2);

    const process = nodes.find((n) => n.nodeId === 'code_process');
    expect(process).toBeDefined();
    expect(process!.methodName).toBe('process');
    expect(process!.label).toBe('处理逻辑');
    expect(process!.note).toBe('示例代码节点');
    expect(process!.language).toBe('java');
    expect(process!.code).toBe('System.out.println("hello world");');

    const compute = nodes.find((n) => n.nodeId === 'code_compute');
    expect(compute).toBeDefined();
    expect(compute!.methodName).toBe('compute');
    expect(compute!.code).toBe('return 42;');
  });

  it('14. 无提升标记的 Java 文件返回空数组', () => {
    expect(extractCodeNodes(MOD_ITEMS_JAVA)).toEqual([]);
    expect(extractCodeNodes(MOD_MAIN_JAVA)).toEqual([]);
    expect(extractCodeNodes('')).toEqual([]);
  });

  it('15. 边界：单个代码节点（无 initialize 方法干扰）', () => {
    const content = `package com.example.test;
public class ModCustomCode {
    public static final String MOD_ID = "test";

    // === 从节点图 Code 节点提升生成 ===
    // nodeId: code_solo
    // label: 独立节点
    // note: 单独测试
    // language: java
    // inputSignature:  {}
    // outputSignature: {}
    public static void run() {
        int x = 1;
    }
}`;
    const nodes = extractCodeNodes(content);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].nodeId).toBe('code_solo');
    expect(nodes[0].methodName).toBe('run');
    expect(nodes[0].code).toBe('int x = 1;');
  });

  it('16. 错误：注释格式残缺时仍尝试提取（容错）', () => {
    // 缺少 note 和 language 注释，但仍有 nodeId 和方法定义
    const content = `public class Test {
    // === 从节点图 Code 节点提升生成 ===
    // nodeId: code_partial
    public static void go() {
        doSomething();
    }
}`;
    const nodes = extractCodeNodes(content);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].nodeId).toBe('code_partial');
    expect(nodes[0].methodName).toBe('go');
    // 缺省字段
    expect(nodes[0].language).toBe('java');
    expect(nodes[0].inputSignature).toBe('{}');
    expect(nodes[0].outputSignature).toBe('{}');
  });

  it('17. 边界：多行代码体正确还原缩进', () => {
    const content = `public class Test {
    // === 从节点图 Code 节点提升生成 ===
    // nodeId: code_multi
    // label: 多行
    // note:
    // language: java
    // inputSignature:  {}
    // outputSignature: {}
    public static void multi() {
        if (true) {
            System.out.println("yes");
        } else {
            System.out.println("no");
        }
    }
}`;
    const nodes = extractCodeNodes(content);
    expect(nodes).toHaveLength(1);
    // 多行代码应正确还原（去掉 8 空格缩进后）
    expect(nodes[0].code).toContain('if (true) {');
    expect(nodes[0].code).toContain('System.out.println("yes");');
    expect(nodes[0].code).toContain('} else {');
    expect(nodes[0].code).toContain('System.out.println("no");');
    expect(nodes[0].code).toContain('}');
  });
});

// ============================================================================
// === extractRecipes 测试 ===
// ============================================================================

describe('extractRecipes', () => {
  it('18. 正常提取 shaped 配方（type + result + pattern）', () => {
    const file = makeFile(
      'src/main/resources/data/demo_mod/recipe/ruby_sword.json',
      RECIPE_RUBY_SWORD_JSON,
    );
    const recipe = extractRecipes(file);
    expect(recipe).not.toBeNull();
    expect(recipe!.recipeId).toBe('ruby_sword');
    expect(recipe!.recipeType).toBe('crafting_shaped');
    expect(recipe!.pattern).toEqual(['R', 'S']);
    expect(recipe!.outputItem).toBe('ruby_sword');
    expect(recipe!.outputCount).toBe(1);
    expect(recipe!.inputItems).toContain('ruby_ingot');
    expect(recipe!.inputItems).toContain('stick');
  });

  it('19. 非 recipe 路径的 JSON 文件返回 null', () => {
    const file = makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON);
    expect(extractRecipes(file)).toBeNull();
  });

  it('20. 非 JSON 文件返回 null', () => {
    const file = makeFile('src/main/java/ModItems.java', MOD_ITEMS_JAVA);
    expect(extractRecipes(file)).toBeNull();
  });

  it('21. 非法 JSON 返回 null', () => {
    const file = makeFile(
      'src/main/resources/data/demo_mod/recipe/broken.json',
      RECIPE_INVALID_JSON,
    );
    expect(extractRecipes(file)).toBeNull();
  });

  it('22. 边界：剥离命名空间前缀（minecraft:xxx → xxx）', () => {
    const file = makeFile(
      'src/main/resources/data/demo_mod/recipe/test.json',
      `{
  "type": "minecraft:crafting_shapeless",
  "ingredients": [{"item": "minecraft:iron_ingot"}],
  "result": {"item": "minecraft:iron_nugget", "count": 4}
}`,
    );
    const recipe = extractRecipes(file);
    expect(recipe).not.toBeNull();
    expect(recipe!.recipeType).toBe('crafting_shapeless');
    expect(recipe!.outputItem).toBe('iron_nugget');
    expect(recipe!.outputCount).toBe(4);
    expect(recipe!.inputItems).toEqual(['iron_ingot']);
  });

  it('23. 边界：缺少 result 字段时 outputItem 为空字符串', () => {
    const file = makeFile(
      'src/main/resources/data/demo_mod/recipe/no_result.json',
      `{"type": "minecraft:crafting_shaped", "pattern": ["X"], "key": {"X": {"item": "minecraft:stone"}}}`,
    );
    const recipe = extractRecipes(file);
    expect(recipe).not.toBeNull();
    expect(recipe!.outputItem).toBe('');
    expect(recipe!.outputCount).toBe(1);
  });
});

// ============================================================================
// === layoutNodes 测试 ===
// ============================================================================

describe('layoutNodes', () => {
  it('24. 网格布局：前 5 个节点在一行（x+=260, y=0），第 6 个换行（y+=180）', () => {
    // 构造 7 个虚拟节点
    const nodes = Array.from({ length: 7 }, (_, i) => ({
      id: `n${i}`,
      type: 'item' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'item', nodeId: `n${i}` } as never,
      ports: [],
      selected: false,
    }));
    const positions = layoutNodes(nodes);
    expect(positions).toHaveLength(7);
    // 前 5 个在 y=0
    expect(positions[0]).toEqual({ x: 0, y: 0 });
    expect(positions[1]).toEqual({ x: 260, y: 0 });
    expect(positions[2]).toEqual({ x: 520, y: 0 });
    expect(positions[3]).toEqual({ x: 780, y: 0 });
    expect(positions[4]).toEqual({ x: 1040, y: 0 });
    // 第 6、7 个在 y=180
    expect(positions[5]).toEqual({ x: 0, y: 180 });
    expect(positions[6]).toEqual({ x: 260, y: 180 });
  });

  it('25. 空节点列表返回空数组', () => {
    expect(layoutNodes([])).toEqual([]);
  });

  it('26. 单个节点位于原点 (0, 0)', () => {
    const nodes = [
      {
        id: 'solo',
        type: 'item' as const,
        position: { x: 0, y: 0 },
        data: { kind: 'item', nodeId: 'solo' } as never,
        ports: [],
        selected: false,
      },
    ];
    expect(layoutNodes(nodes)).toEqual([{ x: 0, y: 0 }]);
  });
});

// ============================================================================
// === demoteJavaToNodeGraphSimple 端到端测试 ===
// ============================================================================

describe('demoteJavaToNodeGraphSimple', () => {
  it('27. 空文件列表 → 空图（modId=untitled，extracted 全 0，unsupported 空）', () => {
    const result = demoteJavaToNodeGraphSimple([]);
    expect(result.graph.nodes).toEqual([]);
    expect(result.graph.edges).toEqual([]);
    expect(result.graph.modId).toBe('untitled');
    expect(result.graph.version).toBe(1);
    expect(result.extracted).toEqual({ items: 0, blocks: 0, entities: 0, recipes: 0, code: 0 });
    expect(result.warnings).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it('28. 缺失 ModMain.java 但有 fabric.mod.json → modId 从 fabric.mod.json 提取', () => {
    const files = [makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON)];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.graph.modId).toBe('demo_mod');
  });

  it('29. 缺失 ModMain.java 和 fabric.mod.json → modId 回退到 untitled', () => {
    const files = [makeFile('build.gradle', BUILD_GRADLE)];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.graph.modId).toBe('untitled');
    // build.gradle 不被消费 → unsupported
    expect(result.unsupported).toContain('build.gradle');
  });

  it('30. 不识别的文件入 unsupported（build.gradle）', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/DemoModMod.java', MOD_MAIN_JAVA),
      makeFile('build.gradle', BUILD_GRADLE),
    ];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.unsupported).toContain('build.gradle');
    // fabric.mod.json 不在 unsupported（被消费用于 modId）
    expect(result.unsupported).not.toContain('fabric.mod.json');
  });

  it('31. 单文件 ModItems.java → 提取 2 个 item 节点', () => {
    const files = [makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA)];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.extracted.items).toBe(2);
    expect(result.extracted.blocks).toBe(0);
    expect(result.extracted.code).toBe(0);
    const items = nodesOfKind(result.graph, 'item');
    expect(items).toHaveLength(2);
    const ids = items.map((n) => (n.data as { itemId: string }).itemId).sort();
    expect(ids).toEqual(['ruby_ingot', 'ruby_sword']);
  });

  it('32. 单文件 ModBlocks.java → 提取 1 个 block 节点（含 hardness/luminance）', () => {
    const files = [makeFile('src/main/java/com/example/demo_mod/ModBlocks.java', MOD_BLOCKS_JAVA)];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.extracted.blocks).toBe(1);
    const blocks = nodesOfKind(result.graph, 'block');
    expect(blocks).toHaveLength(1);
    const data = blocks[0].data as { blockId: string; hardness: number; luminance: number };
    expect(data.blockId).toBe('ruby_ore');
    expect(data.hardness).toBeCloseTo(3.0, 5);
    expect(data.luminance).toBe(8);
  });

  it('33. 单文件 ModCustomCode.java → 提取 2 个 code 节点（往返等价关键）', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/ModCustomCode.java', MOD_CUSTOM_CODE_JAVA),
    ];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.extracted.code).toBe(2);
    const codeNodes = nodesOfKind(result.graph, 'code');
    expect(codeNodes).toHaveLength(2);
    // 验证 nodeId 完整保留
    const nodeIds = codeNodes.map((n) => (n.data as { nodeId: string }).nodeId).sort();
    expect(nodeIds).toEqual(['code_compute', 'code_process']);
  });

  it('34. 单文件 recipe JSON → 提取 1 个 recipe 节点', () => {
    const files = [
      makeFile('src/main/resources/data/demo_mod/recipe/ruby_sword.json', RECIPE_RUBY_SWORD_JSON),
    ];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.extracted.recipes).toBe(1);
    const recipes = nodesOfKind(result.graph, 'recipe');
    expect(recipes).toHaveLength(1);
    const data = recipes[0].data as { recipeId: string; recipeType: string };
    expect(data.recipeId).toBe('ruby_sword');
    expect(data.recipeType).toBe('crafting_shaped');
  });

  it('35. 混合文件（items + blocks + recipes + code）→ 各类计数正确', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/DemoModMod.java', MOD_MAIN_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModBlocks.java', MOD_BLOCKS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModCustomCode.java', MOD_CUSTOM_CODE_JAVA),
      makeFile('src/main/resources/data/demo_mod/recipe/ruby_sword.json', RECIPE_RUBY_SWORD_JSON),
      makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON),
      makeFile('build.gradle', BUILD_GRADLE),
    ];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.extracted.items).toBe(2);
    expect(result.extracted.blocks).toBe(1);
    expect(result.extracted.code).toBe(2);
    expect(result.extracted.recipes).toBe(1);
    // build.gradle 入 unsupported
    expect(result.unsupported).toContain('build.gradle');
    // modId 从 ModMain.java 提取
    expect(result.graph.modId).toBe('demo_mod');
  });

  it('36. 网格布局验证：节点位置符合 x+=260，每 5 个 y+=180', () => {
    // 用 7 个 item 来验证布局换行
    const itemsJava = Array.from(
      { length: 7 },
      (_, i) =>
        `    public static final Item ITEM_${i} = register("item_${i}", new Item(new Item.Settings()));`,
    ).join('\n');
    const content = `package com.example.test;
import net.minecraft.item.Item;
public class ModItems {
${itemsJava}
    private static Item register(String name, Item item) { return item; }
}`;
    const files = [makeFile('src/main/java/ModItems.java', content)];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.graph.nodes).toHaveLength(7);
    // 验证前 5 个在 y=0
    for (let i = 0; i < 5; i++) {
      expect(result.graph.nodes[i].position).toEqual({ x: i * 260, y: 0 });
    }
    // 第 6、7 个在 y=180
    expect(result.graph.nodes[5].position).toEqual({ x: 0, y: 180 });
    expect(result.graph.nodes[6].position).toEqual({ x: 260, y: 180 });
  });

  it('37. 无法识别的 Java 文件 → 作为 CodeNode 保留', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/BlockPosHelper.java', UNKNOWN_JAVA),
    ];
    const result = demoteJavaToNodeGraphSimple(files);
    expect(result.extracted.code).toBe(1);
    const codeNodes = nodesOfKind(result.graph, 'code');
    expect(codeNodes).toHaveLength(1);
    const data = codeNodes[0].data as { language: string; methodName: string };
    expect(data.language).toBe('java');
    expect(data.methodName).toBe('offset');
  });

  // === 往返等价测试（L2→L3→L2）：核心验收点 ===

  it('38. 往返等价：promoteMultipleCodeNodes → demoteJavaToNodeGraphSimple 还原原代码节点', () => {
    const originalNodes: CodeNodeDataForPromotion[] = [
      {
        nodeId: 'code_roundtrip_1',
        label: '往返测试1',
        note: '验证 L2→L3→L2 等价',
        language: 'java',
        code: 'int result = 100;',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'computeResult',
      },
      {
        nodeId: 'code_roundtrip_2',
        label: '往返测试2',
        note: '多节点场景',
        language: 'java',
        code: 'System.out.println("test");',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'printTest',
      },
    ];

    // L2 → L3：提升为 Java 源码
    const promoted = promoteMultipleCodeNodes(originalNodes, 'roundtrip_mod');
    expect(promoted.files.length).toBeGreaterThanOrEqual(2);

    // L3 → L2：反向降级回节点图
    const demoted = demoteJavaToNodeGraphSimple(promoted.files);

    // 验证 modId 往返
    expect(demoted.graph.modId).toBe('roundtrip_mod');

    // 验证 code 节点数往返等价
    expect(demoted.extracted.code).toBe(2);

    // 验证每个 code 节点的字段往返等价
    const codeNodes = nodesOfKind(demoted.graph, 'code');
    expect(codeNodes).toHaveLength(2);

    const node1 = codeNodes.find(
      (n) => (n.data as { nodeId: string }).nodeId === 'code_roundtrip_1',
    );
    expect(node1).toBeDefined();
    const data1 = node1!.data as {
      nodeId: string;
      methodName: string;
      label: string;
      note: string;
      language: string;
      code: string;
    };
    expect(data1.methodName).toBe('computeResult');
    expect(data1.label).toBe('往返测试1');
    expect(data1.note).toBe('验证 L2→L3→L2 等价');
    expect(data1.language).toBe('java');
    expect(data1.code).toBe('int result = 100;');

    const node2 = codeNodes.find(
      (n) => (n.data as { nodeId: string }).nodeId === 'code_roundtrip_2',
    );
    expect(node2).toBeDefined();
    const data2 = node2!.data as {
      nodeId: string;
      methodName: string;
      code: string;
    };
    expect(data2.methodName).toBe('printTest');
    expect(data2.code).toBe('System.out.println("test");');
  });

  it('39. 往返等价：单节点场景', () => {
    const original: CodeNodeDataForPromotion[] = [
      {
        nodeId: 'solo_node',
        label: '独立节点',
        note: '',
        language: 'java',
        code: 'return 42;',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'answer',
      },
    ];
    const promoted = promoteMultipleCodeNodes(original, 'solo_mod');
    const demoted = demoteJavaToNodeGraphSimple(promoted.files);
    expect(demoted.extracted.code).toBe(1);
    expect(demoted.graph.modId).toBe('solo_mod');
    const codeNode = nodesOfKind(demoted.graph, 'code')[0];
    const data = codeNode.data as { nodeId: string; methodName: string; code: string };
    expect(data.nodeId).toBe('solo_node');
    expect(data.methodName).toBe('answer');
    expect(data.code).toBe('return 42;');
  });

  it('40. DemotionResult 结构完整性：包含 graph/warnings/unsupported/extracted 四字段', () => {
    const result = demoteJavaToNodeGraphSimple([]);
    expect(result).toHaveProperty('graph');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('unsupported');
    expect(result).toHaveProperty('extracted');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.unsupported)).toBe(true);
    expect(result.extracted).toEqual({
      items: 0,
      blocks: 0,
      entities: 0,
      recipes: 0,
      code: 0,
    });
  });
});

// ============================================================================
// === 已有 demoteJavaToNodeGraph 接口回归测试（保持 DemoteButton.tsx 可用） ===
// ============================================================================

describe('demoteJavaToNodeGraph（已有接口，回归保护）', () => {
  it('41. 两参版本仍可用：demoteJavaToNodeGraph(files, modId) → DemoteResult', () => {
    const files = [makeFile('src/main/java/ModItems.java', MOD_ITEMS_JAVA)];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');
    // DemoteResult（非 DemotionResult）含 stats 字段
    expect(result).toHaveProperty('graph');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('stats');
    expect(result).not.toHaveProperty('extracted');
    expect(result).not.toHaveProperty('unsupported');
    expect(result.stats.items).toBe(2);
    expect(result.graph.modId).toBe('demo_mod');
  });

  it('42. 一参版本（modId 缺省）仍可用：默认 unnamed_mod', () => {
    const files = [makeFile('src/main/java/ModItems.java', MOD_ITEMS_JAVA)];
    const result = demoteJavaToNodeGraph(files);
    expect(result.graph.modId).toBe('unnamed_mod');
  });
});

// ============================================================================
// === demoteJavaToNodeGraph 综合测试（覆盖 entities/events/lang/edges/stats） ===
// === 这些场景在 demoteJavaToNodeGraphSimple 中未覆盖，需要本接口的扩展能力    ===
// ============================================================================

// === 本节专用 Java 样例 ===

const MOD_ENTITIES_JAVA = `package com.example.demo_mod;

import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.entity.attribute.DefaultAttributeRegistry;

public class ModEntities {
    public static final EntityType<RubyGolemEntity> RUBY_GOLEM = register(
        "ruby_golem",
        EntityType.Builder.create(RubyGolemEntity::new, SpawnGroup.MONSTER)
            .dimensions(1.4f, 2.7f)
            .build()
    );

    private static <T> EntityType<T> register(String name, EntityType<T> type) {
        return Registry.register(Registries.ENTITY_TYPE, Identifier.of(ModMain.MOD_ID, name), type);
    }

    public static void createAttributes() {
        DefaultAttributeRegistry.builder()
            .maxHealth(80.0f)
            .movementSpeed(0.25f)
            .attackDamage(8.0f);
    }
}
`;

const MOD_EVENTS_JAVA = `package com.example.demo_mod;

import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.minecraft.server.MinecraftServer;

public class ModEvents {
    public static void register() {
        ServerTickEvents.END_SERVER_TICK.register((MinecraftServer server) -> {
            // do something on tick
        });

        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> {
            // do something on block break
        });
    }
}
`;

const LANG_EN_US_JSON = `{
  "item.demo_mod.ruby_sword": "Ruby Sword",
  "item.demo_mod.ruby_ingot": "Ruby Ingot",
  "block.demo_mod.ruby_ore": "Ruby Ore",
  "entity.demo_mod.ruby_golem": "Ruby Golem"
}
`;

const RECIPE_UNKNOWN_OUTPUT_JSON = `{
  "type": "minecraft:crafting_shapeless",
  "ingredients": [
    {"item": "demo_mod:ruby_ingot"}
  ],
  "result": {
    "item": "demo_mod:nonexistent_item"
  }
}
`;

/** 安全类型转换：把 NodeData 转为特定字段子集（避免 TS2352 错误） */
function dataAs<T>(data: unknown): T {
  return data as T;
}

describe('demoteJavaToNodeGraph 综合测试（entities/events/lang/edges/stats）', () => {
  it('43. ModEntities.java 解析 → entity 节点（含属性提取）', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/ModEntities.java', MOD_ENTITIES_JAVA),
    ];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');
    const entities = nodesOfKind(result.graph, 'entity');
    expect(entities).toHaveLength(1);

    const data = dataAs<{
      entityId: string;
      maxHealth: number;
      movementSpeed: number;
      attackDamage: number;
      classification: string;
    }>(entities[0].data);
    expect(data.entityId).toBe('ruby_golem');
    expect(data.maxHealth).toBeCloseTo(80.0, 5);
    expect(data.movementSpeed).toBeCloseTo(0.25, 5);
    expect(data.attackDamage).toBeCloseTo(8.0, 5);
    expect(data.classification).toBe('monster');

    expect(result.stats.entities).toBe(1);
  });

  it('44. ModEvents.java 解析 → event 节点（含类型推断）', () => {
    const files = [makeFile('src/main/java/com/example/demo_mod/ModEvents.java', MOD_EVENTS_JAVA)];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');
    const events = nodesOfKind(result.graph, 'event');
    expect(events).toHaveLength(2);

    const eventTypes = events.map((n) => dataAs<{ eventType: string }>(n.data).eventType).sort();
    // ServerTickEvents.END_SERVER_TICK → tick
    // PlayerBlockBreakEvents.AFTER → block_break
    expect(eventTypes).toEqual(['block_break', 'tick']);

    expect(result.stats.events).toBe(2);
  });

  it('45. lang/en_us.json 回填 displayName', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA),
      makeFile('src/main/resources/assets/demo_mod/lang/en_us.json', LANG_EN_US_JSON),
    ];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');
    const items = nodesOfKind(result.graph, 'item');
    const sword = items.find((n) => dataAs<{ itemId: string }>(n.data).itemId === 'ruby_sword');
    expect(sword).toBeDefined();
    expect(dataAs<{ displayName: string }>(sword!.data).displayName).toBe('Ruby Sword');

    const ingot = items.find((n) => dataAs<{ itemId: string }>(n.data).itemId === 'ruby_ingot');
    expect(dataAs<{ displayName: string }>(ingot!.data).displayName).toBe('Ruby Ingot');
  });

  it('46. recipe → item 边生成（按 itemId 匹配）', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA),
      makeFile('src/main/resources/data/demo_mod/recipe/ruby_sword.json', RECIPE_RUBY_SWORD_JSON),
    ];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');
    // ruby_sword 配方的输出指向 ruby_sword 物品 → 应生成 1 条 craft 边
    expect(result.graph.edges).toHaveLength(1);
    const edge = result.graph.edges[0];
    expect(edge.kind).toBe('craft');

    // 源节点应为 recipe，目标节点应为 item
    const sourceNode = result.graph.nodes.find((n) => n.id === edge.source);
    const targetNode = result.graph.nodes.find((n) => n.id === edge.target);
    expect(sourceNode?.data.kind).toBe('recipe');
    expect(targetNode?.data.kind).toBe('item');
    expect(dataAs<{ itemId: string }>(targetNode!.data).itemId).toBe('ruby_sword');
  });

  it('47. 节点位置布局验证（按 kind 分行：items y=100，blocks y=300，etc.）', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModBlocks.java', MOD_BLOCKS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModEntities.java', MOD_ENTITIES_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModEvents.java', MOD_EVENTS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/BlockPosHelper.java', UNKNOWN_JAVA),
    ];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');

    // items 在 y=100，blocks 在 y=300，entities 在 y=500，events 在 y=900，code 在 y=1100
    const items = nodesOfKind(result.graph, 'item');
    const blocks = nodesOfKind(result.graph, 'block');
    const entities = nodesOfKind(result.graph, 'entity');
    const events = nodesOfKind(result.graph, 'event');
    const codes = nodesOfKind(result.graph, 'code');

    for (const n of items) expect(n.position.y).toBe(100);
    for (const n of blocks) expect(n.position.y).toBe(300);
    for (const n of entities) expect(n.position.y).toBe(500);
    for (const n of events) expect(n.position.y).toBe(900);
    for (const n of codes) expect(n.position.y).toBe(1100);

    // items 应按提取顺序 x=200, x=450
    const sortedItems = [...items].sort((a, b) => a.position.x - b.position.x);
    expect(sortedItems[0].position.x).toBe(200);
    expect(sortedItems[1].position.x).toBe(450);

    // events 应按提取顺序 x=200, x=450
    const sortedEvents = [...events].sort((a, b) => a.position.x - b.position.x);
    expect(sortedEvents[0].position.x).toBe(200);
    expect(sortedEvents[1].position.x).toBe(450);
  });

  it('48. DemoteResult.stats 字段验证（含 entities/events 计数）', () => {
    const files = [
      makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModBlocks.java', MOD_BLOCKS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModEntities.java', MOD_ENTITIES_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModEvents.java', MOD_EVENTS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/BlockPosHelper.java', UNKNOWN_JAVA),
      makeFile('src/main/resources/data/demo_mod/recipe/ruby_sword.json', RECIPE_RUBY_SWORD_JSON),
    ];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');

    expect(result.stats).toEqual({
      items: 2,
      blocks: 1,
      entities: 1,
      recipes: 1,
      events: 2,
      codeNodes: 1,
    });
  });

  it('49. 多文件混合解析（含 5 类文件）→ 综合统计正确', () => {
    const files = [
      makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON),
      makeFile('src/main/resources/assets/demo_mod/lang/en_us.json', LANG_EN_US_JSON),
      makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModBlocks.java', MOD_BLOCKS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModEntities.java', MOD_ENTITIES_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModEvents.java', MOD_EVENTS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/BlockPosHelper.java', UNKNOWN_JAVA),
      makeFile('src/main/resources/data/demo_mod/recipe/ruby_sword.json', RECIPE_RUBY_SWORD_JSON),
    ];
    // 不传 modId，由 fabric.mod.json 提取
    const result = demoteJavaToNodeGraph(files);

    // modId 应从 fabric.mod.json 提取
    expect(result.graph.modId).toBe('demo_mod');

    // 综合统计
    expect(result.stats.items).toBe(2);
    expect(result.stats.blocks).toBe(1);
    expect(result.stats.entities).toBe(1);
    expect(result.stats.events).toBe(2);
    expect(result.stats.recipes).toBe(1);
    expect(result.stats.codeNodes).toBe(1);

    // displayName 应回填自 lang 文件
    const sword = result.graph.nodes.find(
      (n) => n.data.kind === 'item' && dataAs<{ itemId: string }>(n.data).itemId === 'ruby_sword',
    );
    expect(dataAs<{ displayName: string }>(sword!.data).displayName).toBe('Ruby Sword');

    // 应有 1 条 recipe → item 边
    expect(result.graph.edges).toHaveLength(1);
  });

  it('50. 自定义 modId 透传（优先级最高，覆盖 fabric.mod.json）', () => {
    const files = [makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON)];
    const result = demoteJavaToNodeGraph(files, 'custom_mod_id');
    expect(result.graph.modId).toBe('custom_mod_id');
  });

  it('51. 从 fabric.mod.json 提取 modId（未传参时使用）', () => {
    const files = [makeFile('src/main/resources/fabric.mod.json', FABRIC_MOD_JSON)];
    const result = demoteJavaToNodeGraph(files);
    expect(result.graph.modId).toBe('demo_mod');
  });

  it('52. 警告信息生成（recipe 引用不存在的 item）', () => {
    const files = [
      makeFile(
        'src/main/resources/data/demo_mod/recipe/unknown_output.json',
        RECIPE_UNKNOWN_OUTPUT_JSON,
      ),
    ];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');
    // 应有 1 个 recipe 节点
    expect(result.stats.recipes).toBe(1);
    // 应无 edge（因为 nonexistent_item 不存在）
    expect(result.graph.edges).toHaveLength(0);
    // 应有警告提到引用了不存在的物品
    const warningText = result.warnings.join('\n');
    expect(warningText).toMatch(/引用了不存在的物品.*nonexistent_item/);
  });

  it('53. 警告信息生成（itemId 重复注册）', () => {
    // 两份 ModItems.java 都注册 ruby_sword → 应触发重复警告
    const files = [
      makeFile('src/main/java/com/example/demo_mod/ModItems.java', MOD_ITEMS_JAVA),
      makeFile('src/main/java/com/example/demo_mod/ModItems2.java', MOD_ITEMS_JAVA),
    ];
    const result = demoteJavaToNodeGraph(files, 'demo_mod');
    // 仅保留首次注册的 2 个物品（重复的 ruby_sword / ruby_ingot 跳过）
    expect(result.stats.items).toBe(2);
    // 应有重复警告
    const warningText = result.warnings.join('\n');
    expect(warningText).toMatch(/物品 ID 重复.*ruby_sword/);
    expect(warningText).toMatch(/物品 ID 重复.*ruby_ingot/);
  });

  it('54. 空文件列表 → 空图（仅 modId=unnamed_mod，stats 全 0）', () => {
    const result = demoteJavaToNodeGraph([]);
    expect(result.graph.nodes).toEqual([]);
    expect(result.graph.edges).toEqual([]);
    expect(result.graph.modId).toBe('unnamed_mod');
    expect(result.graph.version).toBe(1);
    expect(result.stats).toEqual({
      items: 0,
      blocks: 0,
      entities: 0,
      recipes: 0,
      events: 0,
      codeNodes: 0,
    });
    expect(result.warnings).toEqual([]);
  });
});
