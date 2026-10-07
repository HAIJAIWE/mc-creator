/**
 * 皮肤 UV 布局（设计文档 §5.9 皮肤 / §6.4 HD 与 Persona）。
 *
 * ## 缺口背景
 *
 * 本仓此前的 `skin-generator.ts` 只画了**内层**的 64×64。§5.9 明确要求
 * 「第二层 64×64（帽子/外套）」，并提到「HD 皮肤尺寸更大」——**两项都没有落地**。
 *
 * ## 出处与可自校验判据（实抓，非凭记忆）
 *
 * minecraft.wiki "Skin" 页 Features 段（oldid=3819758，2026-10 在线核验）：
 *
 * > Skins are divided into areas that act as the surface area of the character …
 * > They are stored as 64×64 pixels templates, **consisting of an inner and outer
 * > layer**; **each layer consisting 1,632 usable pixels**, making 3,264 total.
 * > In Bedrock Edition, players can also use **128×128** pixels templates,
 * > consisting of **two layers of 6,528 usable pixels**, making 13,056 total.
 *
 * > The outer layer of the skin is 0.5 pixels bigger than the inner layer on the
 * > body, arms, and legs; and is 1 pixel bigger than the inner layer on the head.
 * > This layer is usually used to give the character glasses, hats, or other accessories.
 *
 * > Skins set to "slim" model **lose 25% of their arms' width**, and the
> > **rightmost pixels in the skins' images are ignored**.
 *
 * > A player's skin is exactly 32 pixels tall and 16 pixels wide on the "classic"
 * > model with 4 pixel wide arms, and 14 on the "slim" model with 3 pixel wide arms.
 *
 * > In Java Edition, the skin's **inner layer is forced to be fully opaque**.
 *
 * ## 「可用像素数」是本文件的机器可判判据
 *
 * 布局表展开后的每层总数必须**精确等于**官方给的 1632 / 1568 / 6528 / 6272。
 * 数字对不上就是布局错了 —— 这比「看着像」可靠，也是本仓一贯的判据纪律。
 *
 * ### slim 的 64 怎么对上
 *
 * 官方 slim 每层 1568，比 wide 的 1632 少 **64**（两只手臂共 64）。
 * 单只手臂贴图占位：正面 4×12、背面 4×12、两侧各 4×12、顶/底各 4×4 = 224。
 * slim 时**只有正面/背面/顶底的宽度变 3**（左右侧面是厚度方向展开，不变）：
 * `3×12×2 + 4×12×2 + 3×4×2 = 72 + 96 + 24 = 192`，
 * 每臂少 32，两臂少 64，`1632 − 64 = 1568` ✓ 与官方一致。
 *
 * ## 明确未实现：第二层的逐面坐标（不猜）
 *
 * 官方页面给出了第二层的**像素数与尺寸关系**（各部位大 0.5 / 1 像素），
 * 但**没有公开第二层的逐面 UV 坐标表**。在 64×64 里推导该表会立刻撞上矛盾：
 * 内层已占用 head(0..32, 0..16)、body(16..40, 16..32)、右臂(40..56, 16..32)、
 * 右腿(0..16, 16..32)、左臂(32..56, 48..64)、左腿(0..16, 48..64)，
 * 剩下能放第二层的只有 y ∈ [32,48) 这一条 64×16 带 —— 而这条带里
 * 「左臂第二层」与「右臂第二层」必然重叠。
 *
 * 唯一**无歧义**的是头部（帽子）：官方模板里它固定占 x ∈ [32,64)、y ∈ [0,16)，
 * 即内层头部整体 +32 偏移。故本文件只对 head 给出 outer，其余部位 outer 留
 * `undefined` 并附原因。**需要完整第二层时应导入官方模板文件或 skinview3d 的
 * 布局数据**，不要在这里猜。见 MEMORY「不猜着写代码」。
 *
 * 128×128 同样如此：官方只给了总数 6528 / 6272，未公开逐面表。本文件的
 * `layout128` 是 **×2 放大的推导布局**（像素数与官方一致），不宣称逐面等同官方。
 */

/** 皮肤模型变体。 */
export type SkinModel = 'classic' | 'slim';

/** 皮肤模板尺寸。64 为标准，128 是 Bedrock 的 HD。 */
export type SkinResolution = 64 | 128;

