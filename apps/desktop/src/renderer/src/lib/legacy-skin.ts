/**
 * legacy `64×32` 皮肤 → 现代 `64×64` 皮肤的**转换规则**。
 *
 * ## 为什么 3D 预览需要它
 *
 * 3D 预览用的是 skinview3d，它按**现代 64×64 布局**取 UV（实测它的
 * `setSkinUVs` 调用：头 `(0,0)`、躯干 `(16,16)`、右臂 `(40,16)`、右腿 `(0,16)`、
 * 左臂 `(32,48)`、左腿 `(16,48)`，各自还有一层 overlay）。
 *
 * 而 legacy `64×32`（1.6/1.7 时代）只有：
 *
 * | 部位 | legacy 网格 | modern 网格 |
 * |---|---|---|
 * | 头 / 帽子 | `(0,0)` / `(32,0)` | 同上 ✅ |
 * | 躯干 | `(16,16)` | 同上 ✅ |
 * | 右臂 | `(40,16)` | 同上 ✅ |
 * | 右腿 | `(0,16)` | 同上 ✅ |
 * | **左臂 / 左腿** | **不存在** | `(32,48)` / `(16,48)` ❌ |
 * | 躯干/四肢第二层 | **不存在** | `(16,32)` / `(40,32)` / `(0,32)` … ❌ |
 *
 * 也就是说 legacy 的**第一层网格位置与现代完全一致**，缺的只有左半身与第二层。
 * 所以转换只要做两件事：
 *
 * 1. 头/帽/躯干/右臂/右腿 → 原位搬过去；
 * 2. 左臂 / 左腿 → 用右臂 / 右腿**镜像**出来。
 *
 * ## 「镜像」到底怎么镜像（实测，不是照抄记忆）
 *
 * 拿官方皮肤比对：现代 26.3 的 `wide/steve.png` 与 1.7.10 的
 * `entity/steve.png`：
 *
 * - 现代左臂的**前面** `(36,52)` 与现代右臂前面 `(44,20)` 逐像素比对：
 *   **水平翻转后 48/48 全等**（不翻转只有 20/48）→ 左臂的每个面都是右臂镜像；
 * - 但四个面的**槽位顺序**不是整体翻转：
 *   `左臂.左面 = 翻转(右臂.右面)`、`左臂.右面 = 翻转(右臂.左面)`、
 *   `左臂.前面 = 翻转(右臂.前面)`、`左臂.背面 = 翻转(右臂.背面)`。
 *   —— 实测 4 个槽位全是 48/48（若按整体翻转，左右两个面会各差 39/48）。
 *
 * 所以「肢体镜像」= **两个侧面互换 + 每个面内部水平翻转**。
 * 上下面（各 4×4，在网格的第 4-7 / 8-11 列）原位翻转即可。
 *
 * ## 为什么要拆成纯规则 + canvas 两半
 *
 * 规则（搬运表 + 像素映射）是**纯函数**，能直接单测；canvas 那半只是把规则
 * 执行一遍。jsdom 里没有 canvas，规则要是写在 canvas 里就只能靠肉眼验。
 */

import { SKIN_LEGACY_HEIGHT, SKIN_TEXTURE_SIZE } from './skin-layout.js';

export interface SkinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 搬运方式。 */
export type LegacyTransform = 'copy' | 'mirrorLimb';

export interface LegacyCopy {
  /** 源矩形（legacy 64×32 坐标）。 */
  src: SkinRect;
  /** 目标矩形（modern 64×64 坐标）。 */
  dst: SkinRect;
  transform: LegacyTransform;
}

/**
 * legacy → modern 的搬运表。
 *
 * 1. **第一层原位搬**：legacy 的 `y<32` 与 modern 的 `y<32` 网格一一对应
 *    （头 `(0,0)`、帽子 `(32,0)`、躯干 `(16,16)`、右臂 `(40,16)`、右腿 `(0,16)`）。
 * 2. **左臂**：右臂网格 `(40,16)` → `(32,48)`，肢体镜像。
 * 3. **左腿**：右腿网格 `(0,16)` → `(16,48)`，肢体镜像。
 *
 * 第二层（外套/袖子/裤子/帽子之外的 overlay）legacy 没有，保持透明 ——
 * 现代布局里它们在 `(16,32)` / `(40,32)` / `(0,32)` / `(48,48)` / `(0,48)`，
 * 本来就是空的，不该乱填。
 */
export const LEGACY_TO_MODERN_COPIES: readonly LegacyCopy[] = [
  { src: { x: 0, y: 0, w: 64, h: 32 }, dst: { x: 0, y: 0, w: 64, h: 32 }, transform: 'copy' },
  {
    src: { x: 40, y: 16, w: 16, h: 16 },
    dst: { x: 32, y: 48, w: 16, h: 16 },
    transform: 'mirrorLimb',
  },
  {
    src: { x: 0, y: 16, w: 16, h: 16 },
    dst: { x: 16, y: 48, w: 16, h: 16 },
    transform: 'mirrorLimb',
  },
];

