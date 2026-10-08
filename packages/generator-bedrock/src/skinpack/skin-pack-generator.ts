import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import {
  CAPE_TEXTURE_SIZE,
  MC_VERSIONS,
  SKIN_GEOMETRY_IDS,
  SKINPACK_HD_PERSONA_UNRESOLVED_REASON,
  SkinPackSpec,
  type SkinPackEntrySpec,
  type SkinPackSpec as SkinPackSpecType,
  type SkinGeometry,
} from '@mc-creator/shared';
import type { Generator } from '../types.js';
import {
  createBuffer,
  encodePng,
  fillSolid,
  hexToRgb,
  setPixel,
  toBase64,
  type PixelBuffer,
} from '../utils/png-encoder.js';
import { layoutFor, type BodyPart, type PartLayout, type SkinModel } from '@mc-creator/shared';

/**
 * geometry → UV 布局的 model。
 *
 * 官方原文（`SkinPackJSONReference.md` 的 `geometry` 字段）：
 * - `geometry.humanoid.custom` —— Standard Steve model（**4px arm width**）
 * - `geometry.humanoid.customSlim` —— Alex model（**3px arm width**）
 *
 * `skin-layout.ts` 的 model 正是按臂宽区分的 `classic`（4px）/ `slim`（3px），
 * 且用官方「每层可用像素数 1632 / 1568」自校验 —— 与上面的臂宽描述互为印证。
 * 这个映射是**官方文本的直接对应**，不是推测。
 */
const GEOMETRY_TO_MODEL: Record<SkinGeometry, SkinModel> = {
  custom: 'classic',
  customSlim: 'slim',
};

/** 生成 UUID v4（基岩 manifest 需要） */
function generateUUID(): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 把颜色整体调暗（用于轮廓/阴影层），ratio 0..1 */
function shade(rgb: [number, number, number], ratio: number): [number, number, number] {
  return [Math.round(rgb[0] * ratio), Math.round(rgb[1] * ratio), Math.round(rgb[2] * ratio)];
}

/**
 * SkinPackGenerator：基岩皮肤包生成器（§6.4 skinpack）。
 *
 * 此前仓内**没有**独立 skinpack 生成器 ——
 * `packages/kernel-bedrock/src/kernel.ts:298` 自注：
 * 「skinpack 当前兜底到 behavior_entity 生成器：仓内暂无独立 skinpack 生成器
 * （skins.json + Persona/HD 字段见 §6.4 / §21）」。
 * §21 第 1 条已核实（见 shared/src/schemas/skin-pack-spec.ts 文件头），
 * 权威 schema 与强制校验规则齐备，故本生成器补上这个缺口。
 *
 * 产物结构：
 * - `manifest.json` —— 模块类型 `skin_pack`，**不含 `min_engine_version`**
 *   （官方 manifest 示例里 skin pack 就没有该字段，且 §6.2 import-gateway
 *   已把「skin pack 允许省略 min_engine_version」作为判定）
 * - `skins.json` —— `serialize_name` / `localization_name` / `skins[]`
 * - `textures/<texture>.png` —— 每个皮肤一张，按 **官方 UV 布局**逐区域填色
 * - `textures/<cape>.png` —— 披风，固定 64×32（CSPJ106）
 * - `texts/en_US.lang` + `texts/zh_CN.lang`
 *
 * ## 为什么贴图要按官方 UV 逐区域填色，而不是整张纯色
 *
 * 官方 CSPJ117（Warning）：「slim 臂模型的外层要有实际像素覆盖」。整张纯色虽然
 * 不触发 Error，但用户看到的是一张没有任何结构的图，无法判断哪个区域对应哪里。
 *
 * 这里用 `shared/validation/skin-layout.ts` 的官方布局
 * （每层可用像素数必须精确等于官方 1632 / 1568 / 6528 / 6272 —— 那是该文件的
 * 机器可判判据），把内层每个部位的每个面都填上颜色。
 *
 * ## 明确未实现
 *
 * HD / Persona 字段：**不做**，原因见 `SKINPACK_HD_PERSONA_UNRESOLVED_REASON`
 * （官方 CSPJ108「Creator Only」限制，公开文档未提供字段定义）。
 */
