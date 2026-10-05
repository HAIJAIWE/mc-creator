/**
 * Script API 未实现原因登记表（设计文档 §6.3 收尾条「不要生成一个引用了但
 * 不存在的包」）。
 *
 * 沿用 `packages/generator-mod/src/unsupported.ts` 的既有模式：
 * - 原因文案集中在固定表里，**禁止自由文本 `// TODO`**（文案即文档锚点）；
 * - 产物里的占位注释统一 `// MC-Creator: unsupported(<kind>=<type>): <原因>`；
 * - 每条产物占位必在 `collectScriptUnimplemented` 中登记，随
 *   `GenerationResult.unimplemented` 返回，并由 `warnings` 附中文行。
 *
 * 与 generator-mod 的差异（及原因）
 * ────────────────────────────
 * `UnimplementedItem['kind']` 在 shared 里是**闭集**
 * `'condition' | 'action' | 'event' | 'block'`，本次改动范围不含 shared，
 * 无法扩枚举。于是：
 * - 未支持的事件 → `kind: 'event'`（语义完全吻合）；
 * - 未支持的原生模块 → `kind: 'action'` + `type: 'module:<包名>'`，用
 *   `module:` 前缀把「这是模块而不是动作」标明，避免 UI 把模块数当动作数。
 * 若后续放开 shared 改动范围，应新增 `kind: 'module'` 并把这里切过去。
 */

import type { UnimplementedItem } from '@mc-creator/shared';
import { BP_SCRIPT_MODULES, type BpScriptActionKind, type BpScriptModule } from './script-spec.js';
import { afterEventBindings, beforeEventBindings, TICK_EVENT_NAME } from './script-events.js';
import type { ServerApiFamily } from './script-versions.js';

/** 未实现原因编码 → 固定文案（文案即 docs/unsupported.md 的锚点） */
export const SCRIPT_UNSUPPORTED_REASONS = {
  /** 事件名不在当前 API 家族的白名单里 */
  UNKNOWN_EVENT:
    '未知事件名：不在当前 @minecraft/server 版本的已验证事件表内，该事件处理器未注册，见 docs/unsupported.md#bedrock-script-unknown-event',
  /** 在 after 事件上要求 cancel */
  AFTER_EVENT_CANCEL:
    'after 事件不支持 event.cancel（只有 before 事件有可取消语义），已忽略 cancel，见 docs/unsupported.md#bedrock-script-after-event-cancel',
  /** before 事件在该家族不提供 cancel */
  BEFORE_EVENT_NOT_CANCELLABLE:
    '该 before 事件在当前 API 版本不支持 event.cancel，已忽略 cancel，见 docs/unsupported.md#bedrock-script-before-event-not-cancellable',
  /** tick 用 before 阶段 */
  TICK_BEFORE_PHASE:
    'tick 没有 before 语义（system 无 beforeEvents.tick），已按 after 处理，见 docs/unsupported.md#bedrock-script-tick-before-phase',
  /** 动作缺少必填参数 */
  ACTION_MISSING_ARG:
    '动作缺少必填参数，已生成带注释的空操作占位，见 docs/unsupported.md#bedrock-script-action-missing-arg',
  /** 动作在当前事件上下文里没有可用目标 */
  ACTION_NO_TARGET:
    '当前事件上下文没有该动作所需的目标（实体/方块/玩家），已跳过，见 docs/unsupported.md#bedrock-script-action-no-target',
  /** 表单触发事件不在白名单 */
  FORM_UNKNOWN_EVENT:
    '表单触发事件不在已验证事件表内，表单代码未生成，见 docs/unsupported.md#bedrock-script-form-unknown-event',
  /** 表单触发事件里没有玩家上下文（form.show(player) 需要 Player） */
  FORM_NO_PLAYER:
    '表单触发事件没有玩家上下文（form.show 需要 Player），表单代码未生成，见 docs/unsupported.md#bedrock-script-form-no-player',
  /** @minecraft/server-admin */
  MODULE_SERVER_ADMIN:
    '@minecraft/server-admin 仅为基岩专用服务器（BDS）模块且只有 beta 版，普通行为包无法加载，需手写 BDS 侧脚本，见 docs/unsupported.md#bedrock-script-module-server-admin',
  /** @minecraft/server-net */
  MODULE_SERVER_NET:
    '@minecraft/server-net 仅为基岩专用服务器（BDS）模块、只有 beta 版，且需在 BDS 的 config/<module-uuid>/permissions.json 里显式放行，普通行为包无法加载，需手写 BDS 侧脚本，见 docs/unsupported.md#bedrock-script-module-server-net',
} as const;

