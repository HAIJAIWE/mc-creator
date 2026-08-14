import { DataEnchantmentSpec, getPackFormatForMcVersion, MC_VERSIONS } from '@mc-creator/shared';
import type {
  DataEnchantmentSpec as DataEnchantmentSpecType,
  DataEnchantmentEntrySpec,
  DataEnchantmentEffectSpec,
} from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';

/** 支持数据驱动附魔的 MC 版本（1.21+） */
const SUPPORTED_VERSIONS: McVersion[] = ['1.21.1', '1.21.5', '1.21.11', '26.1', '26.2'];

/** 语义化效果 → 1.21 附魔效果组（effects 的 key） */
const EFFECT_GROUP: Record<DataEnchantmentEffectSpec['type'], string> = {
  damage_bonus: 'minecraft:damage',
  mob_experience: 'minecraft:mob_experience',
  loot_bonus: 'minecraft:loot_bonus',
  knockback: 'minecraft:knockback',
  burning_time: 'minecraft:post_attack',
  healing: 'minecraft:post_attack',
  attribute: 'minecraft:attribute',
};

/** 效果类型显示标签（用于生成中的警告信息） */
const EFFECT_LABEL: Record<DataEnchantmentEffectSpec['type'], string> = {
  damage_bonus: '伤害加成',
  mob_experience: '经验加成',
  loot_bonus: '战利品加成',
  knockback: '击退',
  burning_time: '火焰附加',
  healing: '吸取生命',
  attribute: '属性加成',
};

/**
 * EnchantmentGenerator：1.21+ 数据驱动附魔包生成器。
 *
 * 生成的数据包结构（兼容资源包，附魔名称走 assets lang 文件）：
 * - pack.mcmeta（pack_format 自动按 MC 版本映射）
 * - data/<ns>/enchantment/<id>.json（每个附魔一个数据驱动注册文件）
 * - assets/<ns>/lang/<locale>.json（自动生成名称/描述条目，用户 lang 可覆盖）
 *
 * 附魔 JSON 遵循 Minecraft 1.21 数据驱动附魔格式：
 * - supported_items / slots / weight / min_cost / max_cost / anvil_cost / max_level
 * - effects 按效果组聚合（minecraft:damage / minecraft:knockback / minecraft:attribute 等）
 *
 * 数据包无需编译，buildCmd 返回空字符串。
 */
export class EnchantmentGenerator implements Generator {
  readonly type = 'enchantment';
  readonly loaders: Loader[] = ['vanilla'];
  readonly versions: McVersion[] = [...SUPPORTED_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = DataEnchantmentSpec.parse(ctx.spec as unknown as DataEnchantmentSpecType);

    const files: FileNode[] = [];
    const warnings: string[] = [];

    // 数据驱动附魔仅支持 1.21+；低版本用户仍能生成，但提示兼容性
    if (!SUPPORTED_VERSIONS.includes(ctx.mcVersion as McVersion)) {
      warnings.push(
        `目标 MC 版本 ${ctx.mcVersion} 不支持数据驱动附魔（需 1.21+），生成的附魔 JSON 在低版本中不会生效`,
      );
    }

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

    // 每个附魔 → data/<ns>/enchantment/<id>.json
    for (const entry of spec.enchantments) {
      files.push({
        path: `data/${spec.packId}/enchantment/${entry.id}.json`,
        content: this.generateEnchantmentFile(spec, entry, warnings),
      });
    }

    // 语言文件（自动条目 + 用户覆盖）
    const langFiles = this.generateLangFiles(spec);
    for (const f of langFiles) {
      files.push(f);
    }

    if (spec.enchantments.length === 0) {
      warnings.push('未生成任何附魔：spec 中 enchantments 列表为空');
    }

    return {
      files,
      warnings,
      buildCmd: '', // 数据包无需编译
    };
  }

  /** 生成单个附魔的 JSON 内容 */
  private generateEnchantmentFile(
    spec: DataEnchantmentSpecType,
    entry: DataEnchantmentEntrySpec,
    warnings: string[],
  ): string {
    const effects = this.buildEffects(entry, warnings);

    let supportedItems: string | string[];
    if (entry.supportedItems.length > 0) {
      supportedItems =
        entry.supportedItems.length === 1 ? entry.supportedItems[0] : entry.supportedItems;
    } else {
      supportedItems = '#minecraft:enchantable/sharp_weapon';
      warnings.push(
        `附魔 ${entry.id} 未指定 supportedItems，已使用默认 '#minecraft:enchantable/sharp_weapon'`,
      );
    }

    const json: Record<string, unknown> = {
      anvil_cost: entry.anvilCost,
      description: { translate: `enchantment.${spec.packId}.${entry.id}` },
      max_cost: { base: entry.maxCostBase, per_level: entry.maxCostPerLevel },
      max_level: entry.maxLevel,
      min_cost: { base: entry.minCostBase, per_level: entry.minCostPerLevel },
      slots: entry.slots,
      supported_items: supportedItems,
      weight: entry.weight,
    };

    if (entry.exclusiveSet) {
      json.exclusive_set = entry.exclusiveSet;
    }
    if (Object.keys(effects).length > 0) {
      json.effects = effects;
    }

    return JSON.stringify(json, null, 2) + '\n';
  }

