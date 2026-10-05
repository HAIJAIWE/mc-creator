/**
 * Skin UV 映射系统
 * 定义 Minecraft 皮肤各部位在 64x64 纹理中的 UV 矩形区域
 * 支持 classic (4px arms) 和 slim (3px arms) 两种模型
 */

export type BodyPartId =
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

export type ModelType = 'classic' | 'slim';

/** 纹理矩形区域 */
export interface TextureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 部位元数据 */
export interface BodyPartInfo {
  id: BodyPartId;
  label: string;
  overlayLabel?: string;
  rect: TextureRect;
  overlayRect?: TextureRect;
  isOverlay: boolean;
  parent?: BodyPartId;
  children?: BodyPartId[];
}

/** 获取模型的臂宽 */
export function getArmWidth(model: ModelType): number {
  return model === 'slim' ? 3 : 4;
}

/** 基础 UV 映射（classic 4px arms） */
const CLASSIC_UV_MAP: Record<BodyPartId, TextureRect> = {
  // Head (8x8x8) at (8,8) - 6 faces
  head: { x: 8, y: 8, width: 8, height: 8 },
  headOverlay: { x: 40, y: 8, width: 8, height: 8 },

  // Body (12x8x4) front at (20,20) - 8x12
  body: { x: 20, y: 20, width: 8, height: 12 },
  bodyOverlay: { x: 20, y: 36, width: 8, height: 12 },

  // Right Arm (12x4x4) front at (44,20) - 4x12 (classic)
  rightArm: { x: 44, y: 20, width: 4, height: 12 },
  rightArmOverlay: { x: 52, y: 20, width: 4, height: 12 },

  // Left Arm (12x4x4) front at (36,52) - 4x12 (classic)
  leftArm: { x: 36, y: 52, width: 4, height: 12 },
  leftArmOverlay: { x: 48, y: 52, width: 4, height: 12 },

  // Right Leg (12x4x4) front at (4,20) - 4x12
  rightLeg: { x: 4, y: 20, width: 4, height: 12 },
  rightLegOverlay: { x: 4, y: 36, width: 4, height: 12 },

  // Left Leg (12x4x4) front at (20,52) - 4x12
  leftLeg: { x: 20, y: 52, width: 4, height: 12 },
  leftLegOverlay: { x: 20, y: 36, width: 4, height: 12 },
};

/** Slim (3px arms) UV 映射 */
const SLIM_UV_MAP: Record<BodyPartId, TextureRect> = {
  // Head (same as classic)
  head: { x: 8, y: 8, width: 8, height: 8 },
  headOverlay: { x: 40, y: 8, width: 8, height: 8 },

  // Body (same as classic)
  body: { x: 20, y: 20, width: 8, height: 12 },
  bodyOverlay: { x: 20, y: 36, width: 8, height: 12 },

  // Right Arm (12x3x4) front at (44,20) - 3x12 (slim)
  rightArm: { x: 44, y: 20, width: 3, height: 12 },
  rightArmOverlay: { x: 51, y: 20, width: 3, height: 12 },

  // Left Arm (12x3x4) front at (37,52) - 3x12 (slim) - note: 37 not 36
  leftArm: { x: 37, y: 52, width: 3, height: 12 },
  leftArmOverlay: { x: 49, y: 52, width: 3, height: 12 },

  // Right Leg (same as classic)
  rightLeg: { x: 4, y: 20, width: 4, height: 12 },
  rightLegOverlay: { x: 4, y: 36, width: 4, height: 12 },

  // Left Leg (same as classic)
  leftLeg: { x: 20, y: 52, width: 4, height: 12 },
  leftLegOverlay: { x: 20, y: 36, width: 4, height: 12 },
};

/** 获取部位矩形 */
export function getBodyPartRect(
  model: ModelType,
  partId: BodyPartId,
  isOverlay = false,
): TextureRect {
  const map = model === 'slim' ? SLIM_UV_MAP : CLASSIC_UV_MAP;
  const key = (
    isOverlay && !partId.endsWith('Overlay') ? `${partId}Overlay` : partId
  ) as BodyPartId;
  return map[key];
}