/**
 * 肢体网格的槽位映射：源槽位 → 目标槽位。
 *
 * 网格 16 宽 = 4 个 4px 槽位 = `[左面, 前面, 右面, 背面]`。
 * 现代布局的左肢 = 右肢的镜像：**两个侧面互换**，前面/背面留在原槽。
 */
export const LIMB_SLOT_MAP: readonly number[] = [2, 1, 0, 3];

/** 肢体网格里「上下面」占的行数（深度 = 4）。 */
const LIMB_FACE_ROWS = 4;

/** 一个肢体网格的槽宽（肢宽 = 4）。 */
const LIMB_SLOT_WIDTH = 4;

/**
 * 源像素在目标图里的落点；`null` = 不搬运（不在源矩形内）。
 *
 * 纯函数：规则全在这里，canvas 只负责执行。
 */
export function mapLegacyPixel(
  copy: LegacyCopy,
  sourceX: number,
  sourceY: number,
): { x: number; y: number } | null {
  const { src, dst } = copy;
  const rx = sourceX - src.x;
  const ry = sourceY - src.y;
  if (rx < 0 || ry < 0 || rx >= src.w || ry >= src.h) return null;
  if (copy.transform === 'copy') {
    return { x: dst.x + rx, y: dst.y + ry };
  }
  const slot = Math.floor(rx / LIMB_SLOT_WIDTH);
  const inSlot = rx % LIMB_SLOT_WIDTH;
  // 面内水平翻转
  const flipped = LIMB_SLOT_WIDTH - 1 - inSlot;
  if (ry < LIMB_FACE_ROWS) {
    // 上下面：原位翻转（它们不是「侧面」，不参与互换）
    return { x: dst.x + slot * LIMB_SLOT_WIDTH + flipped, y: dst.y + ry };
  }
  // 四条竖面：槽位按左右肢互换重新落位
  const dstSlot = LIMB_SLOT_MAP[slot] ?? slot;
  return { x: dst.x + dstSlot * LIMB_SLOT_WIDTH + flipped, y: dst.y + ry };
}

/** 这张图是不是 legacy `64×32`。 */
export function isLegacySkinSize(width: number, height: number): boolean {
  return width === SKIN_TEXTURE_SIZE && height === SKIN_LEGACY_HEIGHT;
}

/**
 * 把 legacy `64×32` 皮肤转成现代 `64×64`（data URL）。
 *
 * 不是 legacy 就返回 `null`（调用方自己决定用不用原图）；
 * 转换失败（canvas 拿不到、图读不出来）也返回 `null` ——
 * 绝不返回半成品，调用方宁可继续用原图。
 */
export function convertLegacySkinToModern(img: HTMLImageElement): string | null {
  if (!isLegacySkinSize(img.naturalWidth, img.naturalHeight)) return null;
  const source = document.createElement('canvas');
  source.width = SKIN_TEXTURE_SIZE;
  source.height = SKIN_LEGACY_HEIGHT;
  const sctx = source.getContext('2d');
  if (sctx === null) return null;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(img, 0, 0);
  let srcData: ImageData;
  try {
    srcData = sctx.getImageData(0, 0, SKIN_TEXTURE_SIZE, SKIN_LEGACY_HEIGHT);
  } catch {
    return null;
  }

  const out = document.createElement('canvas');
  out.width = SKIN_TEXTURE_SIZE;
  out.height = SKIN_TEXTURE_SIZE;
  const ctx = out.getContext('2d');
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, SKIN_TEXTURE_SIZE, SKIN_TEXTURE_SIZE);
  const dstData = ctx.createImageData(SKIN_TEXTURE_SIZE, SKIN_TEXTURE_SIZE);
  for (const copy of LEGACY_TO_MODERN_COPIES) {
    for (let sy = 0; sy < copy.src.h; sy++) {
      for (let sx = 0; sx < copy.src.w; sx++) {
        const target = mapLegacyPixel(copy, copy.src.x + sx, copy.src.y + sy);
        if (target === null) continue;
        const si = ((copy.src.y + sy) * SKIN_TEXTURE_SIZE + (copy.src.x + sx)) * 4;
        const di = (target.y * SKIN_TEXTURE_SIZE + target.x) * 4;
        dstData.data[di] = srcData.data[si] ?? 0;
        dstData.data[di + 1] = srcData.data[si + 1] ?? 0;
        dstData.data[di + 2] = srcData.data[si + 2] ?? 0;
        dstData.data[di + 3] = srcData.data[si + 3] ?? 0;
      }
    }
  }
  ctx.putImageData(dstData, 0, 0);
  return out.toDataURL('image/png');
}
