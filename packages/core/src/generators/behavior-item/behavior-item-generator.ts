import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import { BehaviorItemSpec, type BpItemEntrySpec } from '@mc-creator/shared';
import type { BehaviorItemSpec as BehaviorItemSpecType } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import {
  createBuffer,
  encodePng,
  toBase64,
  fillGradient,
  setPixel,
  hexToRgb,
  type PixelBuffer,
} from '../../utils/png-encoder.js';

/** 生成简单 UUID v4（基岩版 manifest 需要） */
function generateUUID(): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 工具等级 → 挖掘等级映射（基岩版 is_* 标签） */
const TOOL_LEVEL_TAGS = [
  '',
  'minecraft:is_wooden',
  'minecraft:is_stone',
  'minecraft:is_iron',
  'minecraft:is_diamond',
  'minecraft:is_netherite',
];

/** 盔甲栏位 → 可穿戴槽位 */
const ARMOR_SLOT: Record<string, string> = {
  head: 'slot.armor.head',
  chest: 'slot.armor.chest',
  legs: 'slot.armor.legs',
  feet: 'slot.armor.feet',
};

/**
 * BehaviorItemGenerator：基岩版行为包自定义物品生成器。
 *
 * 生成的数据包结构：
 * - manifest.json（基岩版行为包清单）
 * - items/<id>.json（minecraft:item 定义，format_version 1.21.0）
 * - textures/items/<id>.png（16x16 物品贴图，纯色/渐变自动生成）
 * - texts/zh_CN.lang 与 en_US.lang（物品名称本地化）
 *
 * 物品组件映射：
 * - 耐久 → minecraft:durability
 * - 攻击伤害/速度 → minecraft:damage / minecraft:speed
 * - 盔甲 → minecraft:armor + minecraft:wearable
 * - 工具 → minecraft:tool（挖掘规则 + 等级标签）
 * - 附魔 → minecraft:enchantable；发光 → minecraft:foil
 *
 * 行为包无需编译，buildCmd 返回空字符串。
 */
export class BehaviorItemGenerator implements Generator {
  readonly type = 'behavior_item';
  readonly loaders: Loader[] = ['vanilla'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = BehaviorItemSpec.parse(ctx.spec as unknown as BehaviorItemSpecType);

    const files: FileNode[] = [];
    const warnings: string[] = [];

    files.push(this.generateManifest(spec));

    for (const item of spec.items) {
      files.push({
        path: `items/${item.id}.json`,
        content: this.generateItemFile(spec, item, warnings),
      });
      files.push({
        path: `textures/items/${item.id}.png`,
        content: toBase64(this.generateItemTexture(item)),
      });
    }

    const langFiles = this.generateLangFiles(spec);
    for (const f of langFiles) {
      files.push(f);
    }

    if (spec.items.length === 0) {
      warnings.push('未生成任何物品：spec 中 items 列表为空');
    }

    return {
      files,
      warnings,
      buildCmd: '',
    };
  }

  /** 生成 manifest.json */
  private generateManifest(spec: BehaviorItemSpecType): FileNode {
    const headerUuid = spec.header.uuid || generateUUID();
    const moduleUuid = generateUUID();
    const version = spec.header.version ?? [1, 0, 0];
    const minEngine = spec.header.min_engine_version ?? spec.mcVersion;
    const manifest = {
      format_version: spec.packFormat,
      header: {
        name: spec.header.name || spec.packName,
        description: spec.header.description || spec.description || 'Custom Items Pack',
        uuid: headerUuid,
        version,
        min_engine_version: minEngine,
      },
      modules: [
        {
          type: 'data',
          uuid: moduleUuid,
          version,
        },
      ],
      dependencies: spec.dependencies,
    };
    return {
      path: 'manifest.json',
      content: JSON.stringify(manifest, null, 2) + '\n',
    };
  }

