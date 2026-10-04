/** Fabric Adapter asset generation domain. */
import type { FileNode } from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';
export { generateRecipeJson, fabricModRecipeJson } from './recipe-json-generator.js';
import { generatePlaceholderTextures } from './texture-generator.js';

type EntitySpec = NonNullable<ModSpecLike['entities']>[number];

export function fabricMetaJson(spec: ModSpecLike): FileNode {
  const itemsResult = spec.items.map((it) => ({
    id: it.id,
    rarity: it.rarity,
    maxDamage: it.maxDamage,
    fuelTick: it.fuelTick,
    food: it.food ?? null,
    lore: it.lore,
  }));
  const blocksResult = spec.blocks.map((b) => ({
    id: b.id,
    miningLevel: b.miningLevel,
    lightLevel: b.lightLevel,
    resistance: b.resistance,
    soundType: b.soundType,
    dropSelf: b.dropSelf,
    dropItem: b.dropItem,
  }));
  const meta = {
    modId: spec.modId,
    license: spec.license,
    authors: spec.authors,
    credits: spec.credits,
    website: spec.website,
    dependencies: spec.dependencies,
    items: itemsResult,
    blocks: blocksResult,
  };
  return {
    path: `src/main/resources/${spec.modId}_meta.json`,
    content: JSON.stringify(meta, null, 2),
  };
}

export function fabricLangJson(spec: ModSpecLike): FileNode {
  const entries: Record<string, string> = {};
  for (const it of spec.items) {
    entries[`item.${spec.modId}.${it.id}`] = it.name;
  }
  for (const b of spec.blocks) {
    entries[`block.${spec.modId}.${b.id}`] = b.name;
  }
  return {
    path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
    content: JSON.stringify(entries, null, 2),
  };
}

export function fabricItemModels(spec: ModSpecLike): FileNode[] {
  return spec.items.map((it) => {
    const itemModel = {
      parent: 'minecraft:item/generated',
      textures: { layer0: `${spec.modId}:item/${it.id}` },
    };
    return {
      path: `src/main/resources/assets/${spec.modId}/models/item/${it.id}.json`,
      content: JSON.stringify(itemModel, null, 2),
    };
  });
}

function buildEntityModel(spec: ModSpecLike, e: EntitySpec) {
  const cubes = [{ origin: [-4, 0, -4], size: [8, 12, 8], uv: [0, 0] }];

  const bones = [{ name: 'body', pivot: [0, 0, 0], cubes }];

  const geometry = {
    description: {
      identifier: `geometry.${e.entityId}`,
      texture_width: 64,
      texture_height: 32,
    },
    bones,
  };

  const description = {
    identifier: `${spec.modId}:${e.entityId}`,
    texture_width: 64,
    texture_height: 32,
  };

  return {
    format_version: '1.12.0',
    description,
    geometry,
  };
}

export function fabricEntityModels(spec: ModSpecLike): FileNode[] {
  const entities = spec.entities ?? [];
  const customEntities = entities.filter((e) => e.modelType === 'custom');
  if (customEntities.length === 0) return [];
  return customEntities.map((e) => {
    const entityModel = buildEntityModel(spec, e);
    return {
      path: `src/main/resources/assets/${spec.modId}/models/entity/${e.entityId}.json`,
      content: JSON.stringify(entityModel, null, 2),
    };
  });
}

export function fabricPlaceholderTextures(spec: ModSpecLike): FileNode[] {
  return generatePlaceholderTextures(
    spec.modId,
    (spec.items ?? []).map((item) => ({ id: item.id, name: item.name })),
    (spec.blocks ?? []).map((block) => ({ id: block.id, name: block.name })),
  ).map((file) => ({
    path: file.path,
    content: file.content.toString('base64'),
  }));
}
