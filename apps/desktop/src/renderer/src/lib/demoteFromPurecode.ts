import type { FileNode, ModNode, NodeGraph } from '@mc-creator/shared';
import { makeNode } from './demote/nodeFactory.js';
import { basenameNoExt, sanitizeId, extractFirstPublicMethodName } from './demote/textUtils.js';
import { parseFabricModJson, parseLangJson, parseRecipeJson } from './demote/jsonParsers.js';
import { parseJavaFile, genNodeId, type DemoteContext } from './demote/javaParsers.js';
import {
  extractModId,
  extractItems,
  extractBlocks,
  extractCodeNodes,
  extractRecipes,
  extractEntitiesInternal,
  isFileConsumed,
} from './demote/extractors.js';
import { applyLayoutByKind, layoutNodes } from './demote/layout.js';
import { generateRecipeEdges } from './demote/edges.js';
import type { DemoteResult, DemotionResult, ExtractionSummary } from './demote/types.js';

// === barrel：保持本模块对外可见符号集合不变 ===
// 提取器 / 布局 / 类型 均下沉到 demote/ 子模块，此处重新导出，
// 使所有现存 import（如 `import { demoteJavaToNodeGraphSimple } from './demoteFromPurecode.js'`）继续有效。
export type {
  DemoteResult,
  DemotionResult,
  ExtractionSummary,
  ExtractedCodeNode,
  ExtractedRecipe,
} from './demote/types.js';
export {
  extractModId,
  extractItems,
  extractBlocks,
  extractCodeNodes,
  extractRecipes,
} from './demote/extractors.js';
export { layoutNodes } from './demote/layout.js';

/**
 * L3 → L2 反向降级路径：从 PurecodeWorkspace 中的 Java/JSON 文件反向提取信息，
 * 生成对应的节点图（NodeGraph）。
 *
 * 设计参考：
 * - `apps/desktop/src/renderer/src/lib/promoteToPurecode.ts` 的正向提升逻辑（反向参考）
 * - `apps/desktop/src/renderer/src/lib/compileNodeGraph.ts` 的节点 → ModSpec 编译器
 * - `packages/shared/src/schemas/node-graph-spec.ts` 的节点图 schema
 *
 * 解析策略（不要求完整 AST，目标覆盖 80% 常见模式）：
 * - Java 文件用正则 + 字符串匹配识别注册模式
 * - JSON 文件用 JSON.parse 后按字段提取
 * - 无法识别的 Java 文件作为 CodeNode 保留（用户手动处理）
 *
 * 集成说明：
 *   本模块仅负责生成 DemoteResult，不直接修改 node-graph-store。
 *   调用方（PurecodeWorkspace 的 DemoteButton）负责把结果交给
 *   useNodeGraphStore.getState().loadGraph + setMode('lowcode')。
 */

// === 常量 ===

/** 默认 modId（与 compileNodeGraph 一致） */
const DEFAULT_MOD_ID = 'unnamed_mod';

// === 主入口 ===

/**
 * 从 FileNode[] 反向生成节点图。
 *
 * 解析流程：
 * 1. 解析 fabric.mod.json 提取 modId（如未传入 modId 参数）
 * 2. 解析 lang/en_us.json 建立 id → displayName 映射
 * 3. 解析所有 Java 文件，提取 items/blocks/entities/events/code 节点
 * 4. 解析所有 recipe JSON 文件，提取 recipe 节点
 * 5. 应用节点位置布局（按 kind 分行）
 * 6. 生成 recipe → item 边
 * 7. 汇总统计与警告
 *
 * @param files PurecodeWorkspace 中的文件列表
 * @param modId 当前 modId（优先级最高；空值时尝试从 fabric.mod.json 提取；都无则用 'unnamed_mod'）
 */
