/**
 * Texture Set 生成与校验（设计文档 §6.4 材质 / §5.5 资源包 PBR）。
 *
 * ## 为什么需要它
 *
 * §6.4 的原话是「无光影系统，替代物为 **RTX**：MER 贴图（Metalness/Emissive/Roughness）」。
 * 但**「MER 贴图」不是 Bedrock 的机制**——Bedrock 走的是 **Texture Set**
 * （`*.texture_set.json`），MER 只是 texture_set 里的其中一层。本仓此前只生成
 * `textures/items/<id>.png`（纯色/渐变贴图），**没有 texture_set.json**，
 * 也就是产物在 Vibrant Visuals / RTX 下拿不到任何材质信息。
 *
 * ## 键名与规则出处（实抓，非凭记忆）
 *
 * 官方参考：
 * <https://learn.microsoft.com/en-us/minecraft/creator/reference/content/texturesetsreference/texturesetsconcepts/texturesetsintroduction>
 * —— "Texture Set JSON and Introduction to Texture Sets"，
 * `ms.date 2025-05-28`，`updated_at 2025-12-03`，schema 版本标注为 **1.21.30**。
 *
 * 逐条对照原文的硬规则（本模块全部按这些校验，不按推测）：
 *
 * 1. **文件名**：`<贴图名>.texture_set.json`，与贴图**同目录同基名**。
 * 2. **顶层两个字段**：`format_version`（字符串）与 `minecraft:texture_set`（对象）。
 *    示例原文写的是 `"format_version": "1.16.100"`，注意是**字符串**不是数字。
 * 3. **`color` 是唯一必填层**（原文 "This is the only required layer."），
 *    也是 Classic 管线唯一用到的层。
 * 4. **`normal` 与 `heightmap` 互斥**（原文两处分别写明 "should not both be
 *    defined at the same time"）。`heightmap` 只能单通道。
 * 5. **`metalness_emissive_roughness`（MER）与 `metalness_emissive_roughness_subsurface`
 *    （MERS）互斥**。通道映射：MER 的 **R=Metalness, G=Emissive, B=Roughness**；
 *    MERS 是 **A=Subsurface**（4 通道）。
 * 6. **MERS 只被 Vibrant Visuals 支持，RTX 下 subsurface 值被忽略**
 *    （原文 "It is not supported in RTX and any provided subsurface values will
 *    simply be ignored."）。
 * 7. **Metalness 与 Subsurface 不可同时生效**：逐像素取二者较大者，
 *    **平局偏向 subsurface**（原文给了两个例子：`[64,0,0,128]` 是非金属带 128 亚表面；
 *    `[255,0,0,64]` 是金属且亚表面归 0）。
 * 8. **heightmap 不能用于 texture-based object（如物品）**，须用 normal
 *    （原文 Caution 段）。
 * 9. **均匀值格式**：0-255 整数数组，或十六进制（3/4 通道用 RGB/ARGB，
 *    单通道用 2 位十六进制）。
 * 10. **texture_set 只能引用同一个资源包内的贴图**（原文 "can only reference images
 *     that exist in the same resource pack"）。所以本模块生成时**必须把引用的贴图
 *     一起落盘**，不能只写引用。
 * 11. **重复图片引用的扩展名优先级：`.tga > .png > .jpg > .jpeg`**（原文）。
 * 12. 非法 texture_set 会导致 `CONTENT_ERROR` 日志且**整份定义不被使用**——
 *     故校验必须严格，且失败要显式抛而不是静默产出坏文件。
 */

/** Texture set JSON 的 schema 版本（官方页面标注 1.21.30）。 */
export const TEXTURE_SET_FORMAT_VERSION = '1.21.30';

/** texture_set 里合法的层键（官方 schema 1.21.30 全集）。 */
export const TEXTURE_SET_LAYERS = [
  'color',
  'normal',
  'heightmap',
  'metalness_emissive_roughness',
  'metalness_emissive_roughness_subsurface',
] as const;
export type TextureSetLayer = (typeof TEXTURE_SET_LAYERS)[number];

/** 单个 texture_set 引用的贴图（贴图名，不含扩展名，官方示例形如 "grass_carried"）。 */
export type TextureRef = string;

