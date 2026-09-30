export interface ShortcutEntry {
  keys: string;
  description: string;
  category: string;
}

/**
 * 全项目快捷键清单（单一来源）。
 *
 * MiddlePanel 的 keydown 监听、命令面板的 shortcut 字段、
 * 本帮助面板都应参考此清单，避免文档与实现脱节。
 */
export const SHORTCUTS: ShortcutEntry[] = [
  // 全局
  { keys: 'F1', description: '打开命令面板', category: '全局' },
  { keys: 'Ctrl+P', description: '打开命令面板（Quick Open 等价）', category: '全局' },
  { keys: 'Ctrl+Shift+P', description: '打开命令面板', category: '全局' },
  { keys: 'Ctrl+S', description: '保存当前文件', category: '全局' },
  { keys: 'Esc', description: '关闭对话框 / 命令面板', category: '全局' },

  // 命令面板
  { keys: '↑ / ↓', description: '在命令列表中上下移动', category: '命令面板' },
  { keys: 'Enter', description: '执行选中命令', category: '命令面板' },
  { keys: 'Tab', description: '切换命令分类', category: '命令面板' },
  { keys: 'Shift+Tab', description: '反向切换命令分类', category: '命令面板' },

  // 中间面板 Tab 切换
  { keys: '← / →', description: '在预览/资源/NBT/代码视图间切换', category: '中间面板' },

  // 空状态
  { keys: '点击「打开命令面板」', description: '空状态时快速触发命令面板', category: '空状态' },
];
