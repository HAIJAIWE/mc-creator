/**
 * NeoForge Adapter 的资源文件生成域。
 *
 * 从 neoforge-adapter.ts 提取：<modId>_meta.json / en_us.json / item models。
 * 保持与重构前完全一致的行为。
 */
import type { FileNode } from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';

/**
 * P10：生成 <modId>_meta.json 元数据文件（最小侵入，避免改动 mods.toml）。
 * 汇总所有新增字段（license/authors/credits/dependencies/website + items/blocks 新属性）。
 */
export function neoforgeMetaJson(spec: ModSpecLike): FileNode {
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

export function neoforgeLangJson(spec: ModSpecLike): FileNode {
  const entries: Record<string, string> = {};
  for (const it of spec.items) entries[`item.${spec.modId}.${it.id}`] = it.name;
  for (const b of spec.blocks) entries[`block.${spec.modId}.${b.id}`] = b.name;
  return {
    path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
    content: JSON.stringify(entries, null, 2),
  };
}

/**
 * P1 dogfood 修复：生成 item model JSON（与 Fabric 一致）。
 * NeoForge 的 item 也需要 models/item/<id>.json 才能在游戏中正确显示。
 */
export function neoforgeItemModels(spec: ModSpecLike): FileNode[] {
  return spec.items.map((it) => ({
    path: `src/main/resources/assets/${spec.modId}/models/item/${it.id}.json`,
    content: JSON.stringify(
      { parent: 'minecraft:item/generated', textures: { layer0: `${spec.modId}:item/${it.id}` } },
      null,
      2,
    ),
  }));
}