/** 模型上的一个面。 */
export type FaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** 身体部位。 */
export type BodyPart = 'head' | 'body' | 'right_arm' | 'left_arm' | 'right_leg' | 'left_leg';

/** 贴图上的一个矩形区域。 */
export interface UvRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一层里一个部位的六个面。 */
export type PartFaces = Record<FaceId, UvRect>;

/**
 * 一个部位的布局。
 *
 * `outer` 只在**有官方依据**时才给出（目前仅 head/帽子）。其余部位为 undefined，
 * 原因见 `OUTER_UNRESOLVED_REASON` —— 不是「忘了做」，是刻意不猜。
 */
export interface PartLayout {
  inner: PartFaces;
  outer?: PartFaces;
}

/** outer 未解析的原因（对外可读，供 UI/日志说明而非静默留空）。 */
export const OUTER_UNRESOLVED_REASON =
  '官方页面只给了第二层的像素数与尺寸关系，未公开逐面 UV 坐标表；' +
  '64×64 内推导会与内层重叠（详见本文件顶部「明确未实现」段）。' +
  '需要完整第二层请导入官方模板或 skinview3d 布局数据。';

/** 官方像素数（本文件的判据来源，见顶部引用）。 */
export const OFFICIAL_USABLE_PIXELS = {
  '64-classic': 1632,
  '64-slim': 1568,
  '128-classic': 6528,
  '128-slim': 6272,
} as const;

export const BODY_PARTS: readonly BodyPart[] = [
  'head',
  'body',
  'right_arm',
  'left_arm',
  'right_leg',
  'left_leg',
] as const;

export const FACE_IDS: readonly FaceId[] = [
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
] as const;

/** 64×64 内层布局。正确性由像素数断言保证（展开须等于 1632 / 1568）。 */
const BASE_64_CLASSIC: Record<BodyPart, PartFaces> = {
  head: {
    top: { x: 8, y: 0, width: 8, height: 8 },
    bottom: { x: 16, y: 0, width: 8, height: 8 },
    right: { x: 0, y: 8, width: 8, height: 8 },
    front: { x: 8, y: 8, width: 8, height: 8 },
    left: { x: 16, y: 8, width: 8, height: 8 },
    back: { x: 24, y: 8, width: 8, height: 8 },
  },
  body: {
    top: { x: 20, y: 16, width: 8, height: 4 },
    bottom: { x: 28, y: 16, width: 8, height: 4 },
    right: { x: 16, y: 20, width: 4, height: 12 },
    front: { x: 20, y: 20, width: 8, height: 12 },
    left: { x: 28, y: 20, width: 4, height: 12 },
    back: { x: 32, y: 20, width: 8, height: 12 },
  },
  right_arm: {
    top: { x: 44, y: 16, width: 4, height: 4 },
    bottom: { x: 48, y: 16, width: 4, height: 4 },
    right: { x: 40, y: 20, width: 4, height: 12 },
    front: { x: 44, y: 20, width: 4, height: 12 },
    left: { x: 48, y: 20, width: 4, height: 12 },
    back: { x: 52, y: 20, width: 4, height: 12 },
  },
  right_leg: {
    top: { x: 4, y: 16, width: 4, height: 4 },
    bottom: { x: 8, y: 16, width: 4, height: 4 },
    right: { x: 0, y: 20, width: 4, height: 12 },
    front: { x: 4, y: 20, width: 4, height: 12 },
    left: { x: 8, y: 20, width: 4, height: 12 },
    back: { x: 12, y: 20, width: 4, height: 12 },
  },
  // 左臂/左腿是右臂/右腿的镜像展开：沿 x 轴翻到 y ≥ 48 的下半区。
  left_arm: {
    top: { x: 44, y: 48, width: 4, height: 4 },
    bottom: { x: 48, y: 48, width: 4, height: 4 },
    right: { x: 44, y: 52, width: 4, height: 12 },
    front: { x: 36, y: 52, width: 4, height: 12 },
    left: { x: 40, y: 52, width: 4, height: 12 },
    back: { x: 32, y: 52, width: 4, height: 12 },
  },
  left_leg: {
    top: { x: 20, y: 48, width: 4, height: 4 },
    bottom: { x: 16, y: 48, width: 4, height: 4 },
    right: { x: 20, y: 52, width: 4, height: 12 },
    front: { x: 4, y: 52, width: 4, height: 12 },
    left: { x: 0, y: 52, width: 4, height: 12 },
    back: { x: 8, y: 52, width: 4, height: 12 },
  },
};

