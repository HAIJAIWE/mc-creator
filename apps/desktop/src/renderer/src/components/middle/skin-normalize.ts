/**
 * 外部皮肤图 → **规范化的 64×64** data URL。
 *
 * 两种输入尺寸：
 * - `64×64`：原样（现代布局）
 * - `64×32`：**legacy 旧格式**（1.6/1.7 时代）→ 转换成现代布局
 *
 * ## legacy 转换不是「拉高画布」
 *
 * 旧实现对 64×32 只做 `drawImage(img, 0, 0)` 到 64×64 画布上 ——
 * 也就是**把下半张空掉**。结果：头/躯干/右臂/右腿在位（legacy 的第一层
 * 与现代的网格位置本来就一致），**左半身整块透明**，第二层也没有。
 * 拿这种图去渲染 3D，出来的是「有头有躯干、四肢残缺」的人。
 *
 * 正确的转换见 `lib/legacy-skin.ts`：第一层原位搬 + 左臂/左腿由右臂/右腿
 * **镜像**出来（镜像规则是拿官方 modern/legacy 皮肤逐像素比对定的，
 * 见那里的注释）。
 */

import { convertLegacySkinToModern } from '../../lib/legacy-skin.js';

/** data URL 转成 Image；失败返回 null。 */
export function loadSkinImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * 规范化成 64×64 PNG dataURL。
 * - 64×64：原样
 * - 64×32：legacy 旧格式 → 转成现代布局（**不是**简单拉高画布）
 * - 其他尺寸（含 128×128）：返回 null，直接拒绝
 */
export function normalizeSkinPng(img: HTMLImageElement): string | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!((w === 64 && h === 64) || (w === 64 && h === 32))) return null;
  if (w === 64 && h === 32) {
    // legacy → modern：规则在 lib/legacy-skin.ts（纯函数 + 逐像素搬运）
    return convertLegacySkinToModern(img);
  }
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}