  /** 生成语言文件（自动条目 + 用户覆盖优先） */
  private generateLangFiles(spec: DataEnchantmentSpecType): FileNode[] {
    // 收集所有语言代码：自动生成 en_us / zh_cn + 用户 lang
    const locales = new Set(Object.keys(spec.lang));
    locales.add('en_us');
    locales.add('zh_cn');

    const files: FileNode[] = [];
    for (const locale of locales) {
      const entries: Record<string, string> = {};
      for (const e of spec.enchantments) {
        const key = `enchantment.${spec.packId}.${e.id}`;
        entries[key] = locale === 'zh_cn' ? e.name : e.name;
        if (e.description) {
          entries[`${key}.desc`] = e.description;
        }
      }
      // 用户覆盖（自动条目不覆盖用户显式指定）
      const userLang = spec.lang[locale] ?? {};
      files.push({
        path: `assets/${spec.packId}/lang/${locale}.json`,
        content: JSON.stringify({ ...entries, ...userLang }, null, 2) + '\n',
      });
    }
    return files;
  }

  /** 把语义化效果 + 自定义效果聚合为 1.21 effects 组 */
  private buildEffects(
    entry: DataEnchantmentEntrySpec,
    warnings: string[],
  ): Record<string, unknown[]> {
    const groups = new Map<string, unknown[]>();

    for (const fx of entry.effects) {
      const effect = this.effectToJson(fx, warnings);
      if (!effect) continue;
      const group = EFFECT_GROUP[fx.type];
      const list = groups.get(group) ?? [];
      list.push(effect);
      groups.set(group, list);
    }

    for (const custom of entry.customEffects) {
      const list = groups.get(custom.group) ?? [];
      list.push(custom.effect);
      groups.set(custom.group, list);
    }

    return Object.fromEntries(groups);
  }

  /** 语义化效果 → 1.21 effect JSON（null 表示需跳过并已记录 warning） */
  private effectToJson(
    fx: DataEnchantmentEffectSpec,
    warnings: string[],
  ): Record<string, unknown> | null {
    const amount = fx.amount;
    const base = typeof fx.extra.base === 'number' ? fx.extra.base : 0;

    switch (fx.type) {
      case 'damage_bonus': {
        const target =
          fx.target === 'all'
            ? { type: 'minecraft:mobs' }
            : { type: 'minecraft:tagged', tag: `minecraft:${fx.target}` };
        return {
          effect: {
            type: 'minecraft:damage_bonus',
            target,
            damage: {
              type: 'minecraft:add',
              value: { type: 'minecraft:linear', base, per_level: amount },
            },
          },
        };
      }
      case 'mob_experience':
        return {
          effect: {
            type: 'minecraft:mob_experience',
            value: { type: 'minecraft:linear', base: 0, per_level: amount },
          },
        };
      case 'loot_bonus': {
        const lootTable = typeof fx.extra.lootTable === 'string' ? fx.extra.lootTable : '';
        if (!lootTable) {
          warnings.push(
            `战利品加成效果缺少 extra.lootTable（如 "minecraft:entities/zombie"），已跳过`,
          );
          return null;
        }
        return {
          effect: {
            type: 'minecraft:loot_bonus',
            target: { type: 'minecraft:mobs' },
            loot_table: lootTable,
            value: { type: 'minecraft:uniform', base: 0, per_level: amount },
          },
        };
      }
      case 'knockback':
        return {
          effect: {
            type: 'minecraft:knockback',
            amplifier: { type: 'minecraft:linear', base: 0, per_level: amount },
          },
        };
      case 'burning_time':
        return {
          effect: {
            type: 'minecraft:burning_time',
            duration: {
              type: 'minecraft:multiply',
              factor: { type: 'minecraft:linear', base: 3, per_level: amount },
            },
          },
          enchanted: 'minecraft:attacker',
          affected: 'minecraft:attacker',
        };
      case 'healing':
        return {
          effect: {
            type: 'minecraft:healing',
            amount: { type: 'minecraft:linear', base: 1, per_level: amount },
          },
          enchanted: 'minecraft:attacker',
          affected: 'minecraft:attacker',
        };
      case 'attribute':
        return {
          effect: {
            type: 'minecraft:attribute',
            attribute:
              typeof fx.extra.attribute === 'string'
                ? fx.extra.attribute
                : 'minecraft:movement_speed',
            slot: typeof fx.extra.slot === 'string' ? fx.extra.slot : 'mainhand',
            amount: {
              type: 'minecraft:add',
              value: { type: 'minecraft:linear', base, per_level: amount },
            },
          },
        };
      default:
        warnings.push(
          `未识别的效果类型：${fx.type}（${EFFECT_LABEL[fx.type] ?? fx.type}），已跳过`,
        );
        return null;
    }
  }
}
