/**
 * 皮肤正面预览的**纯数据 + 合成逻辑**（不含 React 组件）。
 *
 * 拆出来有两个原因：
 * 1. `react-refresh/only-export-components` —— 组件文件只导出组件，
 *    这是本仓的既有约定（见 `detail-shared.ts`）。
 * 2. 落位（`dx` / `dy`）是这里最容易写错、又不会报错的部分：写错只是画出一张
 *    诡异的图。拆成纯模块就能在没有 canvas 实现的环境里直接断言。
 *
 * ─────────────────────────────────────────────────────────────────
 * 源矩形**不在这个文件里**
 *
 * 12 个部位的前脸坐标在 `lib/skin-layout.ts` —— 那是**唯一一份**（拿真皮肤图
 * 逐块核对过）。这个文件只管「取哪一块 → 画到 16×32 画布的哪个位置」。
 *
 * 为什么必须只有一个来源：源矩形原先手抄在三个地方（这里、`middle/skin-uv.ts`、
 * `middle/skin-mirror.ts`），抄歪了三处：
 * - 左腿写成 `(4,52)` —— 真皮肤上那**整块 48 像素全透明**，缩略图里左腿是个洞；
 * - 躯干外套写成 `(20,52)` —— 那其实是**左腿**，牛仔裤被画到了胸口；
 * - 右臂外套写成 `(44,52)` —— 落在**左臂块**里，左臂贴图画到了右臂上。
 *
 * 当时测试只断言「不越界 / 不碰透明区 / 覆盖层与主层对齐」，全是**内部一致**的
 * 检查，所以三处错坐标全部通过。现在的钉子分两层：`lib/skin-layout.test.ts`
 * 钉绝对值 + 内部规则，这里钉落位。
 * ─────────────────────────────────────────────────────────────────
 * 左 / 右：**画面左边放的是玩家的右肢**
 *
 * 九块取的全是**正面**贴图，而正面贴图的标准画法是「从盒子外面看是什么样就画成
 * 什么样」—— 所以整张图等于**观众站在对方面前看到的样子**，对方的右手在观众的
 * **左边**。头/躯干居中本来就不分左右，四肢必须跟着同一个视角：把「右臂」按字面
 * 画到画面右边，等于头是正面、四肢是镜像，同一张图里混了两套左右。
 *
 * （贴图本身没有歧义：一个 box 展开成 `[右][前][左][后]` 四格，前脸的**右边**
 * 贴着的是**左脸**；只有「前脸按观众的视角来画」这个约定能让展开闭合。）
 *
 * 数据上的旁证：Dinnerbone 两条腿内侧各有一道深色阴影，正面贴图互为镜像
 * （右腿 `wwwB`、左腿 `Bwww`）。按本表落位后两道阴影都落在**内侧**，成对。
 * ─────────────────────────────────────────────────────────────────
 * 2D 合成（`compositeSkinFront`）
 *
 * - 画布 `OUT_W` × `OUT_H` = 16 × 32：16 宽 = 右臂 4 + 躯干 8 + 左臂 4；
 *   32 高 = 头 8 + 躯干 12 + 腿 12。
 * - 九块全是正面；**列表顺序就是绘制顺序**，覆盖层排在主层之后（帽子要盖在头上）。
 * - 固定按 **classic 的 4px 手臂**取样，见 `compositeSkinFront` 的注释。
 * ─────────────────────────────────────────────────────────────────
 * legacy `64×32` 走另一张表（`SKIN_FRONT_PARTS_LEGACY`）
 *
 * 那张图里 `y16..31` 之后就没有了：**没有左腿/左臂块、也没有任何第二层**（只有帽子）。
 * 游戏对 legacy 的处理是「只用 Steve 模型 + 把右肢镜像到左边」，这里照做 ——
 * 否则缩略图里左边两条肢会是空洞。所以 legacy 表里左臂/左腿取的是**右肢的矩形**
 * 并标 `mirror: true`。
 * ─────────────────────────────────────────────────────────────────
 */

import {
  SKIN_LEGACY_HEIGHT,
  SKIN_TEXTURE_SIZE,
  slotRect,
  type SkinSlotRect,
} from '../../lib/skin-layout.js';

/** 源矩形（贴图像素坐标）。坐标来自 `lib/skin-layout.ts`。 */
export type SrcRect = SkinSlotRect;

