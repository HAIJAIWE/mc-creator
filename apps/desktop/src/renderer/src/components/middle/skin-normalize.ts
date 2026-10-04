/** 外部皮肤载入归一化：只接受 64x64（新格式）与 64x32（老格式）。 */

/** dataURL 解码为 Image，失败返回 null */
export function loadSkinImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * 归一化为 64x64 PNG dataURL：
 * - 64x64：原样返回
 * - 64x32：上半部照搬，下半部（表层）留透明
 * - 其他尺寸：返回 null（调用方直接拒绝）
 */
export function normalizeSkinPng(img: HTMLImageElement): string | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!((w === 64 && h === 64) || (w === 64 && h === 32))) return null;
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
