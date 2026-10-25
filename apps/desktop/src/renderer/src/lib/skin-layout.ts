/**
 * 64×64 皮肤贴图的**唯一一份**槽位表：12 个部位的前脸在贴图上的矩形。
 *
 * ## 为什么要有这个文件
 *
 * 同一份布局此前被手写在**三个**地方，而且**已经漂移**：
 * - `launcher/skin-preview.shared.ts`（下载页列表缩略图的正面合成）
 * - `middle/skin-uv.ts`（皮肤编辑器的部位表 + 点击命中）
 * - `middle/skin-mirror.ts`（镜像绘制 / 油漆桶填充）
 *
 * 抓到过的分歧：
 * - 预览那份左腿写 `(4,52)` —— 真皮肤上**整块 48 像素全透明**，缩略图里左腿是个洞；
 * - 编辑器那份 `rightArmOverlay` 写 `(52,20)` —— 那是手臂**背面**，不是第二层；
 * - slim（3px 手臂）左臂前脸 x：一份写 36、一份写 37。
 *
 * 所以布局只留这一份，三个消费方各自保留自己的对外形状，但数字都从这里取。
 *
 * ## 布局怎么记
 *
 * 贴图就是「把每个盒子从外面展开、平铺」：
 * - `y0..15`：头 `(0,0)-(32,16)`；帽子 = 头 + `(32,0)`；
 * - `y16..31`：右腿 `(0,16)`、躯干 `(16,16)-(40,32)`、右臂 `(40,16)-(56,32)`；
 * - `y32..47`：上面那三块的**第二层**（躯干外套 / 右袖 / 右腿第二层）；
 * - `y48..63`：左腿 `(16,48)`、左臂 `(32,48)`，以及左腿/左臂的第二层 `(0,48)` / `(48,48)`。
 *
 * 每个块内：**前脸 = 块起点 + (进深, 进深)**，宽 = 盒宽（12 项全符合，测试钉着）。
 * 例：躯干块起点 `(16,16)`、进深 4 → 前脸 `(20,20)`；左腿块起点 `(16,48)` → `(20,52)`。
 *
 * legacy `64×32` 只有 `y<32` 那一段：头/帽子/躯干/右臂/右腿的矩形照用，
 * 左臂左腿由游戏镜像右肢（见 `SKIN_LEGACY_HEIGHT`）。
 *
 * ## 数值不是照抄记忆，是拿真皮肤解码后核过的
 *
 * 用 minotar.net 取的真皮肤（临时脚本跑的，真图不在仓库里、CI 也拿不到）：
 * - `MHF_Steve` / `Dinnerbone`（classic 64×64）：`y32..47` 整片是空的（原版腿没有
 *   第二层）；牛仔裤在 `(16,48)-(32,64)`，前脸 `(20,52)`；外套在 `y36` 那行。
 * - `MHF_Alex`（slim）：左臂块起点 32，它的**顶面**在 `(36,48)`，而展开图里前脸就在
 *   顶面正下方 → slim 左臂前脸 `x=36`（不是 37）。Alex 自己那条前脸第 1 列的肤色缝
 *   是它贴图的内容，不是坐标问题。
 *
 * ## 两个坑
 *
 * - `rightLegOverlay` / `leftLegOverlay`：**原版没有腿的第二层**，这两格是格式里
 *   空着的槽位（真皮肤实测为空）。保留它们是为了让编辑器「显示/隐藏第二层」成对出现。
 * - 12 个槽**两两不重叠**（`skin-layout.test.ts` 钉着）。旧表里编辑器那份把
 *   `leftLegOverlay` 也写成 `(20,36)`，和躯干外套撞在同一格 —— 这条能直接抓到。
 */

/**
 * 模型：classic 手臂 4px、slim 手臂 3px。
 *
 * 注意 slim 与否**不在 PNG 里**（贴图本身不记录模型），所以模型是外部信息。
 */
export type SkinModel = 'classic' | 'slim';

/** 12 个槽位。命名沿用的是贴图/模型里的说法（玩家的右臂就是 `rightArm`）。 */
export type SkinSlotId =
  | 'head'
  | 'headOverlay'
  | 'body'
  | 'bodyOverlay'
  | 'rightArm'
  | 'rightArmOverlay'
  | 'leftArm'
  | 'leftArmOverlay'
  | 'rightLeg'
  | 'rightLegOverlay'
  | 'leftLeg'
  | 'leftLegOverlay';

/** 贴图上的一个矩形（前脸）。 */
export interface SkinSlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 皮肤贴图标称边长（宽恒为它；现代格式高也等于它）。 */
export const SKIN_TEXTURE_SIZE = 64;

