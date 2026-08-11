import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type {
  BehaviorPackSpec,
  BpEntitySpec,
  BpRecipeSpec,
  BpLootTableSpec,
} from '@mc-creator/shared';

/**
 * 生成简单的 UUID v4（纯 JS，兼容浏览器和 Node.js）。
 * 使用 Math.random() + Date.now() 确保跨平台可用。
 */
function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 0x10).toString(16);
  const segment = (n: number) => Array.from({ length: n }, () => hex()).join('');
  // 版本位 4，变体位 8/9/a/b
  return (
    segment(8) +
    '-' +
    segment(4) +
    '-4' +
    segment(3) +
    '-' +
    '89ab'[Math.floor(Math.random() * 4)] +
    segment(3) +
    '-' +
    segment(12)
  );
}

/**
 * 行为包生成器（基岩版 Behavior Pack）。
 * 生成 manifest.json + entities/ + recipes/ + loot_tables/ 下的 JSON 文件。
 * 行为包是基岩版原版功能，不需 loader adapter。
 */
export class BehaviorPackGenerator implements Generator {
  readonly type = 'behavior_pack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = ctx.spec as unknown as BehaviorPackSpec;
    const files: FileNode[] = [];

    // manifest.json
    files.push(this.generateManifest(spec));

    // 实体行为定义
    for (const entity of spec.entities ?? []) {
      files.push(this.generateEntity(entity));
    }

    // 配方
    for (const recipe of spec.recipes ?? []) {
      files.push(this.generateRecipe(recipe));
    }

    // 战利品表
    for (const lootTable of spec.lootTables ?? []) {
      files.push(this.generateLootTable(lootTable));
    }

    return {
      files,
      warnings: [],
      buildCmd: '', // 行为包不需要编译
    };
  }

  private generateManifest(spec: BehaviorPackSpec): FileNode {
    const headerUuid = spec.header.uuid || generateUUID();
    const moduleUuid = generateUUID();

    const manifest = {
      format_version: spec.packFormat,
      header: {
        name: spec.header.name || spec.packName,
        description: spec.header.description || spec.description,
        uuid: headerUuid,
        version: spec.header.version || spec.mcVersion,
        min_engine_version: spec.header.min_engine_version || [1, 21, 0],
      },
      modules: [
        {
          type: 'data',
          uuid: moduleUuid,
          version: spec.header.version || spec.mcVersion,
        },
      ],
      dependencies: spec.dependencies,
    };

    return {
      path: 'manifest.json',
      content: JSON.stringify(manifest, null, 2),
    };
  }

  private generateEntity(entity: BpEntitySpec): FileNode {
    // identifier 格式: namespace:entity_id，提取 entity_id 作为文件名
    const id = entity.identifier.includes(':')
      ? entity.identifier.split(':')[1]
      : entity.identifier;

    const entityObj = {
      format_version: '1.21.0',
      'minecraft:entity': {
        description: {
          identifier: entity.identifier,
          is_spawnable: true,
          is_summonable: true,
          is_experimental: false,
        },
        components: entity.components,
      },
    };

    // 如果有 events，添加到 minecraft:entity
    if (Object.keys(entity.events).length > 0) {
      (entityObj as Record<string, unknown>)['minecraft:entity'] = {
        ...entityObj['minecraft:entity'],
        events: entity.events,
      };
    }

    return {
      path: `entities/${id}.json`,
      content: JSON.stringify(entityObj, null, 2),
    };
  }

  private generateRecipe(recipe: BpRecipeSpec): FileNode {
    // identifier 格式: namespace:recipe_id，提取 recipe_id 作为文件名
    const id = recipe.identifier.includes(':')
      ? recipe.identifier.split(':')[1]
      : recipe.identifier;

    let recipeObj: Record<string, unknown>;

    switch (recipe.type) {
      case 'shaped_crafting':
        recipeObj = {
          format_version: '1.21.0',
          'minecraft:recipe_shaped': {
            description: {
              identifier: recipe.identifier,
            },
            tags: ['crafting_table'],
            pattern: recipe.pattern ?? [],
            key: recipe.key ?? {},
            result: {
              item: recipe.result,
              count: recipe.count,
            },
          },
        };
        break;
      case 'shapeless_crafting':
        recipeObj = {
          format_version: '1.21.0',
          'minecraft:recipe_shapeless': {
            description: {
              identifier: recipe.identifier,
            },
            tags: ['crafting_table'],
            ingredients: (recipe.items ?? []).map((i) => ({ item: i })),
            result: {
              item: recipe.result,
              count: recipe.count,
            },
          },
        };
        break;
      case 'furnace':
        recipeObj = {
          format_version: '1.21.0',
          'minecraft:recipe_furnace': {
            description: {
              identifier: recipe.identifier,
            },
            tags: ['furnace'],
            input: recipe.items?.[0] ?? '',
            output: recipe.result,
          },
        };
        break;
    }

    return {
      path: `recipes/${id}.json`,
      content: JSON.stringify(recipeObj, null, 2),
    };
  }

  private generateLootTable(lootTable: BpLootTableSpec): FileNode {
    const lootObj = {
      format_version: '1.21.0',
      'minecraft:loot_table': {
        pools: lootTable.pools.map((p) => ({
          rolls: p.rolls,
          entries: p.entries.map((e) => ({
            type: e.type === 'item' ? 'minecraft:item' : `minecraft:${e.type}`,
            name: e.name,
            weight: e.weight,
            count: e.count,
          })),
        })),
      },
    };

    return {
      path: `loot_tables/${lootTable.path}.json`,
      content: JSON.stringify(lootObj, null, 2),
    };
  }
}
