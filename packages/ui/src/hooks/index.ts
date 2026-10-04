/**
 * packages/ui · hooks 出口。
 *
 * 目前只有主题一类全局 hook；后续新增（useTheme / useFocusTrap 等）
 * 统一从这里转出，调用方只 import 一个入口。
 */
export {
  // 类型
  type ThemeName,
  // store（可在 React 之外直接调用）
  DEFAULT_THEME,
  THEMES,
  THEME_NAMES,
  applyTheme,
  getAvailableThemes,
  getServerThemeSnapshot,
  getTheme,
  getThemeSnapshot,
  setTheme,
  subscribeThemeChange,
  // hook
  useTheme,
} from './useTheme';