/** 一块：源矩形 + 画到哪 + 是不是覆盖层。 */
export interface SkinPart {
  /** 贴图上取哪一块。 */
  src: SrcRect;
  /** 合成图上画到哪（合成图是 `OUT_W` × `OUT_H`）。 */
  dx: number;
  dy: number;
  /**
   * 是覆盖层（帽子 / 外套第二层）。
   *
   * 必须在对应主层**之后**画 —— 帽子要盖在头上。列表顺序即绘制顺序。
   */
  overlay: boolean;
  /**
   * 水平镜像后再画。
   *
   * 只给 **legacy 64×32** 用：那张图里没有左臂/左腿块，游戏自己把右肢镜像过去。
   * 我们照游戏的行为画（镜像=按块的右边缘翻转坐标系），而不是在左边留个洞。
   */
  mirror?: boolean;
}

/**
 * 合成画布尺寸（贴图像素）。
 *
 * 16 宽 = 右臂 4 + 躯干 8 + 左臂 4（按**画面**从左到右写）；32 高 = 头 8 + 躯干 12 + 腿 12。
 */
export const OUT_W = 16;
export const OUT_H = 32;

/** 皮肤贴图的标称尺寸（定义在 `lib/skin-layout.ts`，这里只是转出去给测试用）。 */
export { SKIN_TEXTURE_SIZE };

/** 手臂宽度：预览固定按 classic 的 4px 取样（见 `compositeSkinFront`）。 */
export const ARM_W = 4;

/** 头占的横向偏移（让 8 宽的头在 16 宽的画布里居中）。 */
const HEAD_DX = (OUT_W - 8) / 2;

/**
 * 四肢的横向落位。**画面左边是玩家的右肢**（见文件头「左 / 右」）。
 *
 * 写成常量而不是字面量，是为了让「哪条肢画在哪边」这件事在表里一眼可见 ——
 * 之前四个 `dx` 是硬编码的顺序值，谁也没看出右臂被放到了画面右边。
 */
const RIGHT_ARM_DX = HEAD_DX - ARM_W; // 0：画面最左
const LEFT_ARM_DX = HEAD_DX + 8; // 12：画面最右
const RIGHT_LEG_DX = HEAD_DX; // 4：腿并排 8 宽，右腿占左半
const LEFT_LEG_DX = HEAD_DX + ARM_W; // 8：左腿占右半

/**
 * 正面小人的所有块，顺序即绘制顺序（主层在前、覆盖层在后）。
 *
 * 源矩形一律 `slotRect('classic', …)` —— 坐标的唯一来源是 `lib/skin-layout.ts`。
 * 这里只决定**画到哪**。
 */
export const SKIN_FRONT_PARTS: readonly SkinPart[] = [
  // ── 主层 ──
  { src: slotRect('classic', 'rightArm'), dx: RIGHT_ARM_DX, dy: 8, overlay: false }, // 右臂
  { src: slotRect('classic', 'body'), dx: HEAD_DX, dy: 8, overlay: false }, // 躯干
  { src: slotRect('classic', 'leftArm'), dx: LEFT_ARM_DX, dy: 8, overlay: false }, // 左臂
  { src: slotRect('classic', 'head'), dx: HEAD_DX, dy: 0, overlay: false }, // 头
  { src: slotRect('classic', 'rightLeg'), dx: RIGHT_LEG_DX, dy: 20, overlay: false }, // 右腿
  { src: slotRect('classic', 'leftLeg'), dx: LEFT_LEG_DX, dy: 20, overlay: false }, // 左腿
  // ── 覆盖层 ──
  { src: slotRect('classic', 'headOverlay'), dx: HEAD_DX, dy: 0, overlay: true }, // 帽子
  { src: slotRect('classic', 'bodyOverlay'), dx: HEAD_DX, dy: 8, overlay: true }, // 躯干外套
  { src: slotRect('classic', 'rightArmOverlay'), dx: RIGHT_ARM_DX, dy: 8, overlay: true }, // 右臂外套
];

/**
 * **legacy `64×32`** 的块表：7 块。
 *
 * 与 `SKIN_FRONT_PARTS` 的差别，全部来自那张图的物理布局：
 * - **没有第二层**（躯干外套 / 袖 / 裤在 `y32..47`，legacy 没有那一段）—— 只有帽子还在
 * - **没有左臂/左腿块**，所以左边两条肢取右肢的矩形 + `mirror: true`
 *
 * 取的都是 classic 表里 `y<32` 的那几格：头 `(8,8)`、帽子 `(40,8)`、躯干 `(20,20)`、
 * 右臂 `(44,20)`、右腿 `(4,20)` —— 与 64×64 的同一块**逐像素相同**。
 */
