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
} from '../utils/png-encoder.js';
import { TextureSetError, merToHex, renderTextureSet } from '../texture-set/texture-set.js';

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
      // §6.4：只有声明了 pbr 才出 texture_set.json。
      // 不声明时**不给默认值也不猜** —— 产物就是「无材质信息的纯色贴图」，
      // 这与生成器此前的行为一致，不是回退。
      const pbrFile = this.generateTextureSet(item, warnings);
      if (pbrFile !== undefined) files.push(pbrFile);
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

  /**
   * 生成 `textures/items/<id>.texture_set.json`（§6.4 PBR 材质）。
   *
   * 三个要点，都来自官方 Texture Set 页面：
   * - MER 层通道映射 R=Metalness / G=Emissive / B=Roughness（见 merToHex）。
   * - `textureBasedObject: true` —— 物品是 texture-based object，
   *   官方 Caution 明说这类对象**不能用 heightmap、只能用 normal**，故这里只出 MER(+normal)。
   * - 引用的贴图必须同包存在：normal 若给的是外部名字，游戏会记 CONTENT_ERROR
   *   并**整份 texture_set 不生效**（静默失效最难查），故这里只透传不校验存在性，
   *   但把警告交给调用方。
   */
  private generateTextureSet(item: BpItemEntrySpec, warnings: string[]): FileNode | undefined {
    const pbr = item.pbr;
    if (pbr === undefined) return undefined;
    try {
      const content = renderTextureSet({
        name: item.id,
        textureBasedObject: true,
        // 物品贴图走 RTX / Vibrant Visuals 两条路都可能，用经典管线最保守：
        // 只出 MER（RTX 与 VV 都读），不出 MERS（VV 专属、RTX 忽略）。
        pipeline: 'vibrant_visuals',
        layers: {
          color: item.id,
          metalness_emissive_roughness: merToHex(pbr.metalness, pbr.emissive, pbr.roughness),
          ...(pbr.normal === undefined ? {} : { normal: pbr.normal }),
        },
      });
      if (pbr.normal !== undefined) {
        warnings.push(
          `物品 ${item.id} 的 texture_set 引用了法线贴图 ${pbr.normal}：` +
            '官方规定 texture_set 只能引用同一资源包内的贴图，请确认该 png 已随包产出，否则整份 texture_set 会失效',
        );
      }
      return {
        path: `textures/items/${item.id}.texture_set.json`,
        content,
      };
    } catch (e) {
      // 官方：非法 texture_set 会记 CONTENT_ERROR 且整份不被使用。
      // 宁可不出文件并给出原因，也不要落一份会被游戏静默丢弃的文件。
      if (e instanceof TextureSetError) {
        warnings.push(`物品 ${item.id} 的 PBR 定义非法，已跳过 texture_set.json：${e.message}`);
        return undefined;
      }
      throw e;
    }
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