export function demoteJavaToNodeGraph(files: FileNode[], modId?: string): DemoteResult {
  const warnings: string[] = [];
  const usedNodeIds = new Set<string>();
  const usedItemIds = new Set<string>();
  const usedBlockIds = new Set<string>();
  const usedEntityIds = new Set<string>();

  // === 第 1 步：解析 modId ===
  let resolvedModId = modId?.trim() || '';
  if (!resolvedModId) {
    // 从 fabric.mod.json 提取
    const fabricFile = files.find((f) => f.path.endsWith('fabric.mod.json'));
    if (fabricFile) {
      const extracted = parseFabricModJson(fabricFile.content);
      if (extracted) resolvedModId = extracted;
    }
  }
  if (!resolvedModId) resolvedModId = DEFAULT_MOD_ID;

  // === 第 2 步：解析 lang 文件，建立映射 ===
  const langMap = new Map<string, string>();
  for (const file of files) {
    // 匹配 lang/en_us.json 或 assets/<modid>/lang/en_us.json
    if (/lang\/en_us\.json$/.test(file.path) || /lang\/zh_cn\.json$/.test(file.path)) {
      const partial = parseLangJson(file.content);
      for (const [k, v] of partial) langMap.set(k, v);
    }
  }

  // === 第 3 步：解析 Java 文件 ===
  const ctx: DemoteContext = {
    modId: resolvedModId,
    langMap,
    warnings,
    usedNodeIds,
    usedItemIds,
    usedBlockIds,
    usedEntityIds,
  };

  const nodes: ModNode[] = [];
  for (const file of files) {
    if (!file.path.endsWith('.java')) continue;
    const javaNodes = parseJavaFile(file, ctx);
    nodes.push(...javaNodes);
  }

  // === 第 4 步：解析 recipe JSON 文件 ===
  // 匹配 data/<modid>/recipe/*.json 或 data/<modid>/recipes/*.json
  // （Minecraft 1.21+ 使用单数 recipe/，老版本使用复数 recipes/）
  const recipeOutputs: Array<{ nodeId: string; outputItem: string; recipeId: string }> = [];
  for (const file of files) {
    if (!file.path.endsWith('.json')) continue;
    if (!/\/recipe(s)?\//.test(file.path)) continue;
    if (file.path.endsWith('fabric.mod.json')) continue;

    const recipeId = sanitizeId(basenameNoExt(file.path));
    if (recipeId === 'unknown') {
      warnings.push(`无法从路径 ${file.path} 推导 recipeId，已跳过`);
      continue;
    }
    const parsed = parseRecipeJson(file.content, recipeId, warnings);
    if (!parsed) continue;

    // 生成 recipe 节点
    const id = genNodeId(ctx, 'recipe', recipeId);
    const node = makeNode(id, 'recipe', {
      recipeId: parsed.recipeId,
      recipeType: parsed.recipeType,
      pattern: parsed.pattern,
      outputCount: parsed.outputCount,
      cookTime: parsed.cookTime,
      experience: parsed.experience,
      label: `配方: ${parsed.recipeId}`,
    });
    nodes.push(node);
    recipeOutputs.push({ nodeId: id, outputItem: parsed.outputItem, recipeId: parsed.recipeId });
  }

  // === 第 5 步：应用布局 ===
  applyLayoutByKind(nodes);

  // === 第 6 步：生成边 ===
  const edges = generateRecipeEdges(nodes, recipeOutputs, warnings);

  // === 第 7 步：汇总统计 ===
  const stats = {
    items: nodes.filter((n) => n.data.kind === 'item').length,
    blocks: nodes.filter((n) => n.data.kind === 'block').length,
    entities: nodes.filter((n) => n.data.kind === 'entity').length,
    recipes: nodes.filter((n) => n.data.kind === 'recipe').length,
    events: nodes.filter((n) => n.data.kind === 'event').length,
    codeNodes: nodes.filter((n) => n.data.kind === 'code').length,
  };

  const graph: NodeGraph = {
    version: 1,
    modId: resolvedModId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };

  return { graph, warnings, stats };
}

// ============================================================================
// === Spec-compliant 附加导出（additive，不破坏已有 DemoteButton.tsx） ===
// ============================================================================
//
// 以下导出按用户任务规范实现：
//   - DemotionResult / ExtractionSummary 类型
//   - extractModId / extractItems / extractBlocks / extractCodeNodes / extractRecipes / layoutNodes 辅助函数
//   - demoteJavaToNodeGraphSimple 主函数（一参 FileNode[] → DemotionResult）
//
// 命名说明：
//   规范要求主函数名为 `demoteJavaToNodeGraph(files): DemotionResult`（一参），
//   但上方已有同名函数 `demoteJavaToNodeGraph(files, modId?): DemoteResult`（两参，被
//   同级 Agent 创建的 DemoteButton.tsx 引用）。为避免破坏 DemoteButton.tsx（用户
//   禁止修改 Agent E/F/H 的文件），这里采用 `demoteJavaToNodeGraphSimple` 命名，
//   功能完全等价于规范要求的一参版本。
//
// 布局算法：
//   规范要求网格布局（x+=260，每 5 个节点 y+=180），与上方按 kind 分行的 applyLayoutByKind
//   不同。这里导出的 `layoutNodes` 实现网格布局。

// === 主函数（spec-compliant，一参版本） ===

/**
 * 从 PurecodeWorkspace 的 Java/JSON 文件反向生成节点图（spec-compliant 主函数）。
 *
 * 解析策略：
 * 1. extractModId：从 ModMain.java 提取 MOD_ID（回退 fabric.mod.json → 'untitled'）
 * 2. 遍历 Java 文件：
 *    - 若含 `// === 从节点图 Code 节点提升生成 ===` 标记 → extractCodeNodes（往返等价关键）
 *    - 否则用 extractItems / extractBlocks / extractEntitiesInternal 提取注册信息
 *    - 全部提取为空 → 整个文件作为 CodeNode 保留
 * 3. 遍历 JSON 文件：extractRecipes 提取配方（fabric.mod.json/lang 文件已消费，跳过）
 * 4. layoutNodes：网格布局（x+=260，每 5 个节点 y+=180）
 * 5. 汇总 extracted / unsupported / warnings
 *
 * @param files PurecodeWorkspace 中的文件列表
 * @returns DemotionResult（含 graph / warnings / unsupported / extracted）
 */
export function demoteJavaToNodeGraphSimple(files: FileNode[]): DemotionResult {
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const nodes: ModNode[] = [];
  const usedNodeIds = new Set<string>();

  // 生成唯一节点 id 的辅助
  const genId = (kind: string, suffix: string): string => {
    let i = 0;
    let candidate = `${kind}_${suffix}`;
    while (usedNodeIds.has(candidate)) {
      i += 1;
      candidate = `${kind}_${suffix}_${i}`;
    }
    usedNodeIds.add(candidate);
    return candidate;
  };

  // 1. 提取 modId
  const modId = extractModId(files);

  // 2. 遍历文件，提取节点
  for (const file of files) {
    if (file.path.endsWith('.java')) {
      const content = file.content;

      // 优先检查是否为 ModCustomCode.java（含提升标记）—— 往返等价关键
      const codeNodes = extractCodeNodes(content);
      if (codeNodes.length > 0) {
        for (const cn of codeNodes) {
          // 保留原始 nodeId（确保往返等价）
          const id = cn.nodeId || genId('code', cn.methodName);
          usedNodeIds.add(id);
          nodes.push(
            makeNode(id, 'code', {
              language: cn.language,
              code: cn.code,
              methodName: cn.methodName,
              label: cn.label || cn.methodName,
              note: cn.note,
              inputSignature: cn.inputSignature,
              outputSignature: cn.outputSignature,
            }),
          );
        }
        continue; // ModCustomCode.java 不再做 items/blocks/entities 提取
      }

      // 普通 Java 文件：提取 items/blocks/entities
      const items = extractItems(content);
      for (const item of items) {
        const id = genId('item', item.itemId);
        nodes.push(
          makeNode(id, 'item', {
            itemId: item.itemId,
            displayName: item.itemId,
            label: item.itemId,
            rarity: item.rarity as 'common' | 'uncommon' | 'rare' | 'epic',
          }),
        );
      }

      const blocks = extractBlocks(content);
      for (const block of blocks) {
        const id = genId('block', block.blockId);
        nodes.push(
          makeNode(id, 'block', {
            blockId: block.blockId,
            displayName: block.blockId,
            label: block.blockId,
            hardness: block.hardness,
            luminance: block.luminance,
          }),
        );
      }

      const entities = extractEntitiesInternal(content);
      for (const entity of entities) {
        const id = genId('entity', entity.entityId);
        nodes.push(
          makeNode(id, 'entity', {
            entityId: entity.entityId,
            displayName: entity.entityId,
            label: entity.entityId,
            maxHealth: entity.maxHealth,
            movementSpeed: entity.movementSpeed,
            attackDamage: entity.attackDamage,
            classification: entity.classification as
              'animal' | 'monster' | 'water_creature' | 'ambient' | 'misc',
          }),
        );
      }

      // 未识别的 Java 文件 → CodeNode 保留
      // 但跳过 ModMain 风格文件（含 MOD_ID = "xxx" 且无 register/code-marker）：
      // 这类文件已被 extractModId 消费（仅用于提取 modId），不应生成 CodeNode，
      // 否则会破坏 L2→L3→L2 往返等价（promoteMultipleCodeNodes 生成的 ModMain.java 会被误判为 CodeNode）
      if (items.length === 0 && blocks.length === 0 && entities.length === 0) {
        const isModMainStyle = /MOD_ID\s*=\s*"/.test(content);
        if (!isModMainStyle) {
          const fileName = basenameNoExt(file.path);
          const id = genId('code', fileName);
          nodes.push(
            makeNode(id, 'code', {
              language: 'java',
              code: content,
              methodName: extractFirstPublicMethodName(content),
              label: fileName,
              note: `未识别的 Java 文件：${file.path}`,
            }),
          );
        }
      }
    } else if (file.path.endsWith('.json')) {
      // fabric.mod.json 和 lang 文件已消费，跳过
      if (file.path.endsWith('fabric.mod.json')) continue;
      if (/lang\/(en_us|zh_cn)\.json$/.test(file.path)) continue;

      // 尝试配方提取
      const recipe = extractRecipes(file);
      if (recipe) {
        const id = genId('recipe', recipe.recipeId);
        nodes.push(
          makeNode(id, 'recipe', {
            recipeId: recipe.recipeId,
            recipeType: recipe.recipeType as
              | 'crafting_shaped'
              | 'crafting_shapeless'
              | 'smelting'
              | 'blasting'
              | 'smoking'
              | 'stonecutting',
            pattern: recipe.pattern,
            outputCount: recipe.outputCount,
            label: `配方: ${recipe.recipeId}`,
          }),
        );
      } else {
        // 非配方的 JSON 文件 → unsupported
        if (!isFileConsumed(file)) {
          unsupported.push(file.path);
        }
      }
    } else {
      // 非 Java 非 JSON 文件 → unsupported
      unsupported.push(file.path);
    }
  }

  // 3. 应用网格布局
  const positions = layoutNodes(nodes);
  nodes.forEach((node, idx) => {
    node.position = positions[idx];
  });

  // 4. 构建图
  const graph: NodeGraph = {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges: [],
    subgraphs: {},
  };

  // 5. 汇总提取摘要
  const extracted: ExtractionSummary = {
    items: nodes.filter((n) => n.data.kind === 'item').length,
    blocks: nodes.filter((n) => n.data.kind === 'block').length,
    entities: nodes.filter((n) => n.data.kind === 'entity').length,
    recipes: nodes.filter((n) => n.data.kind === 'recipe').length,
    code: nodes.filter((n) => n.data.kind === 'code').length,
  };

  return { graph, warnings, unsupported, extracted };
}
