import type { UnimplementedItem } from '@mc-creator/shared';

/**
 * 未实现原因登记表（Task 1.1）。
 *
 * 约束：产物中的占位注释只允许使用本表中的固定文案 + `formatUnsupportedComment`
 * 统一格式，禁止自由文本 `// TODO`。每条产物占位必在 `collectUnimplemented`
 * 中登记对应条目，随 GenerationResult 返回。
 *
 * 原因编码 → 文案（中英双语，文案即文档锚点，见 docs/unsupported.md）：
 */
export const UNSUPPORTED_REASONS = {
  /** 未知条件类型（不在 mod-spec ConditionSpec 枚举中，多为手改 JSON/旧 Spec 迁移残留） */
  UNKNOWN_CONDITION:
    '未知条件类型：不在支持的 conditionType 枚举中，已生成恒真占位，见 docs/unsupported.md#unknown-condition',
  /** 未知动作类型 */
  UNKNOWN_ACTION:
    '未知动作类型：不在支持的 actionType 枚举中，已生成空操作占位，见 docs/unsupported.md#unknown-action',
  /** 未知事件类型 */
  UNKNOWN_EVENT:
    '未知事件类型：不在支持的 eventType 枚举中，该处理器未注册，见 docs/unsupported.md#unknown-event',
  /** custom 条件/动作未填代码 */
  CUSTOM_EMPTY:
    'custom 类型未填写 customCode，已生成安全默认占位，见 docs/unsupported.md#custom-empty',
  /** custom 事件需手写 Mixin/注册 */
  CUSTOM_EVENT:
    'custom 事件无内置映射，需手写 Mixin 或事件注册，见 docs/unsupported.md#custom-event',
} as const;

export type UnsupportedReasonKey = keyof typeof UNSUPPORTED_REASONS;

/** 产物占位注释统一格式（保持 Java 可编译：行注释） */
export function formatUnsupportedComment(
  kind: UnimplementedItem['kind'],
  type: string,
  reasonKey: UnsupportedReasonKey,
): string {
  return `// MC-Creator: unsupported(${kind}=${type}): ${UNSUPPORTED_REASONS[reasonKey]}`;
}

/** 宽松 spec 形状（adapter 内增量 spec 可能为 string 枚举之外的值，防御性处理） */
export interface UnsupportedSpecLike {
  conditions?: Array<{
    conditionId?: string;
    conditionType: string;
    customCode?: string;
    args?: Record<string, unknown>;
  }>;
  actions?: Array<{
    actionId?: string;
    actionType: string;
    customCode?: string;
    args?: Record<string, unknown>;
  }>;
  eventHandlers?: Array<{ handlerId?: string; eventType: string }>;
}

/** event-logic.ts / mojang-event-logic.ts 已覆盖的条件类型（其余视为未知） */
const KNOWN_CONDITIONS = new Set([
  'has_item',
  'health_below',
  'health_above',
  'distance_less',
  'distance_greater',
  'is_day',
  'is_night',
  'is_raining',
  'biome_is',
  'block_is',
  'custom',
]);

/** 已覆盖的动作类型 */
const KNOWN_ACTIONS = new Set([
  'spawn_entity',
  'give_item',
  'take_item',
  'teleport',
  'damage',
  'heal',
  'set_block',
  'remove_block',
  'play_sound',
  'send_message',
  'summon_lightning',
  'give_effect',
  'custom',
]);

/** fabric-java.ts / neoforge 侧有显式 case 的事件类型 */
const KNOWN_EVENTS = new Set([
  'player_right_click_block',
  'player_right_click_item',
  'player_left_click',
  'block_break',
  'block_place',
  'entity_death',
  'entity_hurt',
  'item_use',
  'item_pickup',
  'player_join',
  'player_quit',
  'tick',
  'custom',
]);

/**
 * 扫描 spec 收集未实现条目（ModGenerator.generate/generateWithCache 共用）。
 * - 未知 condition/action/event 类型 → UNKNOWN_* 条目
 * - custom 条件/动作未填 customCode → CUSTOM_EMPTY 条目
 * - eventType=custom → CUSTOM_EVENT 条目（需手写 Mixin）
 */
export function collectUnimplemented(
  spec: UnsupportedSpecLike,
  loader: string,
): UnimplementedItem[] {
  const out: UnimplementedItem[] = [];
  for (const c of spec.conditions ?? []) {
    if (!KNOWN_CONDITIONS.has(c.conditionType)) {
      out.push({
        kind: 'condition',
        type: c.conditionType,
        id: c.conditionId ?? '',
        reason: UNSUPPORTED_REASONS.UNKNOWN_CONDITION,
      });
    } else if (c.conditionType === 'custom' && !(c.customCode ?? '').trim()) {
      out.push({
        kind: 'condition',
        type: 'custom',
        id: c.conditionId ?? '',
        reason: UNSUPPORTED_REASONS.CUSTOM_EMPTY,
      });
    }
  }
  for (const a of spec.actions ?? []) {
    if (!KNOWN_ACTIONS.has(a.actionType)) {
      out.push({
        kind: 'action',
        type: a.actionType,
        id: a.actionId ?? '',
        reason: UNSUPPORTED_REASONS.UNKNOWN_ACTION,
      });
    } else if (a.actionType === 'custom' && !(a.customCode ?? '').trim()) {
      out.push({
        kind: 'action',
        type: 'custom',
        id: a.actionId ?? '',
        reason: UNSUPPORTED_REASONS.CUSTOM_EMPTY,
      });
    }
  }
  for (const h of spec.eventHandlers ?? []) {
    if (!KNOWN_EVENTS.has(h.eventType)) {
      out.push({
        kind: 'event',
        type: h.eventType,
        id: h.handlerId ?? '',
        reason: UNSUPPORTED_REASONS.UNKNOWN_EVENT,
      });
    } else if (h.eventType === 'custom') {
      out.push({
        kind: 'event',
        type: 'custom',
        id: h.handlerId ?? '',
        reason: `${UNSUPPORTED_REASONS.CUSTOM_EVENT}（loader=${loader}）`,
      });
    }
  }
  return out;
}

/** 未实现条目 → warnings 文案（一行一条，供 UI 横幅与导出清单复用） */
export function unimplementedWarning(item: UnimplementedItem): string {
  const where = item.id ? `（id=${item.id}）` : '';
  return `未实现${item.kind}=${item.type}${where}：${item.reason}`;
}