/**
 * 均匀值：整数数组（1/3/4 项）、**单个整数**（仅单通道层，如 heightmap）、
 * 或十六进制字符串。
 *
 * 单个整数只对单通道层合法 —— 多通道层给裸数字没有意义，故由各层校验分别把关。
 */
export type UniformValue = number[] | number | string;

export interface TextureSetLayers {
  /** 必填。贴图名或均匀值。 */
  color: TextureRef | UniformValue;
  normal?: TextureRef | UniformValue;
  heightmap?: TextureRef | UniformValue;
  metalness_emissive_roughness?: TextureRef | UniformValue;
  metalness_emissive_roughness_subsurface?: TextureRef | UniformValue;
}

export interface TextureSetSpec {
  /** 贴图基名（不含扩展名）。texture_set 文件名 = `<name>.texture_set.json`。 */
  name: string;
  layers: TextureSetLayers;
  /**
   * 目标是否为 texture-based object（物品等）。
   * 官方 Caution：这类对象不能用 heightmap，只能用 normal。
   */
  textureBasedObject?: boolean;
  /** 目标渲染管线。RTX 下 subsurface 被忽略（见本文件顶部第 6 条）。 */
  pipeline?: 'vibrant_visuals' | 'rtx' | 'classic';
}

/** texture_set 校验问题。 */
export interface TextureSetIssue {
  path: string;
  message: string;
}

/** `texture_set` 的 JSON 路径（贴图所在目录内）。 */
export function textureSetPath(textureBaseName: string, dir = 'textures/entity'): string {
  return `${dir}/${textureBaseName}.texture_set.json`;
}

/**
 * 单通道层允许的值：整数数组（1 项）、裸整数、或 2 位十六进制（带/不带 `#`）。
 * 官方原文："as 2 hex digits for a single channel layer"。
 */
function isSingleChannelValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 1 && isChannelInt(v[0]);
  if (typeof v === 'number') return isChannelInt(v);
  if (typeof v === 'string') return /^#?([0-9a-fA-F]{2})$/.test(v);
  return false;
}

/** 三通道层（MER）：整数数组 3 项，或 6 位十六进制。 */
function isThreeChannelValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 3 && v.every(isChannelInt);
  // 官方示例写的是 '#FBA34C'（**带 # 前缀**），NVIDIA 指南里也带 #。
  // 数组形式不带 #，字符串形式带 # —— 两种都收。
  if (typeof v === 'string') return /^#?([0-9a-fA-F]{6})$/.test(v);
  return false;
}

/** 四通道层（color 均匀值 / MERS）：整数数组 4 项，或 8 位十六进制（ARGB）。 */
function isFourChannelValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 4 && v.every(isChannelInt);
  if (typeof v === 'string') return /^#?([0-9a-fA-F]{8})$/.test(v);
  return false;
}

function isChannelInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
}

/**
 * 贴图名：非空、无路径分隔、无 `..`。
 *
 * 允许 `/` 是因为官方说「只能引用同一个资源包内」—— 同包内子目录引用是合法的
 * （如 `entity/zombie`）。但**越界与扩展名都不允许**：
 * - `../other/x`：官方规则 10「只能引用同包内」明确排除跨包引用。
 * - `x.png`：引用是**贴图名**不是文件名，扩展名由游戏按优先级规则自己挑
 *   （见下方 TEXTURE_EXTENSION_PRIORITY 与 `pickTexture`）。
 */
const TEXTURE_REF_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,127}$/;

/** 字符串是否是合法的贴图引用（无扩展名、无越界）。 */
function isTextureRef(v: string): boolean {
  if (!TEXTURE_REF_RE.test(v)) return false;
  if (v.split('/').some((seg) => seg === '..' || seg === '')) return false;
  return !/\.(png|tga|jpg|jpeg)$/i.test(v);
}

/**
 * 校验一份 texture_set 定义。
 *
 * 按本文件顶部 1-12 条官方规则逐条查。返回全部问题，不部分接受 ——
 * 因为官方明确「非法则整个 texture set 不被使用」，部分接受等于全丢。
 */
