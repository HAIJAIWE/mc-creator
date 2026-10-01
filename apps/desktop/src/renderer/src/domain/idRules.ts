import type { FieldType } from './field-types.js';

/**
 * ID 类字段的取值规则（单一来源）。
 *
 * 两类 ID 语义相反，此前规则分散在 NodeDetailForm 与 drawer-store 两处、
 * 且文案不一致，容易再次漂移，故统一到这里：
 * - `localId`（定义型）：本 mod 自身内容的标识，取值必须是裸 id
 * - `resourceId`（引用型）：指向其他 mod / 原版物品，取值必须是 `namespace:path`
 */

/** 定义型 ID：小写字母 / 数字 / 下划线 */
export const LOCAL_ID_PATTERN = /^[a-z0-9_]+$/;

/** 引用型 ID：namespace:path */
export const RESOURCE_ID_PATTERN = /^[a-z0-9_]+:[a-z0-9_/]+$/;

export const LOCAL_ID_ERROR = '格式错误，只能包含小写字母、数字与下划线';
export const RESOURCE_ID_ERROR = '格式错误，应为 modid:path（全小写+下划线）';

/**
 * 校验 ID 类字段的取值。
 *
 * 空值与非 ID 类型返回 undefined —— 必填校验由调用方负责，
 * 避免「未填写」被同时报成「格式错误」。
 */
export function validateIdField(type: FieldType, value: string): string | undefined {
  if (value.length === 0) return undefined;
  if (type === 'localId') {
    return LOCAL_ID_PATTERN.test(value) ? undefined : LOCAL_ID_ERROR;
  }
  if (type === 'resourceId') {
    return RESOURCE_ID_PATTERN.test(value) ? undefined : RESOURCE_ID_ERROR;
  }
  return undefined;
}