/** slim：手臂正面/背面/顶底宽度 3（官方「lose 25% of their arms' width」）。 */
function slimArms(base: Record<BodyPart, PartFaces>): Record<BodyPart, PartFaces> {
  const shrink = (faces: PartFaces): PartFaces => {
    const t = faces.top;
    const b = faces.bottom;
    const f = faces.front;
    const k = faces.back;
    return {
      top: { ...t, width: t.width - 1 },
      bottom: { ...b, width: b.width - 1 },
      front: { ...f, width: f.width - 1 },
      back: { ...k, width: k.width - 1 },
      // 左右侧面是厚度方向的展开，宽度不受手臂粗细影响。
      left: faces.left,
      right: faces.right,
    };
  };
  return {
    ...base,
    right_arm: shrink(base.right_arm),
    left_arm: shrink(base.left_arm),
  };
}

function offsetFaces(faces: PartFaces, dx: number): PartFaces {
  return Object.fromEntries(
    FACE_IDS.map((f) => [f, { ...faces[f], x: faces[f].x + dx }]),
  ) as PartFaces;
}

function scaleFaces(faces: PartFaces, factor: number): PartFaces {
  return Object.fromEntries(
    FACE_IDS.map((f) => [
      f,
      {
        x: faces[f].x * factor,
        y: faces[f].y * factor,
        width: faces[f].width * factor,
        height: faces[f].height * factor,
      },
    ]),
  ) as PartFaces;
}

/**
 * 64×64 布局。
 *
 * `outer` 仅 head 有值：官方模板里帽子固定在 x ∈ [32,64)、y ∈ [0,16)，
 * 即内层头部整体 +32 偏移 —— 这是唯一无歧义可推导的部分。
 */
export function layout64(model: SkinModel): Record<BodyPart, PartLayout> {
  const inner = model === 'slim' ? slimArms(BASE_64_CLASSIC) : BASE_64_CLASSIC;
  return Object.fromEntries(
    BODY_PARTS.map((part) => [
      part,
      {
        inner: inner[part],
        ...(part === 'head' ? { outer: offsetFaces(inner.head, 32) } : {}),
      },
    ]),
  ) as Record<BodyPart, PartLayout>;
}

/** 128×128（Bedrock HD）：×2 放大的**推导**布局，像素数与官方一致但非逐面官方表。 */
export function layout128(model: SkinModel): Record<BodyPart, PartLayout> {
  const base = layout64(model);
  return Object.fromEntries(
    BODY_PARTS.map((part) => [
      part,
      {
        inner: scaleFaces(base[part].inner, 2),
        ...(base[part].outer === undefined
          ? {}
          : { outer: scaleFaces(base[part].outer as PartFaces, 2) }),
      },
    ]),
  ) as Record<BodyPart, PartLayout>;
}

export function layoutFor(
  resolution: SkinResolution,
  model: SkinModel,
): Record<BodyPart, PartLayout> {
  return resolution === 64 ? layout64(model) : layout128(model);
}

/**
 * 单层可用像素数（六面面积之和）。
 *
 * 只统计**已解析**的部位 outer —— 第二层未解析时该层总数会小于官方值，
 * 这正是 `validateSkinLayout` 要报告的情况，不在这里静默补齐。
 */
export function usablePixels(
  layout: Record<BodyPart, PartLayout>,
  layer: 'inner' | 'outer',
): number {
  let total = 0;
  for (const part of BODY_PARTS) {
    const faces = layer === 'inner' ? layout[part].inner : layout[part].outer;
    if (faces === undefined) continue;
    for (const face of FACE_IDS) {
      const r = faces[face];
      total += r.width * r.height;
    }
  }
  return total;
}

/** 某一层已解析面是否越界。 */
export function outOfBounds(
  layout: Record<BodyPart, PartLayout>,
  resolution: SkinResolution,
  layer: 'inner' | 'outer',
): string[] {
  const bad: string[] = [];
  for (const part of BODY_PARTS) {
    const faces = layer === 'inner' ? layout[part].inner : layout[part].outer;
    if (faces === undefined) continue;
    for (const face of FACE_IDS) {
      const r = faces[face];
      if (r.x < 0 || r.y < 0 || r.x + r.width > resolution || r.y + r.height > resolution) {
        bad.push(
          `${part}.${face} = (${r.x},${r.y} ${r.width}×${r.height}) 超出 ${resolution}×${resolution}`,
        );
      }
    }
  }
  return bad;
}