export class SkinPackGenerator implements Generator {
  readonly type = 'skinpack';
  readonly loaders: Loader[] = ['vanilla'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = SkinPackSpec.parse(ctx.spec as unknown as SkinPackSpecType);

    const files: FileNode[] = [];
    const warnings: string[] = [];

    files.push(this.generateManifest(spec));
    files.push(this.generateSkinsJson(spec));

    // CSPJ116（Error）：单包最多 80。schema 已挡住，这里再兜一层以便给出可读告警。
    if (spec.skins.length > 80) {
      warnings.push(
        `皮肤数量 ${spec.skins.length} 超过官方上限 80（CSPJ116 Error），请拆分为多个皮肤包`,
      );
    }

    // CSPJ105（Warning）：重复贴图。重复会导致两个皮肤显示同一张图。
    const usedTextures = new Set<string>();
    for (const skin of spec.skins) {
      const texture = skin.texture ?? skin.skinKey;
      if (usedTextures.has(texture)) {
        warnings.push(
          `皮肤「${skin.skinKey}」与前面的皮肤共用贴图 ${texture}.png` +
            `（CSPJ105 Duplicate Texture，官方建议每个皮肤使用独立贴图）`,
        );
      }
      usedTextures.add(texture);
      files.push({
        path: `textures/${texture}.png`,
        content: toBase64(encodePng(this.renderSkinTexture(skin, spec.textureSize))),
      });
    }

    // CSPJ106（Error）：披风固定 64×32，不接受其它尺寸（所以 schema 里没有尺寸字段）。
    if (spec.cape) {
      files.push({
        path: `textures/${spec.cape.capeKey}.png`,
        content: toBase64(encodePng(this.renderCapeTexture(spec.cape.color))),
      });
    }

    for (const f of this.generateLangFiles(spec)) files.push(f);

    if (spec.skins.length === 0 && spec.cape === undefined) {
      warnings.push(
        '未生成任何皮肤或披风：spec 中 skins 与 cape 均为空（产出的皮肤包不会被游戏识别到内容）',
      );
    }

    for (const skin of spec.skins) {
      if (skin.type === 'paid') {
        warnings.push(
          `皮肤「${skin.skinKey}」标记为 type: paid —— 该字段用于官方 marketplace 内容，` +
            `第三方皮肤包应使用 free，否则玩家无法正常获取`,
        );
      }
    }

    warnings.push(SKINPACK_HD_PERSONA_UNRESOLVED_REASON);

    return { files, warnings, buildCmd: '' };
  }

  /**
   * `manifest.json`。
   *
   * 两点都来自官方（`SkinPackJSONReference.md` 的 manifest 示例）：
   * - 模块类型是 `skin_pack`（不是 behavior/resource 用的 `data`/`resources`）
   * - **没有 `min_engine_version`** —— 官方示例里 skin pack 的 header 只有
   *   name/description/uuid/version。这与 §6.2 import-gateway 的判定一致
   *   （skin pack / world template 允许省略该字段）。
   *
   * 所以这里**不**像其他基岩生成器那样回落到 `spec.mcVersion`。
   */
  private generateManifest(spec: SkinPackSpecType): FileNode {
    const version = spec.version;
    const manifest = {
      format_version: spec.packFormat,
      header: {
        name: spec.packName,
        description: spec.description || `${spec.packName} (skin pack)`,
        uuid: spec.headerUuid || generateUUID(),
        version,
      },
      modules: [
        {
          type: 'skin_pack',
          uuid: generateUUID(),
          version,
        },
      ],
    };
    return { path: 'manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' };
  }

