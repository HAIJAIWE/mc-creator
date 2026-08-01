import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import { KubejsSpec } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type {
  KubejsSpec as KubejsSpecType,
  KubejsRecipeSpec,
  KubejsTagSpec,
  KubejsEventSpec,
  KubejsTooltipSpec,
  KubejsRegistrySpec,
} from '@mc-creator/shared';

/**
 * KubeJS 脚本生成器。
 *
 * 生成 KubeJS mod 所需的目录结构：
 * - pack.mcmeta（pack_format 来自 spec.packFormat）
 * - kubejs/server_scripts/recipes.js（汇总所有 recipes，使用 ServerEvents.recipes）
 * - kubejs/server_scripts/tags.js（汇总所有 tags，使用 ServerEvents.tags）
 * - kubejs/server_scripts/events.js（汇总所有 events，使用 LevelEvents / BlockEvents 等）
 * - kubejs/client_scripts/tooltips.js（汇总所有 tooltips，使用 ItemEvents.tooltip）
 * - kubejs/startup_scripts/registry.js（汇总所有 registry，使用 StartupEvents.registry）
 * - kubejs/assets/kubejs/lang/en_us.json 和 zh_cn.json
 *
 * KubeJS 脚本无需编译，buildCmd 返回空字符串。
 */
export class KubejsGenerator implements Generator {
  readonly type = 'kubejs';
  readonly loaders: Loader[] = ['fabric', 'neoforge', 'quilt'];
  readonly versions: McVersion[] = ['1.21.11', '1.21.1', '26.1', '26.2'];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    // 运行时校验：确保 ctx.spec 是合法 KubejsSpec
    const spec = KubejsSpec.parse(ctx.spec as unknown as KubejsSpecType);

    const files: FileNode[] = [];
    const warnings: string[] = [];

    // pack.mcmeta
    files.push({
      path: 'pack.mcmeta',
      content: JSON.stringify(
        {
          pack: {
            pack_format: spec.packFormat,
            description: spec.description || spec.packName,
          },
        },
        null,
        2,
      ),
    });

    // 配方脚本（汇总）
    if (spec.recipes.length > 0) {
      files.push(this.generateRecipesFile(spec));
    }

    // 标签脚本（汇总）
    if (spec.tags.length > 0) {
      files.push(this.generateTagsFile(spec));
    }

    // 事件脚本（汇总）
    if (spec.events.length > 0) {
      files.push(this.generateEventsFile(spec));
    }

    // 工具提示脚本（汇总）
    if (spec.tooltips.length > 0) {
      files.push(this.generateTooltipsFile(spec));
    }

    // 注册表脚本（汇总）
    if (spec.registry.length > 0) {
      files.push(this.generateRegistryFile(spec));
    }

    // 语言文件
    const langFiles = this.generateLangFiles(spec);
    for (const f of langFiles) {
      files.push(f);
    }

    if (files.length === 1) {
      warnings.push('未生成任何 KubeJS 脚本：spec 中所有列表字段均为空');
    }

