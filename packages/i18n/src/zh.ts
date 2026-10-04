/**
 * packages/i18n · 中文文案（设计文档 §4.5 错误文案映射层）。
 *
 * 错误类 12 条与 packages/shell/src/errors.ts 逐字一致：
 * - `error.category.*` = CLASSIFIED_ERROR_DESC_ZH（六分类中文说明 + 重试建议）；
 * - `error.file.*` = FILE_ERROR_ZH（文件错误码中文标题）。
 * shell 侧改文案时必须同步改这里（i18n.test.ts 全量比对锁定）。
 *
 * 纯数据模块，零依赖。
 */
import type { MessageKey } from './keys.js';

export const zh: Record<MessageKey, string> = {
  'error.category.network': '网络错误，请检查网络连接后重试。',
  'error.category.validation': '文件校验失败，下载内容可能已损坏，请重新下载。',
  'error.category.version': '版本不匹配，请确认版本号后重试。',
  'error.category.disk': '磁盘空间不足或写入失败，请清理磁盘后重试。',
  'error.category.permission': '权限不足，请以有足够权限的方式运行后重试。',
  'error.category.unknown': '发生未知错误，请查看日志后重试。',
  'error.file.not_found': '文件不存在',
  'error.file.permission': '没有访问权限',
  'error.file.conflict': '文件冲突',
  'error.file.disk_full': '磁盘空间不足',
  'error.file.invalid_path': '非法路径',
  'error.file.unknown': '未知文件错误',
  'op.generate': '生成内容',
  'op.build': '构建项目',
  'op.validate': '校验内容',
  'op.deploy': '部署插件',
  'op.restart': '重启服务',
  'op.rollback': '回滚构建',
  'op.install': '安装内容',
  'op.launch': '启动实例',
  'confirm.build': '确认构建项目吗？',
  'confirm.deploy': '确认部署插件吗？',
  'confirm.restart': '确认重启服务吗？',
  'confirm.launch': '确认启动实例吗？',
  'task.queued': '任务已排队',
  'task.running': '任务运行中',
  'task.succeeded': '任务已成功',
  'task.failed': '任务失败',
  'task.cancelled': '任务已取消',
};
