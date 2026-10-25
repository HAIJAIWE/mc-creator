/**
 * 皮肤编辑器用的**部位元数据 + 点击命中**。
 *
 * UV 数字**不在这个文件里** —— 12 个槽位的前脸全部来自 `lib/skin-layout.ts`
 * （唯一来源，拿真皮肤图逐块核对过）。这里只负责：有哪些部位、叫什么名字、
 * 谁是谁的第二层、点到的是哪一块。
 *
 * 之前这里手抄过一份 UV 表，漂了三处（`rightArmOverlay` 抄成手臂背面 `(52,20)`、
 * `leftArmOverlay` 抄成 `(48,52)`、`leftLegOverlay` 抄成 `(20,36)` 撞进躯干外套），
 * 而且 slim 左臂前脸写 37 跟自己的点击检测（36）都对不上。
 */

import {
  SKIN_SLOT_IDS,
  type SkinModel,
  type SkinSlotId,
  type SkinSlotRect,
  slotRect,
} from '../../lib/skin-layout.js';

/** 部位标识。名字沿用 `lib/skin-layout.ts` 的槽位 id（玩家的右臂就是 `rightArm`）。 */
export type BodyPartId = SkinSlotId;

export type ModelType = SkinModel;

/** 纹理矩形区域（前脸）。 */
export type TextureRect = SkinSlotRect;

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

/**
 * classic（4px 手臂）的前脸矩形表。
 *
 * 数字来自 `lib/skin-layout.ts`；`BODY_PART_INFOS` 里那份静态元数据用它（那是
 * 与模型无关的展示用数据，按模型取的地方走 `getBodyPartRect`）。
 */
const CLASSIC_UV_MAP: Record<BodyPartId, TextureRect> = Object.fromEntries(
  SKIN_SLOT_IDS.map((slot) => [slot, slotRect('classic', slot)]),
) as Record<BodyPartId, TextureRect>;

/** 获取部位矩形 */
export function getBodyPartRect(
  model: ModelType,
  partId: BodyPartId,
  isOverlay = false,
): TextureRect {
  const key = (
    isOverlay && !partId.endsWith('Overlay') ? `${partId}Overlay` : partId
  ) as BodyPartId;
  return slotRect(model, key);
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

/** 判断点是否在矩形内 */
export function pointInRect(x: number, y: number, rect: TextureRect): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * 点击命中的判定顺序：**第二层排在主层前面**。
 *
 * 第二层画在主层外面，点在两层叠着的地方应该命中第二层（用户点的是他看得见的那层）。
 * 12 个槽位两两不重叠（`skin-layout.test.ts` 钉着），所以这个顺序只在
 * 「主层 vs 同部位的第二层」之间有影响。
 */
const CLICK_ORDER: readonly BodyPartId[] = [
  'headOverlay',
  'head',
  'bodyOverlay',
  'body',
  'rightArmOverlay',
  'rightArm',
  'leftArmOverlay',
  'leftArm',
  'rightLegOverlay',
  'rightLeg',
  'leftLegOverlay',
  'leftLeg',
];

/**
 * 取贴图坐标命中的部位。
 *
 * 只认**前脸**（编辑器编辑的就是前脸），没落在任何前脸上返回 `null`。
 *
 * 之前这里手写了两份 classic/slim 的坐标比较（同一个布局的第四份拷贝），
 * 现在按唯一来源逐个矩形判。
 */
export function getBodyPartAt(model: ModelType, x: number, y: number): BodyPartId | null {
  for (const slot of CLICK_ORDER) {
    if (pointInRect(x, y, slotRect(model, slot))) return slot;
  }
  return null;
}