export function validateTextureSet(spec: TextureSetSpec): TextureSetIssue[] {
  const issues: TextureSetIssue[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  const l = spec.layers;

  if (spec.name === '') add('name', '贴图基名不得为空');
  if (/\.(png|tga|jpg|jpeg)$/i.test(spec.name)) {
    add('name', `贴图基名不应带扩展名: ${spec.name}（texture_set 文件名自带 .texture_set.json）`);
  }

  // 规则 3：color 唯一必填。
  if (l.color === undefined) {
    add('color', 'color 是唯一必填层（官方：This is the only required layer）');
  } else if (typeof l.color !== 'string' && !isFourChannelValue(l.color)) {
    add(
      'color',
      `color 的均匀值非法: ${JSON.stringify(l.color)}（须 4 项 0-255 整数数组，或 8 位十六进制 ARGB）`,
    );
  }

  // 规则 4：normal 与 heightmap 互斥。
  if (l.normal !== undefined && l.heightmap !== undefined) {
    add(
      'normal',
      'normal 与 heightmap 不得同时定义（官方：should not both be defined at the same time）',
    );
  }

  // 规则 4/8：heightmap 单通道；texture-based object 不能用。
  if (l.heightmap !== undefined) {
    // heightmap 允许两种形态：单通道均匀值（1 项整数 / 2 位十六进制）或贴图引用。
    // 官方未规定「字符串恰好形如 2 位十六进制」时该按哪种解释 —— 故此处
    // **两者取并集**：任一成立即合法，两者都不成立才报错。这是「不猜」而非
    // 自行发明优先级；把这条消歧缺口记录在案，见 MEMORY §7.11。
    const okAsRef = typeof l.heightmap === 'string' && isTextureRef(l.heightmap);
    if (!okAsRef && !isSingleChannelValue(l.heightmap)) {
      add(
        'heightmap',
        `heightmap 值非法: ${JSON.stringify(l.heightmap)}（单通道层：1 项整数或 2 位十六进制，或贴图引用）`,
      );
    }
    if (spec.textureBasedObject === true) {
      add(
        'heightmap',
        'texture-based object（如物品）不得用 heightmap，须用 normal（官方 Caution）',
      );
    }
  }

  // 规则 5：MER 与 MERS 互斥。
  if (
    l.metalness_emissive_roughness !== undefined &&
    l.metalness_emissive_roughness_subsurface !== undefined
  ) {
    add(
      'metalness_emissive_roughness',
      'MER 与 MERS 层不得同时定义（官方：should not be defined at the same time）',
    );
  }
  // MER 三通道。
  if (
    l.metalness_emissive_roughness !== undefined &&
    typeof l.metalness_emissive_roughness !== 'string' &&
    !isThreeChannelValue(l.metalness_emissive_roughness)
  ) {
    add(
      'metalness_emissive_roughness',
      `MER 值非法: ${JSON.stringify(l.metalness_emissive_roughness)}（3 项 0-255 整数数组或 6 位十六进制）`,
    );
  }
  // MERS 四通道。
  if (
    l.metalness_emissive_roughness_subsurface !== undefined &&
    typeof l.metalness_emissive_roughness_subsurface !== 'string' &&
    !isFourChannelValue(l.metalness_emissive_roughness_subsurface)
  ) {
    add(
      'metalness_emissive_roughness_subsurface',
      `MERS 值非法: ${JSON.stringify(l.metalness_emissive_roughness_subsurface)}（4 项 0-255 整数数组或 8 位十六进制）`,
    );
  }

  // 规则 6：RTX 下 subsurface 被忽略 —— 这是**警告级**事实，不该静默。
  if (spec.pipeline === 'rtx' && l.metalness_emissive_roughness_subsurface !== undefined) {
    add(
      'metalness_emissive_roughness_subsurface',
      'RTX 不支持 subsurface，该层会被完全忽略（官方：not supported in RTX）。若目标是 RTX 请改用 MER',
    );
  }

  // 规则 9/10：各层的贴图引用须是无扩展名、无越界的名字。
  for (const key of TEXTURE_SET_LAYERS) {
    const v = (l as unknown as Record<string, unknown>)[key];
    if (typeof v !== 'string') continue;
    // 十六进制均匀值是字符串形态（如 "#FBA34C"），不是贴图引用，跳过引用校验。
    if (/^#?[0-9a-fA-F]{2,8}$/.test(v)) continue;
    if (!isTextureRef(v)) {
      add(key, `贴图引用非法: ${v}（只能引用同包内的贴图名，不含扩展名与越界路径）`);
    }
  }

  return issues;
}

/**
 * 渲染 `*.texture_set.json` 文本。
 *
 * 校验不通过就抛 `TextureSetError` —— 官方明确「非法则整份定义不被使用」，
 * 与其落一份会被游戏丢弃的文件，不如在生成期报错让调用方拿到原因。
 */
export function renderTextureSet(spec: TextureSetSpec, dir?: string): string {
  const issues = validateTextureSet(spec);
  if (issues.length > 0) {
    throw new TextureSetError(issues);
  }
  const doc: Record<string, unknown> = {
    format_version: TEXTURE_SET_FORMAT_VERSION,
    'minecraft:texture_set': {
      color: spec.layers.color,
    },
  };
  const ts = doc['minecraft:texture_set'] as Record<string, unknown>;
  for (const key of [
    'normal',
    'heightmap',
    'metalness_emissive_roughness',
    'metalness_emissive_roughness_subsurface',
  ] as const) {
    const v = spec.layers[key];
    if (v !== undefined) ts[key] = v;
  }
  void dir;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export class TextureSetError extends Error {
  override readonly name = 'TextureSetError';
  readonly issues: TextureSetIssue[];
  constructor(issues: TextureSetIssue[]) {
    super(`texture_set 定义非法：${issues.map((i) => `${i.path}: ${i.message}`).join('；')}`);
    this.issues = issues;
  }
}

/**
 * MER 三元组 → 十六进制字符串。
 *
 * 官方明确通道映射：**R=Metalness, G=Emissive, B=Roughness**。
 * 供生成器从「物理参数」写 MER 时用，避免调用方自己搞反顺序。
 */
export function merToHex(metalness: number, emissive: number, roughness: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.trunc(v)));
  const hex = (v: number): string => clamp(v).toString(16).padStart(2, '0');
  return `#${hex(metalness)}${hex(emissive)}${hex(roughness)}`.toUpperCase();
}

/** MERS 四元组 → 8 位十六进制（ARGB）。RGBA 映射，**A=Subsurface**。 */
export function mersToArgb(
  metalness: number,
  emissive: number,
  roughness: number,
  subsurface: number,
): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.trunc(v)));
  const hex = (v: number): string => clamp(v).toString(16).padStart(2, '0');
  return `${hex(subsurface)}${hex(metalness)}${hex(emissive)}${hex(roughness)}`.toUpperCase();
}

