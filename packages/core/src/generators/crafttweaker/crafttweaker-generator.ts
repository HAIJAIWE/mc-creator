import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import { CraftTweakerSpec, MC_VERSIONS, getPackFormatForMcVersion } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type {
  CraftTweakerSpec as CraftTweakerSpecType,
  CraftTweakerRecipeSpec,
  CraftTweakerTagSpec,
  CraftTweakerEventSpec,
  CraftTweakerTooltipSpec,
} from '@mc-creator/shared';

/**
 * CraftTweaker 脚本生成器（ZenScript）。
 *
 * 生成 CraftTweaker mod 所需的目录结构：
 * - pack.mcmeta（pack_format 来自 spec.packFormat）
 * - scripts/recipes.zs（汇总所有 recipes，使用 recipes.addShaped() 等 API）
 * - scripts/tags.zs（汇总所有 tags，使用 <tag:items:...> 语法）
 * - scripts/events.zs（汇总所有 events，使用 events.onEvent() API）
 * - scripts/tooltips.zs（汇总所有 tooltips，使用 <item:id>.addTooltip() API）
 * - scripts/lang/en_us.zs 和 zh_cn.zs（语言条目，ZenScript 脚本形式）
 *
 * ZenScript 语法要点（与 JavaScript 不同）：
 * - 物品引用用尖括号：<minecraft:diamond>
 * - 标签引用：<tag:items:minecraft:my_tag>
 * - 事件回调：events.onPlayerLoggedIn(function(event as PlayerLoggedInEvent) { ... })
 *
 * CraftTweaker 脚本无需编译，buildCmd 返回空字符串。
 */
