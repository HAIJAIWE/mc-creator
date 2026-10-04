/**
 * packages/i18n · 英文文案（设计文档 §4.5 错误文案映射层）。
 * key 全集与 zh.ts 一一对应（i18n.test.ts 全覆盖锁定）。
 *
 * 纯数据模块，零依赖。
 */
import type { MessageKey } from './keys.js';

export const en: Record<MessageKey, string> = {
  'error.category.network': 'Network error. Check your connection and try again.',
  'error.category.validation': 'Validation failed. The downloaded content may be corrupted; please download it again.',
  'error.category.version': 'Version mismatch. Confirm the version and try again.',
  'error.category.disk': 'Disk error: insufficient space or write failure. Free up disk space and try again.',
  'error.category.permission': 'Insufficient permission. Re-run with sufficient privileges and try again.',
  'error.category.unknown': 'An unknown error occurred. Check the logs and try again.',
  'error.file.not_found': 'File not found',
  'error.file.permission': 'Permission denied',
  'error.file.conflict': 'File conflict',
  'error.file.disk_full': 'Insufficient disk space',
  'error.file.invalid_path': 'Invalid path',
  'error.file.unknown': 'Unknown file error',
  'op.generate': 'Generate content',
  'op.build': 'Build project',
  'op.validate': 'Validate content',
  'op.deploy': 'Deploy plugin',
  'op.restart': 'Restart server',
  'op.rollback': 'Roll back build',
  'op.install': 'Install content',
  'op.launch': 'Launch instance',
  'confirm.build': 'Confirm build project?',
  'confirm.deploy': 'Confirm deploy plugin?',
  'confirm.restart': 'Confirm restart server?',
  'confirm.launch': 'Confirm launch instance?',
  'task.queued': 'Task queued',
  'task.running': 'Task running',
  'task.succeeded': 'Task succeeded',
  'task.failed': 'Task failed',
  'task.cancelled': 'Task cancelled',
};