/** 内层与已解析的 outer 之间是否重叠。 */
export function overlapsBetweenLayers(
  layout: Record<BodyPart, PartLayout>,
  resolution: SkinResolution,
): string[] {
  const bad: string[] = [];
  for (const part of BODY_PARTS) {
    const outer = layout[part].outer;
    if (outer === undefined) continue;
    for (const face of FACE_IDS) {
      const a = layout[part].inner[face];
      const b = outer[face];
      const hit =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      if (hit) bad.push(`${part}.${face} 内外层重叠`);
    }
  }
  void resolution;
  return bad;
}

/** 布局问题清单。 */
export interface SkinLayoutIssue {
  path: string;
  message: string;
}

/**
 * 校验布局是否与官方一致（不含「第二层未解析」那类已知缺口）。
 *
 * 判据全部来自官方页面：
 * 1. **内层**每层可用像素数 == 官方值（1632 / 1568 / 6528 / 6272）。
 * 2. 已解析的面不越界。
 * 3. 内外层不重叠。
 * 4. classic 手臂宽 4px、slim 宽 3px。
 */
export function validateSkinLayout(
  resolution: SkinResolution,
  model: SkinModel,
): SkinLayoutIssue[] {
  const issues: SkinLayoutIssue[] = [];
  const layout = layoutFor(resolution, model);
  const expected =
    OFFICIAL_USABLE_PIXELS[`${resolution}-${model}` as keyof typeof OFFICIAL_USABLE_PIXELS];

  const got = usablePixels(layout, 'inner');
  if (got !== expected) {
    issues.push({
      path: 'inner',
      message: `内层可用像素数 ${got} ≠ 官方 ${expected}（minecraft.wiki Skin 页 Features 段）`,
    });
  }
  for (const bad of outOfBounds(layout, resolution, 'inner')) {
    issues.push({ path: `inner.${bad.split(' =')[0]}`, message: bad });
  }
  for (const bad of overlapsBetweenLayers(layout, resolution)) {
    issues.push({ path: 'outer', message: bad });
  }

  // 官方臂宽是「64×64 模板下的像素数」（classic 4px / slim 3px）。
  // 128×128 是同比例放大（臂宽 8px / 6px），故判据要按 resolution 缩放。
  const scale = resolution / 64;
  const wantArmWidth = (model === 'slim' ? 3 : 4) * scale;
  for (const part of ['right_arm', 'left_arm'] as const) {
    const w = layout[part].inner.front.width;
    if (w !== wantArmWidth) {
      issues.push({
        path: `${part}.front`,
        message: `${resolution}×${resolution} ${model} 模型手臂正面宽度 ${w} ≠ ${wantArmWidth}`,
      });
    }
  }
  return issues;
}

/**
 * 第二层未解析的部位清单（供 UI/日志显式说明缺口，而不是静默少画一层）。
 */
export function unresolvedOuterParts(resolution: SkinResolution, model: SkinModel): BodyPart[] {
  const layout = layoutFor(resolution, model);
  return BODY_PARTS.filter((p) => layout[p].outer === undefined);
}

/** 皮肤上传可接受的 PNG 尺寸（官方：64×32 / 64×64 / 128×128）。 */
export const ACCEPTED_SKIN_SIZES: readonly { width: number; height: number }[] = [
  { width: 64, height: 32 },
  { width: 64, height: 64 },
  { width: 128, height: 128 },
];

/** 校验上传用 PNG 尺寸（§5.9「上传：Mojang 官方皮肤 API」）。 */
export function validateSkinPngSize(width: number, height: number): SkinLayoutIssue[] {
  if (ACCEPTED_SKIN_SIZES.some((s) => s.width === width && s.height === height)) return [];
  return [
    {
      path: 'size',
      message: `皮肤尺寸 ${width}×${height} 不被接受（官方允许 64×32 / 64×64 / 128×128）`,
    },
  ];
}

/**
 * Java 版皮肤校验：内层强制全不透明
 * （官方 "In Java Edition, the skin's inner layer is forced to be fully opaque"）。
 *
 * 返回 alpha != 255 的像素数，供调用方强制把内层 alpha 写成 255。
 */
export function countTransparentInnerPixels(rgba: ArrayLike<number>): number {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if ((rgba[i] ?? 0) !== 255) n++;
  return n;
}