/** 部位元数据配置 */
export const BODY_PART_INFOS: Record<BodyPartId, BodyPartInfo> = {
  head: {
    id: 'head',
    label: '头部',
    overlayLabel: '帽子',
    rect: CLASSIC_UV_MAP.head,
    overlayRect: CLASSIC_UV_MAP.headOverlay,
    isOverlay: false,
    children: ['headOverlay'],
  },
  headOverlay: {
    id: 'headOverlay',
    label: '帽子',
    rect: CLASSIC_UV_MAP.headOverlay,
    isOverlay: true,
    parent: 'head',
  },
  body: {
    id: 'body',
    label: '身体',
    overlayLabel: '外套',
    rect: CLASSIC_UV_MAP.body,
    overlayRect: CLASSIC_UV_MAP.bodyOverlay,
    isOverlay: false,
    children: ['bodyOverlay'],
  },
  bodyOverlay: {
    id: 'bodyOverlay',
    label: '外套',
    rect: CLASSIC_UV_MAP.bodyOverlay,
    isOverlay: true,
    parent: 'body',
  },
  rightArm: {
    id: 'rightArm',
    label: '右臂',
    overlayLabel: '右袖',
    rect: CLASSIC_UV_MAP.rightArm,
    overlayRect: CLASSIC_UV_MAP.rightArmOverlay,
    isOverlay: false,
    children: ['rightArmOverlay'],
  },
  rightArmOverlay: {
    id: 'rightArmOverlay',
    label: '右袖',
    rect: CLASSIC_UV_MAP.rightArmOverlay,
    isOverlay: true,
    parent: 'rightArm',
  },
  leftArm: {
    id: 'leftArm',
    label: '左臂',
    overlayLabel: '左袖',
    rect: CLASSIC_UV_MAP.leftArm,
    overlayRect: CLASSIC_UV_MAP.leftArmOverlay,
    isOverlay: false,
    children: ['leftArmOverlay'],
  },
  leftArmOverlay: {
    id: 'leftArmOverlay',
    label: '左袖',
    rect: CLASSIC_UV_MAP.leftArmOverlay,
    isOverlay: true,
    parent: 'leftArm',
  },
  rightLeg: {
    id: 'rightLeg',
    label: '右腿',
    overlayLabel: '右裤',
    rect: CLASSIC_UV_MAP.rightLeg,
    overlayRect: CLASSIC_UV_MAP.rightLegOverlay,
    isOverlay: false,
    children: ['rightLegOverlay'],
  },
  rightLegOverlay: {
    id: 'rightLegOverlay',
    label: '右裤',
    rect: CLASSIC_UV_MAP.rightLegOverlay,
    isOverlay: true,
    parent: 'rightLeg',
  },
  leftLeg: {
    id: 'leftLeg',
    label: '左腿',
    overlayLabel: '左裤',
    rect: CLASSIC_UV_MAP.leftLeg,
    overlayRect: CLASSIC_UV_MAP.leftLegOverlay,
    isOverlay: false,
    children: ['leftLegOverlay'],
  },
  leftLegOverlay: {
    id: 'leftLegOverlay',
    label: '左裤',
    rect: CLASSIC_UV_MAP.leftLegOverlay,
    isOverlay: true,
    parent: 'leftLeg',
  },
};

