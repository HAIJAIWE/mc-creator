/** Fabric Adapter 的资源文件生成域。原样提取,行为不变。 */
import type { FileNode } from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';

export function fabricMetaJson(spec: ModSpecLike): FileNode {
  const meta = {
    modId: spec.modId,
    license: spec.license,
    authors: spec.authors,
    credits: spec.credits,
    website: spec.website,
    dependencies: spec.dependencies,
    items: spec.items.map((it) => ({
      id: it.id,
      rarity: it.rarity,
      maxDamage: it.maxDamage,
      fuelTick: it.fuelTick,
      food: it.food ?? null,
      lore: it.lore,
    })),
    blocks: spec.blocks.map((b) => ({
      id: b.id,
      miningLevel: b.miningLevel,
      lightLevel: b.lightLevel,
      resistance: b.resistance,
      soundType: b.soundType,
      dropSelf: b.dropSelf,
      dropItem: b.dropItem,
    })),
  };
  return {
    path: `src/main/resources/${spec.modId}_meta.json`,
    content: JSON.stringify(meta, null, 2),
  };
}

export function fabricLangJson(spec: ModSpecLike): FileNode {
  const entries: Record<string, string> = {};
  for (const it of spec.items) entries[`item.${spec.modId}.${it.id}`] = it.name;
  for (const b of spec.blocks) entries[`block.${spec.modId}.${b.id}`] = b.name;
  return {
    path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
    content: JSON.stringify(entries, null, 2),
  };
}

export function fabricItemModels(spec: ModSpecLike): FileNode[] {
  return spec.items.map((it) => ({
    path: `src/main/resources/assets/${spec.modId}/models/item/${it.id}.json`,
    content: JSON.stringify(
      { parent: 'minecraft:item/generated', textures: { layer0: `${spec.modId}:item/${it.id}` } },
      null,
      2,
    ),
  }));
}

/** T5: 机器配方映射 → Java switch case（输入物品 ID → 输出物品 ID） */

export function fabricEntityModels(spec: ModSpecLike): FileNode[] {
  const customEntities = (spec.entities ?? []).filter((e) => e.modelType === 'custom');
  if (customEntities.length === 0) return [];
  return customEntities.map((e) => ({
    path: `src/main/resources/assets/${spec.modId}/models/entity/${e.entityId}.json`,
    content: JSON.stringify(
      {
        // T6: 自定义模型骨架。用 Blockbench 导出替换此文件：
        // 模型格式参考 https://minecraft.wiki/w/Tutorials/Models
        format_version: '1.12.0',
        description: {
          identifier: `${spec.modId}:${e.entityId}`,
          texture_width: 64,
          texture_height: 32,
        },
        geometry: {
          description: {
            identifier: `geometry.${e.entityId}`,
            texture_width: 64,
            texture_height: 32,
          },
          bones: [
            {
              name: 'body',
              pivot: [0, 0, 0],
              cubes: [
                {
                  origin: [-4, 0, -4],
                  size: [8, 12, 8],
                  uv: [0, 0],
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
  }));
}
