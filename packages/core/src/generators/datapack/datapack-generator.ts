import type { FileNode, GeneratorContext, GenerationResult, Loader, McVersion } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type { DatapackSpec, RecipeSpec, TagSpec, FunctionSpec, AdvancementSpec } from '@mc-creator/shared';

/**
 * 数据包生成器（路线图第 3 阶段）。
 * 生成 pack.mcmeta + data/<namespace>/ 下的 JSON/mcfunction 文件。
 * 数据包是原版功能，不需 loader adapter。
 */
export class DatapackGenerator implements Generator {
  readonly type = 'datapack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = ['1.21.11', '1.21.1', '26.1'];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = ctx.spec as unknown as DatapackSpec;
    const files: FileNode[] = [];

    // pack.mcmeta
    files.push({
      path: 'pack.mcmeta',
      content: JSON.stringify({
        pack: {
          pack_format: spec.packFormat,
          description: spec.description || spec.packName,
        },
      }, null, 2),
    });

    // 配方
    for (const recipe of spec.recipes ?? []) {
      files.push(this.generateRecipe(spec.packId, recipe));
    }

    // 标签
    for (const tag of spec.tags ?? []) {
      files.push(this.generateTag(spec.packId, tag));
    }

    // 函数
    for (const func of spec.functions ?? []) {
      files.push(this.generateFunction(spec.packId, func));
    }

    // 进度
    for (const adv of spec.advancements ?? []) {
      files.push(this.generateAdvancement(spec.packId, adv));
    }

    return {
      files,
      warnings: [],
      buildCmd: '', // 数据包不需要编译
    };
  }

  private generateRecipe(namespace: string, r: RecipeSpec): FileNode {
    let recipeObj: Record<string, unknown>;

    switch (r.type) {
      case 'crafting_shaped':
        recipeObj = {
          type: 'minecraft:crafting_shaped',
          pattern: r.pattern ?? [],
          key: r.key ?? {},
          result: { id: r.result, count: r.count },
        };
        break;
      case 'crafting_shapeless':
        recipeObj = {
          type: 'minecraft:crafting_shapeless',
          ingredients: (r.ingredients ?? []).map((i) => ({ id: i })),
          result: { id: r.result, count: r.count },
        };
        break;
      case 'smelting':
        recipeObj = {
          type: 'minecraft:smelting',
          ingredient: { id: r.ingredients?.[0] ?? '' },
          result: r.result,
          experience: 0.1,
          cookingtime: 200,
        };
        break;
      case 'stonecutting':
        recipeObj = {
          type: 'minecraft:stonecutting',
          ingredient: { id: r.ingredients?.[0] ?? '' },
          result: r.result,
          count: r.count,
        };
        break;
    }

    return {
      path: `data/${namespace}/recipe/${r.id}.json`,
      content: JSON.stringify(recipeObj, null, 2),
    };
  }

  private generateTag(namespace: string, t: TagSpec): FileNode {
    return {
      path: `data/${namespace}/tags/${t.type}/${t.id}.json`,
      content: JSON.stringify({ replace: t.replace, values: t.values }, null, 2),
    };
  }

  private generateFunction(namespace: string, f: FunctionSpec): FileNode {
    return {
      path: `data/${namespace}/function/${f.id}.mcfunction`,
      content: f.commands.join('\n') + '\n',
    };
  }

  private generateAdvancement(namespace: string, a: AdvancementSpec): FileNode {
    const advObj = {
      display: {
        icon: { id: a.icon },
        title: a.title,
        description: a.description,
      },
      criteria: {
        trigger: {
          trigger: a.trigger,
          conditions: a.conditions ? JSON.parse(a.conditions) : {},
        },
      },
    };
    return {
      path: `data/${namespace}/advancement/${a.id}.json`,
      content: JSON.stringify(advObj, null, 2),
    };
  }
}
