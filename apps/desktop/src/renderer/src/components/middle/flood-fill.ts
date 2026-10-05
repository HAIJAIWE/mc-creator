import { getMirroredTexX, getPartUVRect } from './skin-mirror.js';

export type MirrorMode = 'off' | 'global' | 'bodypart';

export type ModelType = 'classic' | 'slim';

interface FloodFillOptions {
  ctx: CanvasRenderingContext2D;
  sx: number;
  sy: number;
  color: string;
  mirrorMode: MirrorMode;
  model: ModelType;
  partName: BodyPartName;
}

type BodyPartName =
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

/**
 * Flood fill algorithm with optional smart mirroring
 */
export function floodFill({
  ctx,
  sx,
  sy,
  color,
  mirrorMode,
  model,
  partName,
}: FloodFillOptions): void {
  if (sx < 0 || sy < 0 || sx >= 64 || sy >= 64) return;

  const img = ctx.getImageData(0, 0, 64, 64);
  const d = img.data;
  const si = (sy * 64 + sx) * 4;
  const tr = d[si] ?? 0;
  const tg = d[si + 1] ?? 0;
  const tb = d[si + 2] ?? 0;
  const ta = d[si + 3] ?? 0;

  const hex = color;
  const fr = parseInt(hex.slice(1, 3), 16);
  const fg = parseInt(hex.slice(3, 5), 16);
  const fb = parseInt(hex.slice(5, 7), 16);

  if (tr === fr && tg === fg && tb === fb && ta === 255) return;

  const stack: Array<[number, number]> = [[sx, sy]];
  const seen = new Uint8Array(64 * 64);

  const match = (x: number, y: number): boolean => {
    const i = (y * 64 + x) * 4;
    return d[i] === tr && d[i + 1] === tg && d[i + 2] === tb && d[i + 3] === ta;
  };

  const paint = (x: number, y: number) => {
    const i = (y * 64 + x) * 4;
    d[i] = fr;
    d[i + 1] = fg;
    d[i + 2] = fb;
    d[i + 3] = 255;
  };

  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    if (x < 0 || y < 0 || x >= 64 || y >= 64 || seen[y * 64 + x] === 1 || !match(x, y)) continue;
    seen[y * 64 + x] = 1;
    paint(x, y);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  ctx.putImageData(img, 0, 0);

  // Smart mirroring（仅种子落在部位正脸矩形内时镜像，避免侧面落笔写到错误区域）
  if (mirrorMode !== 'off') {
    const rect = getPartUVRect(partName, model);
    const localX = sx - rect.x;
    const localY = sy - rect.y;
    if (localX < 0 || localX >= rect.w || localY < 0 || localY >= rect.h) return;

    const mx = getMirroredTexX(model, partName, localX);
    if (mx !== sx) {
      const img2 = ctx.getImageData(0, 0, 64, 64);
      const d2 = img2.data;
      const mi = (sy * 64 + mx) * 4;
      const mr = d2[mi] ?? 0;
      const mg = d2[mi + 1] ?? 0;
      const mb = d2[mi + 2] ?? 0;
      const ma = d2[mi + 3] ?? 0;

      if (!(mr === fr && mg === fg && mb === fb && ma === 255)) {
        const stack2: Array<[number, number]> = [[mx, sy]];
        const seen2 = new Uint8Array(64 * 64);

        while (stack2.length > 0) {
          const [x, y] = stack2.pop() as [number, number];
          if (x < 0 || y < 0 || x >= 64 || y >= 64 || seen2[y * 64 + x] === 1) continue;
          const i = (y * 64 + x) * 4;
          if (!(d2[i] === mr && d2[i + 1] === mg && d2[i + 2] === mb && d2[i + 3] === ma)) continue;
          seen2[y * 64 + x] = 1;
          d2[i] = fr;
          d2[i + 1] = fg;
          d2[i + 2] = fb;
          d2[i + 3] = 255;
          stack2.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
        ctx.putImageData(img2, 0, 0);
      }
    }
  }
}