/**
 * 逐像素判定 metalness 与 subsurface 谁生效（官方规则 7）。
 *
 * 官方原文：逐像素取二者较大者决定主导属性，**平局偏向 subsurface**。
 * 返回 `'subsurface'` 表示亚表面主导（仅非金属能生效），`'metalness'` 表示金属主导。
 *
 * 用于在生成期就告诉调用方「你给的 MER 和 subsurface 谁会赢」，
 * 避免用户以为自己设了金属却被 subsurface 覆盖。
 */
export function dominantProperty(
  metalness: number,
  subsurface: number,
): 'metalness' | 'subsurface' {
  return subsurface >= metalness ? 'subsurface' : 'metalness';
}

/**
 * 官方文档里重复图片引用的扩展名优先级：`.tga > .png > .jpg > .jpeg`。
 *
 * 仓内生成器默认产出 `.png`。本函数给定目录里的候选文件名，返回游戏实际会选的那个，
 * 供「同基名多种扩展名共存」的校验使用（例如避免同时产出 `.png` 与 `.tga`）。
 */
export const TEXTURE_EXTENSION_PRIORITY = ['.tga', '.png', '.jpg', '.jpeg'] as const;

/** 在候选文件名中挑出游戏会采用的那个；都不存在返回 undefined。 */
export function pickTexture(existingNames: readonly string[]): string | undefined {
  const lower = existingNames.map((n) => n.toLowerCase());
  return TEXTURE_EXTENSION_PRIORITY.find((ext) => lower.some((n) => n.endsWith(ext)));
}