/**
 * **legacy 旧格式**的贴图高度：`64×32`（Minecraft 1.7 及更早）。
 *
 * 与 64×64 的关系：
 * - `y0..15` 那一段**完全一样**（头 / 帽子 / 躯干 / 右臂 / 右腿的展开图）；
 * - `y16..31` 之后**没有了**：没有躯干/手臂/腿的第二层，也**没有左腿/左臂块**；
 * - 左臂左腿由**游戏自己把右肢镜像过去**（legacy「只有 Steve 模型」，`model` 恒 classic）。
 *
 * 所以 legacy 走 `SKIN_FRONT_PARTS_LEGACY`（`launcher/skin-preview.shared.ts`），
 * 里面取的全是 classic 表里 `y<32` 的那几格 + 镜像。
 *
 * 与 `packages/core/src/skin/png.ts` 的 `LEGACY_SKIN_HEIGHT` 是**同一个事实**：
 * 校验在 core（那边决定「什么算有效皮肤」），预览在渲染层，而渲染层不能从
 * `@mc-creator/core` 取数（会拖进 `node:path` / `Buffer`），所以这里留一份常量。
 * 两边都有测试钉着 32，改一边就会红。
 */
export const SKIN_LEGACY_HEIGHT = 32;

/**
 * classic（4px 手臂）的 12 个前脸矩形。**这是唯一一份数字**。
 *
 * slim 只改手臂宽度，所以这里没有第二张表（见 `slotRect`）。
 */
const CLASSIC_SLOTS: Record<SkinSlotId, SkinSlotRect> = {
  head: { x: 8, y: 8, w: 8, h: 8 },
  headOverlay: { x: 40, y: 8, w: 8, h: 8 },

  body: { x: 20, y: 20, w: 8, h: 12 },
  bodyOverlay: { x: 20, y: 36, w: 8, h: 12 },

  rightArm: { x: 44, y: 20, w: 4, h: 12 },
  rightArmOverlay: { x: 44, y: 36, w: 4, h: 12 },

  leftLeg: { x: 20, y: 52, w: 4, h: 12 },
  leftLegOverlay: { x: 4, y: 52, w: 4, h: 12 },

  leftArm: { x: 36, y: 52, w: 4, h: 12 },
  leftArmOverlay: { x: 52, y: 52, w: 4, h: 12 },

  rightLeg: { x: 4, y: 20, w: 4, h: 12 },
  rightLegOverlay: { x: 4, y: 36, w: 4, h: 12 },
};

/** 12 个槽位，顺序固定（镜像/遍历用得上）。 */
export const SKIN_SLOT_IDS: readonly SkinSlotId[] = [
  'head',
  'headOverlay',
  'body',
  'bodyOverlay',
  'rightArm',
  'rightArmOverlay',
  'leftArm',
  'leftArmOverlay',
  'rightLeg',
  'rightLegOverlay',
  'leftLeg',
  'leftLegOverlay',
];

/** 第二层（覆盖层）槽 → 它盖住的主层槽。 */
export const SLOT_OVERLAY_PARENT: Partial<Record<SkinSlotId, SkinSlotId>> = {
  headOverlay: 'head',
  bodyOverlay: 'body',
  rightArmOverlay: 'rightArm',
  leftArmOverlay: 'leftArm',
  rightLegOverlay: 'rightLeg',
  leftLegOverlay: 'leftLeg',
};

/** 手臂槽位 —— slim 只影响这几个（其余槽位两个模型完全一样）。 */
const ARM_SLOTS: ReadonlySet<SkinSlotId> = new Set([
  'rightArm',
  'rightArmOverlay',
  'leftArm',
  'leftArmOverlay',
]);

/**
 * 取某个槽位在某个模型下的前脸矩形。
 *
 * slim 与 classic 的差别**只有手臂宽度**（4px → 3px）；x 不变 —— slim 手臂同样从
 * 块起点 + 进深开始画（真图实测：顶面在 `(36,48)`，前脸正下方同 x）。
 */
export function slotRect(model: SkinModel, slot: SkinSlotId): SkinSlotRect {
  const rect = CLASSIC_SLOTS[slot];
  if (model === 'slim' && ARM_SLOTS.has(slot)) {
    return { ...rect, w: 3 };
  }
  // 一律返回副本：调用方拿到的是「一份坐标」，不是表里的那一格，
  // 免得谁就地改了两个字段就把表污染给别的功能。
  return { ...rect };
}
