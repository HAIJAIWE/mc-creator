import { z } from 'zod';

/**
 * 基岩皮肤包（skin pack）规格。
 *
 * ## 本 schema 的每一条约束都有官方出处（2026-10 实抓，非凭记忆）
 *
 * `skins.json` 结构与分辨率的依据：
 * `learn.microsoft.com/en-us/minecraft/creator/reference/content/skinpacksreference/skinpackjsonreference`
 * （源文件 `SkinPackJSONReference.md`，updated 2025-08-12）
 *
 * 强制校验规则的依据（**比 schema 页更硬，是真正的门禁**）：
 * `learn.microsoft.com/en-us/minecraft/creator/reference/content/mctoolsvalreference/cspj`
 * （源文件 `cspj.md`，updated 2026-01-28）
 *
 * | 规则 | 级别 | 官方原文要点 | 本 schema 对应 |
 * |---|---|---|---|
 * | CSPJ107 Texture Size | 🔴 Error | 皮肤贴图必须 **64×64 或 128×128** | `textureSize: z.union([z.literal(64), z.literal(128)])` |
 * | CSPJ116 Too Many Skins | 🔴 Error | 单包**最多 80** 个皮肤 | `skins: z.array(...).max(80)` |
 * | CSPJ115 Invalid Model | 🔴 Error | geometry 必须是合法 slim/wide | `geometry: z.enum([...])` |
 * | CSPJ103 Name Mismatch | 🔴 Error | `localization_name` 与 `serialize_name` **必须相同** | 见下方说明 |
 * | CSPJ106 Cape Size | 🔴 Error | 披风贴图 **64×32** | `cape` 固定 64×32，不可配尺寸 |
 * | CSPJ105 Duplicate Texture | 🟡 Warning | 多个皮肤引用同一贴图 | 生成器去重并告警 |
 * | CSPJ110 Orphan Texture | 🟡 Warning | 包里有未被引用的贴图 | 生成器只产出被引用的贴图 |
 * | CSPJ111 Missing Loc Key | 🔴 Error | skins.json 用的键在 lang 里必须存在 | 生成器强制成对产出 |
 * | CSPJ113 Key Whitespace | 🔴 Error | 键首尾不得有空白 | `serializeName` 正则不允许空白 |
 * | CSPJ101 Missing skins.json | 🔴 Error | skins.json 必需 | 生成器必定产出 |
 *
 * ### CSPJ103 的处理方式（重要）
 *
 * 官方要求 `localization_name` 与 `serialize_name` **取值相同**。但 schema 页的
 * 示例里两者碰巧一致，看不出这是**约束**；若照抄成两个独立字段，调用方很容易
 * 填成不同值、直接吃 CSPJ103 报错。
 *
 * 故本 schema **只提供 `serializeName` 一个字段**，生成器把它同时写进两处，
 * 从结构上不可能不一致。这比「加个 refine 检查」更可靠 —— 它让错误无法被表达。
 */

/**
 * 玩家模型（geometry）。
 *
 * CSPJ115：必须是合法的玩家模型（slim / wide 臂）。
 * 官方原文：`geometry.humanoid.custom`（Steve，4px 臂）/
 * `geometry.humanoid.customSlim`（Alex，3px 臂）。
 */
export const SkinGeometry = z.enum(['custom', 'customSlim']);
export type SkinGeometry = z.infer<typeof SkinGeometry>;

/** geometry → manifest 里的完整字符串（官方原文的 `geometry.humanoid.*`）。 */
export const SKIN_GEOMETRY_IDS = {
  custom: 'geometry.humanoid.custom',
  customSlim: 'geometry.humanoid.customSlim',
} as const satisfies Record<SkinGeometry, string>;

/** 贴图尺寸（CSPJ107 强制）。**不接受其它值** —— 不做「就近取整」。 */
export const SkinTextureSize = z.union([z.literal(64), z.literal(128)]);
export type SkinTextureSize = z.infer<typeof SkinTextureSize>;

/**
 * 标识符（CSPJ113 禁止首尾空白；官方要求字母数字与下划线）。
 * 同一正则同时用于 `serializeName` 与 `skinKey`，因为两者都会进本地化键。
 */
const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_]{0,63}$/;

