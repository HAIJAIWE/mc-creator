/**
 * @mc-creator/ui —— MC 全链路 AI 工作台共享 UI 组件库（设计文档 §4.5 设计系统；
 * §5.4 桌面端组件替换；§10.6 执行须弹窗；P32 通知系统）。
 *
 * ## 定位
 *
 * 把原先散落在 `apps/desktop/src/renderer/src/components/` 的能力
 * （ConfirmDialog / ToastProvider / TabBar / WarningBanner…）沉淀为
 * 跨端可复用的 React 组件。**注意：desktop 侧目前尚未实际替换**
 * （§5.4 是独立任务），本包先行落地、desktop 渐进迁移。
 *
 * ## 设计约束：零运行时第三方依赖
 *
 * 只依赖 `react` / `react-dom`（peerDependency），不引 MUI / antd / radix。
 * 所有样式来自 `apps/desktop/src/renderer/src/index.css` 里 Tailwind
 * `@layer components` 生成的语义 class（`.mc-btn-primary` / `.mc-card` /
 * `.mc-pop` / `.mc-tab-selected` …），**由调用方负责引入那份 CSS**。
 * 因此本包：
 * - 不携带任何 `.css` 文件，也不含 Tailwind 指令；
 * - 组件只输出语义 className + `className` 覆盖位，不内联硬编码颜色；
 * - 少数必须内联的取值（如 Progress 的 tone、Toast 的边框色）一律走
 *   `theme` 的 `rgbVar()`，引用 CSS 变量而非 RGB 三元组 —— 否则换肤就失效了。
 *
 * ## 与调用方 Tailwind 编译的耦合（升级 v4 时必读）
 *
 * 组件除语义 class 外，**也输出原生 Tailwind utility class**（如
 * `flex items-center gap-2 px-3 py-1.5`、`hover:bg-mc-surface-3`、
 * `min-w-[240px]`）。Tailwind 按 content 扫描结果生成 CSS，而且
 * **`@layer components` 里的自定义类同样「未用即删」** —— 不在扫描范围内
 * 就不会出现在产物里。
 *
 * 因此调用方的扫描范围必须覆盖本包源码，否则这些类**既不报错也没有任何
 * 样式**（静默失效，最难排查）：
 * - Tailwind v3：把 `packages/ui/src/**\/*.{ts,tsx}` 加进 `tailwind.config.js`
 *   的 `content`；
 * - Tailwind v4：自动扫描以**构建 CWD** 为基准（pnpm monorepo 下即
 *   `apps/desktop`），不会自动覆盖本包，必须在 `index.css` 里显式写
 *   `@source "../../../../../packages/ui/src";`（相对该文件求值）。
 *
 * ## 可访问性基线
 *
 * 桌面端已引入 `axe-core`，本包按同一标准实现：语义 role、完整的
 * `aria-*` 连线（label/describedby/controls/labelledby 不断链）、
 * 键盘可达（roving tabindex、方向键导航、Modal 焦点陷阱与归还）。
 *
 * 用法：
 * ```tsx
 * import { Button, Modal, useToast, useTheme, rgbVar } from '@mc-creator/ui';
 * ```
 */

/* ---- 设计 token 与主题 ---- */
export {
  // token 镜像（值与 index.css :root 逐字一致）
  MC_COLORS,
  MC_EASE,
  MC_FONTS,
  MC_RADIUS,
  MC_SHADOWS,
  TONE_COLOR_VAR,
  colorVar,
  hex,
  rgbVar,
  // 主题预设
  DEFAULT_THEME,
  THEMES,
  THEME_NAMES,
  // 类型
  type McColorToken,
  type ThemeName,
  type ToneColor,
} from './theme/index';

/* ---- hooks ---- */
export {
  applyTheme,
  getAvailableThemes,
  getServerThemeSnapshot,
  getTheme,
  getThemeSnapshot,
  setTheme,
  subscribeThemeChange,
  useTheme,
} from './hooks/index';

/* ---- 组件 ---- */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './components/Button';
export { Card, type CardPadding, type CardProps, type CardTitleAs } from './components/Card';
export { Dropdown, type DropdownItem, type DropdownProps } from './components/Dropdown';
export { Input, type InputProps, type InputSize } from './components/Input';
export { Modal, getFocusableElements, type ModalProps, type ModalSize } from './components/Modal';
export {
  Progress,
  clampProgress,
  type ProgressProps,
  type ProgressTone,
} from './components/Progress';
export { Tabs, type TabItem, type TabsPanelState, type TabsProps } from './components/Tabs';
export {
  Toast,
  TOAST_DEFAULT_DURATION,
  ToastContext,
  ToastProvider,
  useToast,
  type ToastAction,
  type ToastContextValue,
  type ToastInput,
  type ToastItem,
  type ToastProps,
  type ToastQuickOptions,
  type ToastVariant,
} from './components/Toast';
export {
  Tooltip,
  tooltipPlacementClass,
  type TooltipPlacement,
  type TooltipProps,
} from './components/Tooltip';

/* ---- 工具 ---- */
export { cx, type ClassValue } from './utils';