export type ScriptUnsupportedReasonKey = keyof typeof SCRIPT_UNSUPPORTED_REASONS;

/** 生成器内部可支持的原生模块集合（其余一律 unsupported，绝不生成假 import） */
export const SUPPORTED_SCRIPT_MODULES: readonly BpScriptModule[] = ['server', 'server-ui'];

/**
 * 未支持模块 → 原因码。
 *
 * 为什么只有 admin / net 两个：这两个在官方 API Modules 文档里被明确标注为
 * "only allowed on Bedrock Dedicated Servers" 且 "exists only in experimental
 * form"。把它们做成「能生成」的产物等于产出一个在任何玩家端 / 世界里都加载
 * 失败的包，比不生成更糟。`server` 与 `server-ui` 有稳定版、可在玩家端加载，
 * 故纳入支持。
 */
const UNSUPPORTED_MODULE_REASONS: Record<string, ScriptUnsupportedReasonKey> = {
  'server-admin': 'MODULE_SERVER_ADMIN',
  'server-net': 'MODULE_SERVER_NET',
};

/** 取某模块的原因码；支持内则返回 undefined */
export function unsupportedModuleReason(module: string): ScriptUnsupportedReasonKey | undefined {
  return UNSUPPORTED_MODULE_REASONS[module];
}

/** 产物占位注释统一格式（行注释，保持 JavaScript 可解析） */
export function formatScriptUnsupportedComment(
  kind: UnimplementedItem['kind'],
  type: string,
  reasonKey: ScriptUnsupportedReasonKey,
): string {
  return `// MC-Creator: unsupported(${kind}=${type}): ${SCRIPT_UNSUPPORTED_REASONS[reasonKey]}`;
}

/** 判断某模块是否受支持 */
export function isModuleSupported(module: BpScriptModule): boolean {
  return (SUPPORTED_SCRIPT_MODULES as readonly string[]).includes(module);
}

/** 判断某事件在给定 API 家族 + 阶段下是否已验证 */
export function isEventKnown(
  family: ServerApiFamily,
  phase: 'after' | 'before',
  event: string,
): boolean {
  if (event === TICK_EVENT_NAME) return phase === 'after';
  return phase === 'after'
    ? Object.hasOwn(afterEventBindings(family), event)
    : Object.hasOwn(beforeEventBindings(family), event);
}

/** 判断 before 事件在给定家族下是否支持 cancel */
export function isCancellable(
  family: ServerApiFamily,
  phase: 'after' | 'before',
  event: string,
): boolean {
  if (phase === 'after') return false;
  return beforeEventBindings(family)[event]?.cancellable === true;
}

/** 未实现条目 → warnings 文案（一行一条，供 UI 横幅与导出清单复用） */
export function scriptUnimplementedWarning(item: UnimplementedItem): string {
  const where = item.id ? `（id=${item.id}）` : '';
  return `未实现${item.kind}=${item.type}${where}：${item.reason}`;
}

/** 本包需要登记的"动作必填参数"清单（供 codegen 与本表共用，避免两处漂移） */
export const ACTION_REQUIRED_ARG: Record<BpScriptActionKind, keyof BpScriptActionShape> = {
  spawn_entity: 'entityType',
  set_block: 'blockType',
  add_tag: 'tag',
  remove_tag: 'tag',
  send_message: 'text',
  add_effect: 'effectType',
  play_sound: 'soundType',
  give_item: 'itemType',
};

/** 动作形状（与 BpScriptActionSpec 同步的最小投影，仅用于取必填字段名） */
type BpScriptActionShape = {
  entityType?: string;
  blockType?: string;
  tag?: string;
  text?: string;
  effectType?: string;
  soundType?: string;
  itemType?: string;
};

/** 本包登记过的全部模块枚举值（防止 spec 扩枚举时漏登记原因码） */
export const KNOWN_SCRIPT_MODULES: readonly BpScriptModule[] = BP_SCRIPT_MODULES;