    return {
      files,
      warnings,
      buildCmd: '', // KubeJS 脚本不需编译
    };
  }

  /** 生成 recipes.js（汇总所有 recipes，使用 ServerEvents.recipes） */
  private generateRecipesFile(spec: KubejsSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 KubeJS 配方脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
      'ServerEvents.recipes(event => {',
    ];

    for (const recipe of spec.recipes) {
      lines.push(`  // recipe: ${recipe.id}`);
      lines.push(this.generateRecipe(recipe));
    }

    lines.push('});');
    return {
      path: 'kubejs/server_scripts/recipes.js',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 recipe → KubeJS event.recipes() 调用代码（已缩进 2 空格） */
  private generateRecipe(r: KubejsRecipeSpec): string {
    // P36：count > 1 时产物用 KubeJS 数量语法 '4x minecraft:stick'
    const resultExpr = r.count > 1 ? `${r.count}x ${r.result}` : r.result;
    // P36：烧炼类配方 xp/cookingTime 链式调用（有值才链）
    const cookingChain = this.cookingChain(r);
    switch (r.type) {
      case 'shaped': {
        const pattern = r.pattern ?? [];
        const keyObj: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.key ?? {})) {
          keyObj[k] = v[0] ?? '';
        }
        return `  event.shaped('${resultExpr}', ${JSON.stringify(pattern)}, ${JSON.stringify(keyObj)
          .replace(/"([^"]+)":/g, '$1:')
          .replace(/"/g, "'")})${cookingChain};`;
      }
      case 'shapeless': {
        const ingredients = (r.ingredients ?? []).map((i) => `'${i}'`).join(', ');
        return `  event.shapeless('${resultExpr}', [${ingredients}])${cookingChain};`;
      }
      case 'smelting':
      case 'blasting':
      case 'smoking': {
        const ingredient = r.ingredients?.[0] ?? '';
        return `  event.${r.type}('${resultExpr}', '${ingredient}')${cookingChain};`;
      }
      case 'stonecutting': {
        const ingredient = r.ingredients?.[0] ?? '';
        return `  event.stonecutting('${r.result}', '${ingredient}').count(${r.count});`;
      }
      case 'custom': {
        return r.customCode
          ? r.customCode
              .split('\n')
              .map((l) => `  ${l}`)
              .join('\n')
          : '  // custom recipe (no customCode provided)';
      }
      default:
        return '  // unknown recipe type';
    }
  }

  /** P36：烧炼类配方（smelting/blasting/smoking）的 xp/cookingTime 链式后缀 */
  private cookingChain(r: KubejsRecipeSpec): string {
    let chain = '';
    if (r.experience !== undefined) {
      chain += `.xp(${r.experience})`;
    }
    if (r.cookingTime !== undefined) {
      chain += `.cookingTime(${r.cookingTime})`;
    }
    return chain;
  }

  /** 生成 tags.js（汇总所有 tags，使用 ServerEvents.tags） */
  private generateTagsFile(spec: KubejsSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 KubeJS 标签脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
      'ServerEvents.tags(event => {',
    ];

    for (const tag of spec.tags) {
      lines.push(this.generateTag(tag));
    }

    lines.push('});');
    return {
      path: 'kubejs/server_scripts/tags.js',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 tag → event.add() 调用代码（已缩进 2 空格） */
  private generateTag(t: KubejsTagSpec): string {
    const lines: string[] = [`  // tag: ${t.id} (${t.type})`];
    if (t.replace) {
      lines.push(`  event.removeAll('${t.type}/${t.id}');`);
    }
    for (const v of t.values) {
      lines.push(`  event.add('${t.type}/${t.id}', '${v}');`);
    }
    return lines.join('\n');
  }

  /** 生成 events.js（汇总所有 events，按 type 路由到对应事件 API） */
  private generateEventsFile(spec: KubejsSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 KubeJS 事件脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
    ];

    for (const evt of spec.events) {
      lines.push(this.generateEvent(evt));
      lines.push('');
    }

    return {
      path: 'kubejs/server_scripts/events.js',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 event → 对应事件 API 监听代码 */
  private generateEvent(e: KubejsEventSpec): string {
    // 按 type 拆分：'block.right_click' → BlockEvents.rightClick
    const parts = e.type.split('.');
    const handlerBody = e.handler
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');

    if (parts.length === 2) {
      const [scope, action] = parts;
      const scopePascal = scope.charAt(0).toUpperCase() + scope.slice(1);
      const actionCamel = action
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      const eventName = `${scopePascal}Events.${actionCamel}`;
      if (e.target) {
        return [`${eventName}('${e.target}', event => {`, handlerBody, '});'].join('\n');
      }
      return [`LevelEvents.${actionCamel}(event => {`, handlerBody, '});'].join('\n');
    }

    // 简单事件名直接用 LevelEvents
    return [`LevelEvents.${e.type}(event => {`, handlerBody, '});'].join('\n');
  }

  /** 生成 tooltips.js（汇总所有 tooltips，使用 ItemEvents.tooltip） */
  private generateTooltipsFile(spec: KubejsSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 KubeJS 工具提示脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
      'ItemEvents.tooltip(event => {',
    ];

    for (const tip of spec.tooltips) {
      lines.push(this.generateTooltip(tip));
    }

    lines.push('});');
    return {
      path: 'kubejs/client_scripts/tooltips.js',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 tooltip → event.add() 调用代码（已缩进 2 空格） */
  private generateTooltip(t: KubejsTooltipSpec): string {
    const lines: string[] = [`  // tooltip: ${t.itemId}`];
    for (const line of t.lines) {
      const escaped = line.replace(/'/g, "\\'");
      if (t.advanced) {
        lines.push(`  event.addAdvanced('${t.itemId}', (item, advanced, text) => {`);
        lines.push(`    text.add('${escaped}');`);
        lines.push(`  });`);
      } else {
        lines.push(`  event.add('${t.itemId}', '${escaped}');`);
      }
    }
    return lines.join('\n');
  }

  /** 生成 registry.js（汇总所有 registry，使用 StartupEvents.registry） */
  private generateRegistryFile(spec: KubejsSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 KubeJS 注册表脚本（启动脚本）',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
      'StartupEvents.registry(event => {',
    ];

    for (const r of spec.registry) {
      lines.push(this.generateRegistry(r));
    }

    lines.push('});');
    return {
      path: 'kubejs/startup_scripts/registry.js',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 registry 条目 → event.create() 调用代码（已缩进 2 空格） */
  private generateRegistry(r: KubejsRegistrySpec): string {
    const lines: string[] = [`  // registry: ${r.id} (${r.type})`];
    if (r.type === 'item') {
      for (const item of r.items) {
        lines.push(`  event.create('${item}');`);
      }
    } else if (r.type === 'block') {
      for (const block of r.blocks.length > 0 ? r.blocks : r.items) {
        lines.push(`  event.create('${block}').material('rock');`);
      }
    } else if (r.type === 'fluid') {
      for (const item of r.items) {
        lines.push(`  event.create('${item}').fluid();`);
      }
    } else if (r.type === 'sound') {
      for (const item of r.items) {
        lines.push(`  event.create('${item}'); // sound event`);
      }
    }

    if (r.customCode) {
      lines.push(
        r.customCode
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
      );
    }
    return lines.join('\n');
  }

  /** 生成语言文件（en_us.json + zh_cn.json） */
  private generateLangFiles(spec: KubejsSpecType): FileNode[] {
    const files: FileNode[] = [];
    const lang = spec.lang ?? {};
    for (const [locale, entries] of Object.entries(lang)) {
      files.push({
        path: `kubejs/assets/kubejs/lang/${locale}.json`,
        content: JSON.stringify(entries, null, 2),
      });
    }
    return files;
  }
}