  /**
   * `skins.json`。
   *
   * CSPJ103（Error）：`localization_name` 与 `serialize_name` **必须相同**。
   * 这里两者都取 `spec.serializeName` —— 结构上不可能不一致
   * （schema 只提供 serializeName 一个字段，见 schema 文件头说明）。
   */
  private generateSkinsJson(spec: SkinPackSpecType): FileNode {
    const skins = spec.skins.map((skin) => ({
      localization_name: skin.skinKey,
      geometry: SKIN_GEOMETRY_IDS[skin.geometry],
      texture: `${skin.texture ?? skin.skinKey}.png`,
      type: skin.type,
    }));
    if (spec.cape) {
      // 官方把披风也放进 skins[]，geometry 用 custom（披风不区分 slim）。
      skins.push({
        localization_name: spec.cape.capeKey,
        geometry: SKIN_GEOMETRY_IDS.custom,
        texture: `${spec.cape.capeKey}.png`,
        type: 'free',
      });
    }
    const doc = {
      serialize_name: spec.serializeName,
      localization_name: spec.serializeName,
      skins,
    };
    return { path: 'skins.json', content: JSON.stringify(doc, null, 2) + '\n' };
  }

  /**
   * 皮肤贴图：按官方 UV 布局逐区域填色。
   *
   * - 内层用 `primaryColor`，头部与四肢用 `secondaryColor`（缺省由主色推导），
   *   面部（head front）再画一对眼睛 + 嘴部，让产物肉眼可辨。
   * - **不画第二层（帽子/外套）**：官方未公开第二层逐面 UV 坐标，
   *   `skin-layout.ts` 只对 head 给出了 outer，其余部位留 undefined 并附原因
   *   （那里有完整推导，说明在 64×64 内推导会自相矛盾）。不猜。
   */
  private renderSkinTexture(skin: SkinPackEntrySpec, size: 64 | 128): PixelBuffer {
    const buf = createBuffer(size, size);
    fillSolid(buf, 0, 0, 0, 0); // 全透明起步：未覆盖区域保持透明

    const model = GEOMETRY_TO_MODEL[skin.geometry];
    const layout: Record<BodyPart, PartLayout> = layoutFor(size, model);

    const primary = hexToRgb(skin.primaryColor);
    const secondary = hexToRgb(
      skin.secondaryColor ??
        `#${primary
          .map((c) =>
            Math.min(255, Math.round(c * 1.35))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`,
    );

    // 内层各部位：头与四肢用辅色，躯干用主色
    const partColor: Record<BodyPart, [number, number, number]> = {
      head: secondary,
      body: primary,
      right_arm: secondary,
      left_arm: secondary,
      right_leg: shade(primary, 0.85),
      left_leg: shade(primary, 0.85),
    };

    for (const part of Object.keys(partColor) as BodyPart[]) {
      const partLayout = layout[part];
      // PartFaces 是 Record<FaceId, UvRect>，个别面可能是 undefined（未解析）
      for (const face of Object.values(partLayout.inner)) {
        if (face === undefined) continue; // 未解析的面，跳过而非瞎填
        this.fillRect(buf, face.x, face.y, face.width, face.height, partColor[part]);
      }
    }

    this.drawFace(buf, layout.head, skin.primaryColor);
    return buf;
  }

  /**
   * 脸部细节：在头部正面画眼睛与嘴。
   *
   * 用的是「头部正面在 UV 里的矩形」这一官方布局事实，而不是硬编码坐标 ——
   * 换 128×128 时布局表已 ×2 放大，无需改这里的坐标。
   */
  private drawFace(buf: PixelBuffer, head: PartLayout, primaryHex: string): void {
    const front = head.inner.front;
    if (front === undefined) return;
    const eye = shade(hexToRgb(primaryHex), 0.25);
    const mouth = shade(hexToRgb(primaryHex), 0.45);
    const eyeY = front.y + Math.floor(front.height * 0.45);
    const eyeDx = Math.max(1, Math.round(front.width * 0.22));
    const eyeW = Math.max(1, Math.round(front.width * 0.12));
    const eyeH = Math.max(1, Math.round(front.height * 0.1));
    // 双眼
    this.fillRect(buf, front.x + eyeDx, eyeY, eyeW, eyeH, eye);
    this.fillRect(buf, front.x + front.width - eyeDx - eyeW, eyeY, eyeW, eyeH, eye);
    // 嘴
    const mouthW = Math.max(1, Math.round(front.width * 0.4));
    this.fillRect(
      buf,
      front.x + Math.round((front.width - mouthW) / 2),
      front.y + Math.round(front.height * 0.68),
      mouthW,
      Math.max(1, Math.round(front.height * 0.08)),
      mouth,
    );
  }

