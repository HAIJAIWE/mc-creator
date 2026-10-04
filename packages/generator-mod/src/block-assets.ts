/**
 * 方块资源生成（blockstate / 方块模型 / 方块物品模型），供各 loader adapter 共用。
 *
 * 背景：Mod 生成器原先只输出物品模型，方块进游戏后因缺少 blockstate 与方块模型
 * 显示为紫黑「缺失模型」。本模块为每个 BlockSpec 产出：
 * - assets/<modId>/blockstates/<blockId>.json
 * - assets/<modId>/models/block/<blockId>.json
 * - assets/<modId>/models/item/<blockId>.json（方块物品在物品栏中的模型）
 *
 * 仅支持 cube_all / cube_column / cross 三类模型；door/fence/stairs/custom 及未知取值
 * 统一回退为 cube_all（回退警告由 unsupported.ts 的 collectUnimplemented 统一收集）。
 */
import type { FileNode } from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';

/** 生成器实际支持的方块模型类型 */
export const SUPPORTED_BLOCK_MODELS = ['cube_all', 'cube_column', 'cross'] as const;

/** 宽松的方块形状（spec 未完整 parse 时 modelType/blockType 可能缺失） */
interface BlockLike {
  id: string;
  blockType?: string | undefined;
  modelType?: string | undefined;
  texturePath?: string | undefined;
  texturePaths?:
    | {
        top?: string | undefined;
        bottom?: string | undefined;
        north?: string | undefined;
        south?: string | undefined;
        east?: string | undefined;
        west?: string | undefined;
      }
    | undefined;
}

/**
 * BlockSpec.blockType → modelType 的推导（与画布 specToNodeGraph.mapBlockModel 保持一致）：
 * full_block 视为 cube_all，其余行为型方块统一视为 custom，
 * 保证画布数据与 spec 反向还原时模型语义一致。
 */
export function mapBlockModel(blockType: string): string {
  return blockType === 'full_block' ? 'cube_all' : 'custom';
}

/**
 * 解析方块最终模型类型：优先取 spec 显式记录的 modelType；
 * 旧 spec 无此字段时按 blockType 推导（保证画布 ↔ spec 双向一致）。
 */
export function resolveBlockModelType(block: {
  blockType?: string | undefined;
  modelType?: string | undefined;
}): string {
  return block.modelType ?? mapBlockModel(block.blockType ?? 'full_block');
}

/** 方块模型 JSON 的 textures 取值（面 → 纹理资源位置） */
function blockTextureRefs(ns: string, block: BlockLike, modelType: string) {
  // 占位纹理只有一张 <modId>:block/<blockId>，缺省时必须回落到它，
  // 绝不能引用不存在的 _top/_side 纹理（否则游戏里又是紫黑方块）。
  const fallback = `${ns}:block/${block.id}`;
  const single = block.texturePath ?? fallback;
  const paths = block.texturePaths;

  if (modelType === 'cube_column') {
    // end 优先取 top/bottom；side 优先取四个水平面（schema 无 side 字段）。
    const end = paths?.top ?? paths?.bottom ?? single;
    const side = paths?.north ?? paths?.south ?? paths?.east ?? paths?.west ?? single;
    return { end, side };
  }
  if (modelType === 'cross') {
    return { cross: single };
  }
  return { all: single };
}

/** 构建单个方块的 block model（含回退逻辑） */
function buildBlockModel(ns: string, block: BlockLike): Record<string, unknown> {
  const modelType = resolveBlockModelType(block);
  const textures = blockTextureRefs(ns, block, modelType);

  if (modelType === 'cube_column') {
    return { parent: 'minecraft:block/cube_column', textures };
  }
  if (modelType === 'cross') {
    return { parent: 'minecraft:block/cross', textures, render_type: 'cutout' };
  }
  // cube_all 及所有回退（door/fence/stairs/custom/未知取值）
  return { parent: 'minecraft:block/cube_all', textures };
}

/** 生成全部方块的 blockstate / 方块模型 / 方块物品模型 */
export function blockAssetFiles(spec: ModSpecLike): FileNode[] {
  const ns = spec.modId;
  const files: FileNode[] = [];
  for (const block of spec.blocks) {
    const id = block.id;
    files.push({
      path: `src/main/resources/assets/${ns}/blockstates/${id}.json`,
      content: JSON.stringify({ variants: { '': { model: `${ns}:block/${id}` } } }, null, 2),
    });
    files.push({
      path: `src/main/resources/assets/${ns}/models/block/${id}.json`,
      content: JSON.stringify(buildBlockModel(ns, block), null, 2),
    });
    files.push({
      path: `src/main/resources/assets/${ns}/models/item/${id}.json`,
      content: JSON.stringify({ parent: `${ns}:block/${id}` }, null, 2),
    });
  }
  return files;
}

/**
 * 合并物品模型与方块资产。
 *
 * 冲突处理：若某 block 的 id 与某 item 的 id 相同，二者会写同一路径
 * `models/item/<id>.json`。此处以方块为准（方块物品在物品栏应显示方块本体外观，
 * 避免"世界里是方块、物品栏是另一张图"的割裂），丢弃同路径的 item 模型，
 * 保证结果中每个路径只有一条 FileNode。
 */
export function mergeModels(itemNodes: FileNode[], blockNodes: FileNode[]): FileNode[] {
  const blockPaths = new Set(blockNodes.map((n) => n.path));
  return [...itemNodes.filter((n) => !blockPaths.has(n.path)), ...blockNodes];
}
