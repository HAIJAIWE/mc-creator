export type BodyPartName =
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

export interface PartRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 各部位正脸矩形（画布像素坐标），与官方 64x64 展开图一致
 * （slim 手臂前脸宽 3px，经官方 slim-alex.png 像素探针验证）。
 */
export function getPartUVRect(partName: BodyPartName, model: ModelType): PartRect {
  const aw = model === 'slim' ? 3 : 4;
  switch (partName) {
    case 'head':
      return { x: 8, y: 8, w: 8, h: 8 };
    case 'headOverlay':
      return { x: 40, y: 8, w: 8, h: 8 };
    case 'body':
      return { x: 20, y: 20, w: 8, h: 12 };
    case 'bodyOverlay':
      return { x: 20, y: 36, w: 8, h: 12 };
    case 'rightArm':
      return { x: 44, y: 20, w: aw, h: 12 };
    case 'rightArmOverlay':
      return { x: 44, y: 36, w: aw, h: 12 };
    case 'leftArm':
      return { x: 36, y: 52, w: aw, h: 12 };
    case 'leftArmOverlay':
      return { x: 52, y: 52, w: aw, h: 12 };
    case 'rightLeg':
      return { x: 4, y: 20, w: 4, h: 12 };
    case 'rightLegOverlay':
      return { x: 4, y: 36, w: 4, h: 12 };
    case 'leftLeg':
      return { x: 20, y: 52, w: 4, h: 12 };
    case 'leftLegOverlay':
      return { x: 4, y: 52, w: 4, h: 12 };
  }
}

export type MirrorMode = 'off' | 'global' | 'bodypart';
export type ModelType = 'classic' | 'slim';

/** 部位镜像映射表（源自 PMCSkin3D 的镜像逻辑） */
const MIRROR_MAP: Record<BodyPartName, BodyPartName | null> = {
  head: 'head',
  headOverlay: 'headOverlay',
  body: 'body',
  bodyOverlay: 'bodyOverlay',
  rightArm: 'leftArm',
  rightArmOverlay: 'leftArmOverlay',
  leftArm: 'rightArm',
  leftArmOverlay: 'rightArmOverlay',
  rightLeg: 'leftLeg',
  rightLegOverlay: 'leftLegOverlay',
  leftLeg: 'rightLeg',
  leftLegOverlay: 'rightLegOverlay',
};

/** 获取镜像部位 */
export function getMirroredPart(partName: BodyPartName): BodyPartName | null {
  return MIRROR_MAP[partName] ?? null;
}

/** 获取部位在纹理上的镜像 X 坐标（基于 PMCSkin3D 的镜像算法） */
export function getMirroredTexX(model: ModelType, partName: BodyPartName, localX: number): number {
  const rect = getPartUVRect(partName, model);
  const partWidth = rect.w;
  // 在部位矩形内水平翻转
  const mirroredLocalX = partWidth - 1 - localX;
  return rect.x + mirroredLocalX;
}

/** 获取部位的镜像 UV 矩形 */
export function getMirroredUVRect(model: ModelType, partName: BodyPartName) {
  const rect = getPartUVRect(partName, model);
  return {
    x: rect.x + rect.w - 1, // 右边缘
    y: rect.y,
    w: rect.w,
    h: rect.h,
  };
}

/** 智能镜像：根据模式和部位决定是否镜像及镜像位置
 * @param localX 画布绝对 X 坐标（纹理像素）
 * @param localY 画布绝对 Y 坐标（纹理像素）
 */
export function getMirrorTarget(
  mode: MirrorMode,
  model: ModelType,
  partName: BodyPartName,
  localX: number,
  localY: number,
): { partName: BodyPartName; x: number; y: number } | null {
  if (mode === 'off') return null;

  const mirroredPart = getMirroredPart(partName);
  const srcRect = getPartUVRect(partName, model);
  // 源部位内的局部偏移（调用方传入的是画布绝对坐标）
  const lx = localX - srcRect.x;
  const ly = localY - srcRect.y;
  if (!mirroredPart || mirroredPart === partName) {
    // 自身镜像（头、身体等）
    if (mode === 'bodypart') {
      const mirroredX = getMirroredTexX(model, partName, lx);
      return { partName, x: mirroredX, y: localY };
    }
    return null;
  }

  // 交叉镜像（左臂<->右臂，左腿<->右腿）：Y 也要换算到目标部位矩形内
  if (mode === 'bodypart' || mode === 'global') {
    const targetRect = getPartUVRect(mirroredPart, model);
    const mirroredX = getMirroredTexX(model, mirroredPart, lx);
    return { partName: mirroredPart, x: mirroredX, y: targetRect.y + ly };
  }

  return null;
}

/** 在 Canvas 上执行镜像绘制 */
export function drawMirrored(
  ctx: CanvasRenderingContext2D,
  mode: MirrorMode,
  model: ModelType,
  partName: BodyPartName,
  centerX: number,
  centerY: number,
  brushSize: number,
  color: string,
  isEraser: boolean,
): void {
  const target = getMirrorTarget(mode, model, partName, centerX, centerY);
  if (!target) return;

  const { partName: mirrorPart, x: mirrorX, y: mirrorY } = target;
  const half = Math.floor(brushSize / 2);

  // 检查目标部位是否在画布范围内
  const mirrorRect = getPartUVRect(mirrorPart, model);
  if (
    mirrorX < mirrorRect.x ||
    mirrorX >= mirrorRect.x + mirrorRect.w ||
    mirrorY < mirrorRect.y ||
    mirrorY >= mirrorRect.y + mirrorRect.h
  ) {
    return;
  }

  if (isEraser) {
    ctx.clearRect(mirrorX - half, mirrorY - half, brushSize, brushSize);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(mirrorX - half, mirrorY - half, brushSize, brushSize);
  }
}