/** 单个皮肤条目（对应 `skins.json` 的 `skins[]` 元素）。 */
export const SkinPackEntrySpec = z.object({
  /**
   * 本地化键后缀（官方示例：`MageRobe` / `knight_armor`）。
   *
   * 最终键为 `skin.{serializeName}.{skinKey}`，故这里不允许空白（CSPJ113）。
   */
  skinKey: z.string().regex(IDENTIFIER),
  /** 显示名称（进 lang 文件的值） */
  displayName: z.string().min(1),
  /** 玩家模型（CSPJ115） */
  geometry: SkinGeometry.default('custom'),
  /**
   * 贴图文件名（不含 `textures/` 前缀与扩展名）。
   *
   * 默认取 `skinKey` —— 保证与键同名，便于人工核对贴图与条目（CSPJ105）。
   */
  texture: z.string().regex(IDENTIFIER).optional(),
  /**
   * 可获取性（官方 `type` 字段）。
   *
   * 注意：**`paid` 是官方 marketplace 内容专用**，普通第三方包不要用；
   * 生成器在出现 `paid` 时会给告警提示。
   */
  type: z.enum(['free', 'paid']).default('free'),
  /** 主体基色（#RRGGBB），用于自动填充皮肤各 UV 区域 */
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#c68642'),
  /** 头部/四肢辅色（#RRGGBB），缺省时由 primaryColor 推导明暗 */
  secondaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type SkinPackEntrySpec = z.infer<typeof SkinPackEntrySpec>;

/**
 * 披风条目。
 *
 * CSPJ106（Error）：披风贴图 **必须是 64×32** —— 与皮肤不同，且**不接受**其它尺寸，
 * 所以这里**不提供尺寸字段**（给了就等于允许配错）。
 */
export const SkinPackCapeSpec = z.object({
  /** 披风文件名（不含 `textures/` 与扩展名） */
  capeKey: z.string().regex(IDENTIFIER),
  /** 披风颜色（#RRGGBB），自动生成 64×32 贴图 */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#3b2f2f'),
});
export type SkinPackCapeSpec = z.infer<typeof SkinPackCapeSpec>;

/**
 * SkinPackSpec：基岩皮肤包规格。
 *
 * 产物结构（与官方示例一致）：
 * - `manifest.json` —— 模块类型 `skin_pack`，**不含 `min_engine_version`**
 * - `skins.json` —— `serialize_name` / `localization_name` / `skins[]`
 * - `textures/<name>.png` —— 每个皮肤一张，尺寸见 `textureSize`
 * - `textures/<cape>.png` —— 披风，固定 64×32
 * - `texts/en_US.lang`（+ 可选 `zh_CN.lang`）—— CSPJ111 要求的本地化条目
 */
export const SkinPackSpec = z.object({
  /**
   * 包标识符（CSPJ113 禁空白）。
   *
   * 同时写入 `serialize_name` 与 `localization_name`（CSPJ103 要求两者相同），
   * 并作为本地化键前缀 `skinpack.{serializeName}`。
   */
  serializeName: z.string().regex(IDENTIFIER),
  /** 包显示名称（`skinpack.{serializeName}` 的值） */
  packName: z.string().min(1),
  /** 作者署名（可选）。官方支持 `skinpack.{serializeName}.by`。 */
  packAuthor: z.string().optional(),
  /** 包描述（manifest.header.description） */
  description: z.string().default(''),
  /** 基岩 manifest format_version（官方示例用 2） */
  packFormat: z.number().int().default(2),
  /** 贴图尺寸（CSPJ107：64 或 128） */
  textureSize: SkinTextureSize.default(64),
  /** header UUID（缺省由生成器生成 v4） */
  headerUuid: z.string().optional(),
  /** manifest 版本号三元组 */
  version: z.array(z.number().int()).length(3).default([1, 0, 0]),
  /** 皮肤条目（CSPJ116：最多 80） */
  skins: z.array(SkinPackEntrySpec).max(80).default([]),
  /** 披风条目（CSPJ106：贴图固定 64×32） */
  cape: SkinPackCapeSpec.optional(),
  /** 额外本地化：`{ 'zh_CN': { 'Knight': '骑士' } }`，键为 skinKey */
  lang: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});
export type SkinPackSpec = z.infer<typeof SkinPackSpec>;

/** CSPJ106 的强制尺寸：披风贴图只能是 64×32。 */
export const CAPE_TEXTURE_SIZE = { width: 64, height: 32 } as const;

/**
 * 明确未实现：HD / Persona 皮肤字段。
 *
 * 官方 `Validation Rules - Skin Pack` 的 **CSPJ108「Creator Only」**（Error）原文：
 *
 * > A property that is only allowed for Minecraft Creator accounts was found.
 * > Non-creator accounts cannot use certain advanced skin features.
 *
 * 即 HD / Persona 相关属性**被明确限制为 Minecraft Creator 账户专属**，公开文档
 * 刻意不提供其字段定义 —— 这正是权威 `SkinPackJSONReference.md` 里完全查不到
 * HD / Persona 的原因。
 *
 * 按本仓纪律（官方没公开的东西就不做、不推导「像的」机制，见 MEMORY §7.2 / §6.4），
 * 这里**只导出原因、不提供任何字段**，也不按记忆猜一个 `persona` 形状。
 * 需要时应在官方开放该字段后再实现。
 */
export const SKINPACK_HD_PERSONA_UNRESOLVED_REASON: string =
  'HD/Persona 字段受 CSPJ108「Creator Only」限制，仅 Minecraft Creator 账户可用，' +
  '官方公开文档未提供字段定义；按「官方没公开就不做」纪律不实现，也不推导猜测结构。';
