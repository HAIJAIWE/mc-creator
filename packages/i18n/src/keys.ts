/**
 * packages/i18n · 消息键（设计文档 §15 monorepo 结构；§4.5 错误文案映射层）。
 *
 * 只覆盖 shell / agent / 引擎层的操作与错误文案。
 * 渲染层文案归 apps/desktop/src/renderer/src/i18n，本包不碰。
 *
 * 纯类型模块，零依赖。
 */

/** 六分类错误文案键（§14；中文与 packages/shell errors.ts 逐字一致）。 */
export type ErrorCategoryKey =
  | 'error.category.network'
  | 'error.category.validation'
  | 'error.category.version'
  | 'error.category.disk'
  | 'error.category.permission'
  | 'error.category.unknown';

/** 文件错误码文案键（中文与 packages/shell FILE_ERROR_ZH 逐字一致）。 */
export type FileErrorKey =
  | 'error.file.not_found'
  | 'error.file.permission'
  | 'error.file.conflict'
  | 'error.file.disk_full'
  | 'error.file.invalid_path'
  | 'error.file.unknown';

/** 操作文案键（shell / agent / 引擎层的操作描述）。 */
export type OpKey =
  | 'op.generate'
  | 'op.build'
  | 'op.validate'
  | 'op.deploy'
  | 'op.restart'
  | 'op.rollback'
  | 'op.install'
  | 'op.launch';

/** X 类弹窗确认文案键（§10.6 执行须弹窗）。 */
export type ConfirmKey =
  | 'confirm.build'
  | 'confirm.deploy'
  | 'confirm.restart'
  | 'confirm.launch';

/** 任务状态文案键。 */
export type TaskKey =
  | 'task.queued'
  | 'task.running'
  | 'task.succeeded'
  | 'task.failed'
  | 'task.cancelled';

/** 全量消息键。 */
export type MessageKey =
  | ErrorCategoryKey
  | FileErrorKey
  | OpKey
  | ConfirmKey
  | TaskKey;

/** 全部消息键（运行时枚举，供全覆盖测试与完整性校验用）。 */
export const ALL_KEYS: readonly MessageKey[] = [
  'error.category.network',
  'error.category.validation',
  'error.category.version',
  'error.category.disk',
  'error.category.permission',
  'error.category.unknown',
  'error.file.not_found',
  'error.file.permission',
  'error.file.conflict',
  'error.file.disk_full',
  'error.file.invalid_path',
  'error.file.unknown',
  'op.generate',
  'op.build',
  'op.validate',
  'op.deploy',
  'op.restart',
  'op.rollback',
  'op.install',
  'op.launch',
  'confirm.build',
  'confirm.deploy',
  'confirm.restart',
  'confirm.launch',
  'task.queued',
  'task.running',
  'task.succeeded',
  'task.failed',
  'task.cancelled',
];
