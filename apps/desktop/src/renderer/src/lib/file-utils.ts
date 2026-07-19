/**
 * 文件类型工具函数：统一管理文件图标和语言类型的判断逻辑。
 * 所有组件统一从此处 import，避免重复定义。
 */

/** 根据文件路径返回 MC 图标名（用于 McIcon scope="pixel"） */
export function getFileIconName(path: string): string {
  if (path.endsWith('.json')) return 'file-text';
  if (path.endsWith('.java')) return 'terminal';
  if (path.endsWith('.gradle') || path.endsWith('.toml') || path.endsWith('.properties'))
    return 'terminal';
  if (path.endsWith('.png')) return 'image';
  if (path.endsWith('.mcfunction')) return 'terminal';
  return 'file';
}

/** 根据文件路径返回 Monaco 编辑器语言 ID */
export function getLang(path: string): string {
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.gradle')) return 'groovy';
  if (path.endsWith('.toml')) return 'ini';
  if (path.endsWith('.properties')) return 'ini';
  if (path.endsWith('.mcfunction')) return 'plaintext';
  if (path.endsWith('.png')) return 'plaintext';
  return 'plaintext';
}