export const SKIN_FRONT_PARTS_LEGACY: readonly SkinPart[] = [
  // ── 主层 ──
  { src: slotRect('classic', 'rightArm'), dx: RIGHT_ARM_DX, dy: 8, overlay: false }, // 右臂
  { src: slotRect('classic', 'body'), dx: HEAD_DX, dy: 8, overlay: false }, // 躯干
  // 左臂 = 右臂镜像（legacy 里没有左臂块）
  {
    src: slotRect('classic', 'rightArm'),
    dx: LEFT_ARM_DX,
    dy: 8,
    overlay: false,
    mirror: true,
  },
  { src: slotRect('classic', 'head'), dx: HEAD_DX, dy: 0, overlay: false }, // 头
  { src: slotRect('classic', 'rightLeg'), dx: RIGHT_LEG_DX, dy: 20, overlay: false }, // 右腿
  // 左腿 = 右腿镜像
  {
    src: slotRect('classic', 'rightLeg'),
    dx: LEFT_LEG_DX,
    dy: 20,
    overlay: false,
    mirror: true,
  },
  // ── 覆盖层：legacy 只有帽子 ──
  { src: slotRect('classic', 'headOverlay'), dx: HEAD_DX, dy: 0, overlay: true },
];

/**
 * 按贴图尺寸选块表。
 *
 * - `64×64` → `SKIN_FRONT_PARTS`
 * - `64×32` → `SKIN_FRONT_PARTS_LEGACY`（游戏里的 legacy 行为）
 * - 其它（含 128×128 HD / 64×128 这种不存在的尺寸）→ `null`，不画
 */
export function selectSkinFrontParts(width: number, height: number): readonly SkinPart[] | null {
  if (width !== SKIN_TEXTURE_SIZE) return null;
  if (height === SKIN_TEXTURE_SIZE) return SKIN_FRONT_PARTS;
  if (height === SKIN_LEGACY_HEIGHT) return SKIN_FRONT_PARTS_LEGACY;
  return null;
}

/**
 * 把一张皮肤贴图画成正面小人，返回 data URL。
 *
 * 认两种尺寸：`64×64`（现代）与 `64×32`（legacy，左肢由右肢镜像）。
 * 其它尺寸 / canvas 不可用返回 null —— 宁可不显示，也不要画出一张错位的图。
 *
 * ⚠️ classic / slim：这里固定按 **classic 的 4px 手臂**取样。slim 手臂只有 3px，
 * 它的展开图整体窄 2 列（2×(进深 4 + 宽 3) = 14 列），前脸就只剩 3 列；按 4px 取样
 * 会把**手臂侧面的第 1 列**也当前脸画进去 —— slim 皮肤手臂边上的那列「杂色」就是
 * 这个侧面，不是闲置列。**不猜模型**是有意的：源站条目不带模型信息（PNG 里也不
 * 记录模型），猜错会让整条手臂错位，比多一列侧面更误导。用户在皮肤库里可以自己
 * 改模型，改完预览就准。
 */
export function compositeSkinFront(img: HTMLImageElement): string | null {
  const parts = selectSkinFrontParts(img.naturalWidth, img.naturalHeight);
  if (parts === null) return null;
  const out = document.createElement('canvas');
  out.width = OUT_W;
  out.height = OUT_H;
  const ctx = out.getContext('2d');
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = false;
  for (const p of parts) {
    if (p.mirror === true) {
      // 镜像：平移到该块的**右边缘**再把 x 轴翻过来，于是贴图的左边缘画到了右边。
      // save/restore 一起把 imageSmoothingEnabled 这类绘图状态还原。
      ctx.save();
      ctx.translate(p.dx + p.src.w, p.dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, p.src.x, p.src.y, p.src.w, p.src.h, 0, 0, p.src.w, p.src.h);
      ctx.restore();
      continue;
    }
    ctx.drawImage(img, p.src.x, p.src.y, p.src.w, p.src.h, p.dx, p.dy, p.src.w, p.src.h);
  }
  return out.toDataURL('image/png');
}