  /** 生成单个物品定义 items/<id>.json */
  private generateItemFile(
    spec: BehaviorItemSpecType,
    item: BpItemEntrySpec,
    warnings: string[],
  ): string {
    const components: Record<string, unknown> = {
      'minecraft:icon': { texture: item.id },
      'minecraft:max_stack_size': item.maxStackSize,
    };

    if (item.durability > 0) {
      components['minecraft:durability'] = { max_durability: item.durability };
    }
    if (item.attackDamage > 0) {
      components['minecraft:damage'] = { value: item.attackDamage };
    }
    if (item.attackSpeed > 0) {
      components['minecraft:speed'] = { value: item.attackSpeed };
    }
    if (item.armor) {
      components['minecraft:armor'] = { protection: item.armor.protection };
      components['minecraft:wearable'] = { slot: ARMOR_SLOT[item.armor.slot] };
      components['minecraft:repairable'] = { repair_items: [] };
    }
    if (item.tool) {
      const tool = item.tool;
      components['minecraft:tool'] = {
        rules: tool.tags.map((tag) => ({
          blocks: tag,
          correct_for_drops: true,
          speed: tool.efficiency,
        })),
      };
      const levelTag = TOOL_LEVEL_TAGS[tool.level];
      if (levelTag) {
        components['minecraft:tags'] = { tags: [levelTag] };
      }
    }
    if (item.enchantable > 0) {
      components['minecraft:enchantable'] = { value: item.enchantable };
    }
    if (item.foils) {
      components['minecraft:foil'] = {};
    }
    for (const custom of item.customComponents) {
      const key = Object.keys(custom)[0];
      if (key) {
        if (components[key] !== undefined) {
          warnings.push(`物品 ${item.id} 的 customComponents 覆盖了组件 ${key}`);
        }
        components[key] = custom[key];
      }
    }

    const json = {
      format_version: '1.21.0',
      'minecraft:item': {
        description: {
          identifier: `${spec.packId}:${item.id}`,
          category: item.category,
        },
        components,
      },
    };
    return JSON.stringify(json, null, 2) + '\n';
  }

  /** 生成 16x16 物品贴图：基色渐变 + 亮色描边 + 顶部高光 */
  private generateItemTexture(item: BpItemEntrySpec): Uint8Array {
    const buf = createBuffer(16, 16);
    const [r1, g1, b1] = hexToRgb(item.primaryColor);
    const [r2, g2, b2] = hexToRgb(item.secondaryColor || this.darken(item.primaryColor));
    fillGradient(buf, r1, g1, b1, r2, g2, b2);

    // 高光：左上 3x3 提亮
    const [hr, hg, hb] = hexToRgb(this.lighten(item.primaryColor));
    this.fillRect(buf, 1, 1, 3, 3, hr, hg, hb);

    // 描边：外框加深色
    const [er, eg, eb] = [Math.round(r2 * 0.6), Math.round(g2 * 0.6), Math.round(b2 * 0.6)];
    for (let x = 0; x < 16; x++) {
      setPixel(buf, x, 0, er, eg, eb);
      setPixel(buf, x, 15, er, eg, eb);
    }
    for (let y = 0; y < 16; y++) {
      setPixel(buf, 0, y, er, eg, eb);
      setPixel(buf, 15, y, er, eg, eb);
    }

    return encodePng(buf);
  }

  /** 生成语言文件（texts/zh_CN.lang 与 en_US.lang，.lang 键值对格式，用户 lang 覆盖优先） */
  private generateLangFiles(spec: BehaviorItemSpecType): FileNode[] {
    const files: FileNode[] = [];
    const linesFor = (locale: string): string[] => {
      const lines: string[] = [`## ${spec.packName || spec.packId}`, ''];
      const entries: Record<string, string> = {};
      for (const item of spec.items) {
        entries[`item.${spec.packId}:${item.id}`] = item.name;
      }
      // 用户覆盖（spec.lang 的 key 与自动条目一致时优先）
      const userLang = spec.lang[locale] ?? {};
      for (const [k, v] of Object.entries({ ...entries, ...userLang })) {
        lines.push(`${k}=${v}`);
      }
      return lines;
    };

    const zhLines = linesFor('zh_CN');
    files.push({
      path: 'texts/zh_CN.lang',
      content: zhLines.join('\n') + '\n',
    });
    files.push({
      path: 'texts/en_US.lang',
      content: linesFor('en_US').join('\n') + '\n',
    });
    return files;
  }

  private fillRect(
    buf: PixelBuffer,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
  ): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPixel(buf, x + dx, y + dy, r, g, b);
      }
    }
  }

  private darken(hex: string): string {
    const [r, g, b] = hexToRgb(hex);
    return rgbHex(Math.round(r * 0.6), Math.round(g * 0.6), Math.round(b * 0.6));
  }

  private lighten(hex: string): string {
    const [r, g, b] = hexToRgb(hex);
    return rgbHex(
      Math.min(255, Math.round(r + (255 - r) * 0.4)),
      Math.min(255, Math.round(g + (255 - g) * 0.4)),
      Math.min(255, Math.round(b + (255 - b) * 0.4)),
    );
  }
}

function rgbHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
