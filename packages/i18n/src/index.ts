/**
 * packages/i18n · 查询入口（设计文档 §15 monorepo 结构；§4.5 错误文案映射层）。
 *
 * - `t(key, lang)`：查文案，en 缺 key 回退中文；中英都缺返回 key 本身
 *   （fail-open：调用方永远拿到可展示字符串）。
 * - `opConfirm(tool, lang)`：X 类工具返回对应弹窗确认文案，无专属确认
 *   文案的工具（R / W / 其余 X）返回 null，即无需弹窗。
 *
 * 纯函数模块，零依赖。
 */
import { en } from './en.js';
import type {
  ConfirmKey,
  ErrorCategoryKey,
  FileErrorKey,
  MessageKey,
  OpKey,
  TaskKey,
} from './keys.js';
import { ALL_KEYS } from './keys.js';
import { zh } from './zh.js';

export type { ConfirmKey, ErrorCategoryKey, FileErrorKey, MessageKey, OpKey, TaskKey };
export { ALL_KEYS };
export { en };
export { zh };

/** 支持语言。 */
export type Lang = 'zh' | 'en';

/**
 * 查文案。en 缺 key 回退中文，中文也缺返回 key 本身。
 */
export function t(key: MessageKey, lang: Lang = 'zh'): string {
  if (lang !== 'zh') {
    const hit: string | undefined = en[key];
    if (hit !== undefined && hit !== '') return hit;
  }
  const zhHit: string | undefined = zh[key];
  if (zhHit !== undefined && zhHit !== '') return zhHit;
  return key;
}

/**
 * X 类工具 → 确认文案键（§10.6 执行须弹窗；键名取自
 * packages/contract MCP_TOOL_PERMISSIONS）。
 * 只有 4 个有专属确认文案的 X 类工具返回非空；R / W 类与
 * 其余 X 类工具（create_instance / delete_instance / stop_server /
 * rollback_build / generate_content）返回 null。
 */
const TOOL_CONFIRM_KEY: Record<string, ConfirmKey> = {
  build_project: 'confirm.build',
  deploy_plugin: 'confirm.deploy',
  restart_server: 'confirm.restart',
  launch_instance: 'confirm.launch',
};

/** 工具名 → 弹窗确认文案；无需弹窗返回 null。 */
export function opConfirm(tool: string, lang: Lang = 'zh'): string | null {
  const key: ConfirmKey | undefined = TOOL_CONFIRM_KEY[tool];
  if (key === undefined) return null;
  return t(key, lang);
}