  /**
   * 披风贴图：固定 64×32（CSPJ106）。
   *
   * 官方披风布局未在文档中给出逐面坐标表，故这里**只填一整块颜色**，
   * 不编造 UV 分区 —— 尺寸合法、颜色可见，不臆造结构。
   */
  private renderCapeTexture(color: string): PixelBuffer {
    const buf = createBuffer(CAPE_TEXTURE_SIZE.width, CAPE_TEXTURE_SIZE.height);
    const [r, g, b] = hexToRgb(color);
    fillSolid(buf, r, g, b, 255);
    return buf;
  }

  private fillRect(
    buf: PixelBuffer,
    x: number,
    y: number,
    w: number,
    h: number,
    rgb: [number, number, number],
  ): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPixel(buf, x + dx, y + dy, rgb[0], rgb[1], rgb[2], 255);
      }
    }
  }

  /**
   * 本地化文件。
   *
   * CSPJ111（Error）：skins.json 用到的每个键都必须在 lang 文件里有对应条目。
   * 所以这里对每个皮肤无条件产出 `skin.{serializeName}.{skinKey}` 条目 ——
   * 哪怕 `lang` 里没给译文，也用 `displayName` 兜底，绝不留下缺失的键。
   *
   * CSPJ112（Warning）：lang 里多余的键给告警。
   * CSPJ113（Error）：键不得有首尾空白 —— schema 的 IDENTIFIER 正则已保证。
   */
  private generateLangFiles(spec: SkinPackSpecType): FileNode[] {
    const en: string[] = [];
    en.push(`skinpack.${spec.serializeName}=${spec.packName}`);
    if (spec.packAuthor) en.push(`skinpack.${spec.serializeName}.by=${spec.packAuthor}`);

    const usedKeys = new Set<string>();
    for (const skin of spec.skins) {
      usedKeys.add(skin.skinKey);
      en.push(`skin.${spec.serializeName}.${skin.skinKey}=${skin.displayName}`);
    }
    if (spec.cape) {
      usedKeys.add(spec.cape.capeKey);
      en.push(`skin.${spec.serializeName}.${spec.cape.capeKey}=Cape`);
    }

    const files: FileNode[] = [{ path: 'texts/en_US.lang', content: en.join('\n') + '\n' }];

    for (const [locale, table] of Object.entries(spec.lang)) {
      const lines: string[] = [];
      // CSPJ111：只要 skins.json 引用了某个皮肤，该 locale 文件里就得有它的键。
      // 缺译文时回落到 displayName，而不是留空键（空值会被游戏显示成键名本身）。
      for (const skin of spec.skins) {
        const t = table[skin.skinKey];
        if (t !== undefined && t.trim() === '') continue; // 空串视为未提供
        lines.push(`skin.${spec.serializeName}.${skin.skinKey}=${t ?? skin.displayName}`);
      }
      if (spec.cape) {
        const t = table[spec.cape.capeKey];
        if (t !== undefined && t.trim() !== '') {
          lines.push(`skin.${spec.serializeName}.${spec.cape.capeKey}=${t}`);
        }
      }
      for (const key of Object.keys(table)) {
        if (!usedKeys.has(key)) {
          lines.push(`skin.${spec.serializeName}.${key}=${table[key]}`);
        }
      }
      if (lines.length > 0) {
        files.push({ path: `texts/${locale}.lang`, content: lines.join('\n') + '\n' });
      }
    }

    return files;
  }
}