/** 部位显示顺序 */
export const BODY_PART_DISPLAY_ORDER: BodyPartId[] = [
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

/** UV 坐标转换：纹理像素 (0-63) -> UV (0-1) */
export function texToUV(x: number, y: number): { u: number; v: number } {
  return { u: (x + 0.5) / 64, v: (y + 0.5) / 64 };
}

/** UV 转纹理像素 */
export function uvToTex(u: number, v: number): { x: number; y: number } {
  return {
    x: Math.floor(u * 64),
    y: Math.floor(v * 64),
  };
}

/** 判断点是否在矩形内 */
export function pointInRect(x: number, y: number, rect: TextureRect): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** 获取点击位置对应的部位 */
export function getBodyPartAt(model: ModelType, x: number, y: number): BodyPartId | null {
  const map = getArmWidth(model) === 3 ? getSlimBodyPartAt : getClassicBodyPartAt;
  return map(x, y);
}

/** Classic 模型点击检测 */
function getClassicBodyPartAt(x: number, y: number): BodyPartId | null {
  // Head overlay
  if (x >= 40 && x < 48 && y >= 8 && y < 16) return 'headOverlay';
  // Head
  if (x >= 8 && x < 16 && y >= 8 && y < 16) return 'head';
  // Body overlay
  if (x >= 20 && x < 28 && y >= 36 && y < 48) return 'bodyOverlay';
  // Body
  if (x >= 20 && x < 28 && y >= 20 && y < 32) return 'body';
  // Right arm overlay（前脸）
  if (x >= 44 && x < 48 && y >= 36 && y < 48) return 'rightArmOverlay';
  // Right arm
  if (x >= 44 && x < 48 && y >= 20 && y < 32) return 'rightArm';
  // Left arm overlay（前脸）
  if (x >= 52 && x < 56 && y >= 52 && y < 64) return 'leftArmOverlay';
  // Left arm
  if (x >= 36 && x < 40 && y >= 52 && y < 64) return 'leftArm';
  // Right leg overlay
  if (x >= 4 && x < 8 && y >= 36 && y < 48) return 'rightLegOverlay';
  // Right leg
  if (x >= 4 && x < 8 && y >= 20 && y < 32) return 'rightLeg';
  // Left leg overlay（前脸 x=4-7, y=52-63）
  if (x >= 4 && x < 8 && y >= 52 && y < 64) return 'leftLegOverlay';
  // Left leg
  if (x >= 20 && x < 24 && y >= 52 && y < 64) return 'leftLeg';

  return null;
}

/** Slim 模型点击检测 */
function getSlimBodyPartAt(x: number, y: number): BodyPartId | null {
  // Head overlay
  if (x >= 40 && x < 48 && y >= 8 && y < 16) return 'headOverlay';
  // Head
  if (x >= 8 && x < 16 && y >= 8 && y < 16) return 'head';
  // Body overlay
  if (x >= 20 && x < 28 && y >= 36 && y < 48) return 'bodyOverlay';
  // Body
  if (x >= 20 && x < 28 && y >= 20 && y < 32) return 'body';
  // Right arm overlay (3px，前脸)
  if (x >= 44 && x < 47 && y >= 36 && y < 48) return 'rightArmOverlay';
  // Right arm (3px)
  if (x >= 44 && x < 47 && y >= 20 && y < 32) return 'rightArm';
  // Left arm overlay (3px，前脸 x=52-54)
  if (x >= 52 && x < 55 && y >= 52 && y < 64) return 'leftArmOverlay';
  // Left arm (3px，前脸 x=36-38，像素探针验证）
  if (x >= 36 && x < 39 && y >= 52 && y < 64) return 'leftArm';
  // Right leg overlay
  if (x >= 4 && x < 8 && y >= 36 && y < 48) return 'rightLegOverlay';
  // Right leg
  if (x >= 4 && x < 8 && y >= 20 && y < 32) return 'rightLeg';
  // Left leg overlay（前脸 x=4-7, y=52-63）
  if (x >= 4 && x < 8 && y >= 52 && y < 64) return 'leftLegOverlay';
  // Left leg
  if (x >= 20 && x < 24 && y >= 52 && y < 64) return 'leftLeg';

  return null;
}

/** 镜像坐标转换：根据部位返回镜像后的坐标 */
export function mirrorCoordinate(
  model: ModelType,
  partId: BodyPartId,
  x: number,
  y: number,
): { x: number; y: number } {
  const rect = getBodyPartRect(model, partId, false);
  const overlayRect = getBodyPartRect(model, partId, true);

  // 计算相对于部位的局部坐标
  const localX = x - rect.x;

  // 镜像：在部位矩形内水平翻转
  const mirroredLocalX = rect.width - 1 - localX;
  const mirroredX = rect.x + mirroredLocalX;

  // 如果有 overlay，也镜像 overlay 区域（仅当点击点本身在 overlay 区域内）
  if (overlayRect && pointInRect(x, y, overlayRect)) {
    const overlayLocalX = x - overlayRect.x;
    const mirroredOverlayLocalX = overlayRect.width - 1 - overlayLocalX;
    return {
      x: overlayRect.x + mirroredOverlayLocalX,
      y: y,
    };
  }

  return { x: mirroredX, y: y };
}

/** 检查坐标是否在部位内（用于部位隔离） */
export function isInBodyPart(
  model: ModelType,
  partId: BodyPartId,
  x: number,
  y: number,
  includeOverlay = true,
): boolean {
  const rect = getBodyPartRect(model, partId, false);
  if (pointInRect(x, y, rect)) return true;

  if (includeOverlay) {
    const overlayRect = getBodyPartRect(model, partId, true);
    if (pointInRect(x, y, overlayRect)) return true;
  }
  return false;
}