export class CraftTweakerGenerator implements Generator {
  readonly type = 'crafttweaker';
  readonly loaders: Loader[] = ['fabric', 'neoforge', 'quilt'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    // 运行时校验：确保 ctx.spec 是合法 CraftTweakerSpec
    const spec = CraftTweakerSpec.parse(ctx.spec as unknown as CraftTweakerSpecType);

    const files: FileNode[] = [];
    const warnings: string[] = [];

    // pack.mcmeta（pack_format 按 MC 版本自动映射）
    const packFormat = getPackFormatForMcVersion(ctx.mcVersion) ?? spec.packFormat;
    if (packFormat !== spec.packFormat) {
      warnings.push(
        `已按 MC 版本 ${ctx.mcVersion} 将 pack_format 从 ${spec.packFormat} 调整为 ${packFormat}（pack.mcmeta 与目标版本匹配）`,
      );
    }
    files.push({
      path: 'pack.mcmeta',
      content: JSON.stringify(
        {
          pack: {
            pack_format: packFormat,
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

    // 语言文件（.zs 形式）
    const langFiles = this.generateLangFiles(spec);
    for (const f of langFiles) {
      files.push(f);
    }

    if (files.length === 1) {
      warnings.push('未生成任何 CraftTweaker 脚本：spec 中所有列表字段均为空');
    }

    return {
      files,
      warnings,
      buildCmd: '', // CraftTweaker 脚本不需编译
    };
  }

  /** 生成 recipes.zs（汇总所有 recipes，使用 recipes.addShaped() 等 API） */
  private generateRecipesFile(spec: CraftTweakerSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 CraftTweaker 配方脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
    ];

    for (const recipe of spec.recipes) {
      lines.push(`// recipe: ${recipe.id}`);
      lines.push(this.generateRecipe(recipe));
      lines.push('');
    }

    return {
      path: 'scripts/recipes.zs',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 recipe → ZenScript recipes.addShaped() 等调用代码（无缩进） */
  private generateRecipe(r: CraftTweakerRecipeSpec): string {
    const resultItem = this.itemBracket(r.result);
    switch (r.type) {
      case 'shaped': {
        const pattern = r.pattern ?? [];
        const keyMap = r.key ?? {};
        // 将 pattern + key 转换为 2D 物品数组
        const grid: string[][] = [];
        for (const row of pattern) {
          const cells: string[] = [];
          for (const ch of row) {
            if (ch === ' ' || ch === '') {
              cells.push('null');
            } else {
              const items = keyMap[ch] ?? [];
              cells.push(items.length > 0 ? this.itemBracket(items[0]) : 'null');
            }
          }
          grid.push(cells);
        }
        const gridStr = grid.map((row) => `[${row.join(', ')}]`).join(',\n    ');
        // count 通过 :count 修饰产物
        const resultExpr = r.count > 1 ? `${resultItem}:${r.count}` : resultItem;
        return `recipes.addShaped(${resultExpr}, [\n    ${gridStr}\n]);`;
      }
      case 'shapeless': {
        const ingredients = (r.ingredients ?? []).map((i) => this.itemBracket(i)).join(', ');
        const resultExpr = r.count > 1 ? `${resultItem}:${r.count}` : resultItem;
        return `recipes.addShapeless(${resultExpr}, [${ingredients}]);`;
      }
      case 'smelting':
      case 'blasting':
      case 'smoking': {
        const ingredient = r.ingredients?.[0] ?? '';
        const inputItem = this.itemBracket(ingredient);
        // P37：xp/cookTime 有值时输出四参形式（furnace/blastFurnace/smoker）
        const extra =
          r.experience !== undefined || r.cookingTime !== undefined
            ? `, ${r.experience ?? 0}, ${r.cookingTime ?? 200}`
            : '';
        const api =
          r.type === 'blasting' ? 'blastFurnace' : r.type === 'smoking' ? 'smoker' : 'furnace';
        return `${api}.addRecipe(${resultItem}, ${inputItem}${extra});`;
      }
      case 'stonecutting': {
        const ingredient = r.ingredients?.[0] ?? '';
        const inputItem = this.itemBracket(ingredient);
        const resultExpr = r.count > 1 ? `${resultItem}:${r.count}` : resultItem;
        return `stoneCutter.addRecipe(${resultExpr}, ${inputItem});`;
      }
      case 'custom': {
        return r.customCode ?? '// custom recipe (no customCode provided)';
      }
      default:
        return '// unknown recipe type';
    }
  }

  /** 生成 tags.zs（汇总所有 tags，使用 <tag:items:...> 语法） */
  private generateTagsFile(spec: CraftTweakerSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 CraftTweaker 标签脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
    ];

    for (const tag of spec.tags) {
      lines.push(this.generateTag(tag));
      lines.push('');
    }

    return {
      path: 'scripts/tags.zs',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 tag → ZenScript <tag:items:...> 操作代码 */
  private generateTag(t: CraftTweakerTagSpec): string {
    const lines: string[] = [`// tag: ${t.id} (${t.type})`];
    const tagBracket = this.tagBracket(t.type, t.id);
    if (t.replace) {
      lines.push(`${tagBracket}.removeAll();`);
    }
    for (const v of t.values) {
      lines.push(`${tagBracket}.add(${this.itemBracket(v)});`);
    }
    return lines.join('\n');
  }

  /** 生成 events.zs（汇总所有 events，按 type 路由到对应事件 API） */
  private generateEventsFile(spec: CraftTweakerSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 CraftTweaker 事件脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
    ];

    for (const evt of spec.events) {
      lines.push(this.generateEvent(evt));
      lines.push('');
    }

    return {
      path: 'scripts/events.zs',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 event → ZenScript events.onXxx() 监听代码 */
  private generateEvent(e: CraftTweakerEventSpec): string {
    // 按 type 拆分：'player.logged_in' → events.onPlayerLoggedIn
    const parts = e.type.split('.');
    const handlerBody = e.handler
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');

    let eventName: string;
    let eventType: string;
    if (parts.length === 2) {
      const [scope, action] = parts;
      const scopePascal = scope.charAt(0).toUpperCase() + scope.slice(1);
      const actionCamel = action
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      eventName = `${scopePascal}${actionCamel}`;
      eventType = `${eventName}Event`;
    } else {
      // 简单事件名直接用 LevelEvent 等价
      const actionCamel = e.type
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      eventName = actionCamel;
      eventType = `${actionCamel}Event`;
    }

    const targetComment = e.target ? `// target: ${e.target}\n` : '';
    return `${targetComment}events.on${eventName}(function(event as ${eventType}) {
${handlerBody}
});`;
  }

  /** 生成 tooltips.zs（汇总所有 tooltips，使用 <item:id>.addTooltip() API） */
  private generateTooltipsFile(spec: CraftTweakerSpecType): FileNode {
    const lines: string[] = [
      '// 自动生成的 CraftTweaker 工具提示脚本',
      `// pack: ${spec.packName} (${spec.packId})`,
      '',
    ];

    for (const tip of spec.tooltips) {
      lines.push(this.generateTooltip(tip));
      lines.push('');
    }

    return {
      path: 'scripts/tooltips.zs',
      content: lines.join('\n') + '\n',
    };
  }

  /** 单个 tooltip → <item:id>.addTooltip() 调用代码 */
  private generateTooltip(t: CraftTweakerTooltipSpec): string {
    const lines: string[] = [`// tooltip: ${t.itemId}`];
    const itemBracket = this.itemBracket(t.itemId);
    for (const line of t.lines) {
      const escaped = line.replace(/"/g, '\\"');
      if (t.advanced) {
        lines.push(`// advanced tooltip`);
        lines.push(`${itemBracket}.addAdvancedTooltip("${escaped}");`);
      } else {
        lines.push(`${itemBracket}.addTooltip("${escaped}");`);
      }
    }
    return lines.join('\n');
  }

  /** 生成语言文件（.zs 形式，按语言代码 → 键值对） */
  private generateLangFiles(spec: CraftTweakerSpecType): FileNode[] {
    const files: FileNode[] = [];
    const lang = spec.lang ?? {};
    for (const [locale, entries] of Object.entries(lang)) {
      const lines: string[] = [
        `// 自动生成的 CraftTweaker 语言脚本（${locale}）`,
        `// pack: ${spec.packName} (${spec.packId})`,
        '// 注：CraftTweaker 通过资源包注册语言，此文件记录翻译条目供参考',
        '',
      ];
      for (const [key, value] of Object.entries(entries)) {
        const escapedValue = value.replace(/"/g, '\\"');
        lines.push(`// ${key} = "${escapedValue}"`);
      }
      files.push({
        path: `scripts/lang/${locale}.zs`,
        content: lines.join('\n') + '\n',
      });
    }
    return files;
  }

  /** 物品 ID → ZenScript 物品引用 <minecraft:diamond> */
  private itemBracket(itemId: string): string {
    return `<${itemId}>`;
  }

  /** 标签 → ZenScript 标签引用 <tag:items:minecraft:my_tag> */
  private tagBracket(type: string, id: string): string {
    // type 已为单数形式（item/block/entity_type/fluid），ZenScript tag 用复数
    const pluralType = type === 'entity_type' ? 'entity_types' : `${type}s`;
    return `<tag:${pluralType}:minecraft:${id}>`;
  }
}
