/**
 * 主题 store + `useTheme` hook（设计文档 §4.5 设计系统；§12 设置项）。
 *
 * 对应 index.css 的这句注释：
 * > SettingsPanel 的主题切换会改写 --mc-accent* 等变量实时换肤。
 *
 * 实现刻意做成「模块级 store + 订阅」，而不是 React context：
 * 主题是**进程级全局状态**（等价于 i18n 的 `currentLocale`），多个互不
 * 相关的子树都要能读到它，且要在 Provider 之外也能 `setTheme`。
 * 因此照搬 `apps/desktop/src/renderer/src/i18n` 的
 * `getLocale` / `subscribeLocaleChange` 那套写法，并用
 * `useSyncExternalStore` 接入 React 18 并发模式（对齐 desktop 的
 * `useTranslation.ts`，含 SSR-safe 的 `getServerSnapshot`）。
 *
 * 换肤是「写 CSS 变量」而非「换 class」：`applyTheme` 把
 * `--mc-accent*` 写到 `document.documentElement.style`，CSS 里所有
 * `rgb(var(--mc-accent) / …)` 与 `.mc-btn-primary` 一次性跟着变，
 * 零组件重渲染、零 class 切换成本。
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_THEME, THEMES, THEME_NAMES, type ThemeName } from '../theme/index';

export type { ThemeName };
export { THEMES, THEME_NAMES, DEFAULT_THEME };

/* ------------------------------------------------------------------ *
 * 模块级 store
 * ------------------------------------------------------------------ */

/** 当前主题。SSR 下恒为 DEFAULT_THEME（无 DOM 也就没有换肤可言）。 */
let currentTheme: ThemeName = DEFAULT_THEME;

/** 主题变更监听器。与 i18n 的 listeners 同构。 */
const listeners: Set<() => void> = new Set();

/** 取当前主题名。 */
export function getTheme(): ThemeName {
  return currentTheme;
}

/**
 * 取当前主题快照（专供 `useSyncExternalStore`）。
 *
 * 必须返回**原始值**而不是新建对象：`useSyncExternalStore` 每次都
 * 用 `Object.is` 比对快照，返回新对象会导致无限重渲染。
 */
export function getThemeSnapshot(): ThemeName {
  return currentTheme;
}

/**
 * 服务端快照（SSR 兼容）。
 *
 * 服务端没有 document、没有用户偏好，恒定返回默认主题，
 * 保证首屏 HTML 与客户端 hydrate 后的第一帧一致（否则 React 会
 * 报 hydration mismatch）。对齐 `useTranslation.getServerLocaleSnapshot`。
 */
export function getServerThemeSnapshot(): ThemeName {
  return DEFAULT_THEME;
}

/** 订阅主题变更，返回取消订阅函数。 */
export function subscribeThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 所有可用主题名。 */
export function getAvailableThemes(): ThemeName[] {
  return [...THEME_NAMES];
}

/**
 * 把主题的 CSS 变量写进 `documentElement.style`。
 *
 * @param doc 目标 document。默认取 `globalThis.document`；
 *   显式注入是为了可测（SSR / 多窗口场景也需要）。
 */
export function applyTheme(name: ThemeName, doc?: Document): void {
  const target = doc ?? (typeof document !== 'undefined' ? document : undefined);
  // 无 DOM 环境（SSR / 纯 node 测试）下静默跳过：换肤是纯副作用，
  // 不该让 SSR 渲染失败。
  if (!target) return;
  const vars = THEMES[name];
  if (!vars) return;
  for (const [prop, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    target.documentElement.style.setProperty(prop, value);
  }
}

/**
 * 切换主题：写 CSS 变量 + 通知订阅者。
 *
 * 幂等：重复设置同一主题仍会重写变量（用于「首次挂载时把 store 状态
 * 同步到 DOM」），但**不**触发订阅通知 —— 与 `setLocale` 的
 * `if (locale !== currentLocale)` 判断一致，避免无谓的重渲染。
 */
export function setTheme(name: ThemeName, doc?: Document): void {
  applyTheme(name, doc);
  if (name === currentTheme) return;
  currentTheme = name;
  listeners.forEach((listener) => listener());
}

/**
 * 读主题并在变更时重渲染。
 *
 * 用法：
 *   const { theme, setTheme } = useTheme();
 *   setTheme('nether-ember');
 *
 * 挂载时会补一次 `applyTheme(theme)`：让「store 里的主题」与
 * 「DOM 上的 CSS 变量」不会因为绕过 hook 调 `setTheme` 而脱节。
 */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribeThemeChange,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const changeTheme = useCallback((next: ThemeName) => {
    setTheme(next);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return {
    /** 当前主题名 */
    theme,
    /** 切换主题（同时写入 CSS 变量） */
    setTheme: changeTheme,
    /** 主题定义表：主题名 → 该主题覆盖的 CSS 变量 */
    themes: THEMES,
    /** 全部可用主题名（按展示顺序） */
    themeNames: THEME_NAMES,
  };
}
