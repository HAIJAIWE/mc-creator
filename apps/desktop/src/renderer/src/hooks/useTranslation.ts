import { useSyncExternalStore, useCallback } from 'react';
import {
  getLocale,
  subscribeLocaleChange,
  setLocale,
  t,
  tCompileError,
  tBuildError,
  tCommon,
  type Locale,
  getAvailableLocales,
  getLocaleDisplayName,
} from '../i18n';

/**
 * 获取当前语言的快照（用于 useSyncExternalStore）
 */
function getLocaleSnapshot(): Locale {
  return getLocale();
}

/**
 * 获取服务端快照（SSR 兼容）
 */
function getServerLocaleSnapshot(): Locale {
  return 'zh';
}

/**
 * 翻译 Hook
 *
 * 用法：
 *   const { t, locale, setLocale } = useTranslation();
 *   return <div>{t('common.error')}</div>;
 */
export function useTranslation() {
  // 使用 useSyncExternalStore 订阅语言变更，确保 React 18 并发模式下正确响应
  const locale = useSyncExternalStore(
    subscribeLocaleChange,
    getLocaleSnapshot,
    getServerLocaleSnapshot,
  );

  const changeLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
  }, []);

  return {
    /** 当前语言 */
    locale,
    /** 切换语言 */
    setLocale: changeLocale,
    /** 通用翻译函数 */
    t,
    /** 编译错误翻译 */
    tCompileError,
    /** 构建错误翻译 */
    tBuildError,
    /** 通用词汇翻译 */
    tCommon,
    /** 获取可用语言列表 */
    getAvailableLocales,
    /** 获取语言显示名称 */
    getLocaleDisplayName,
  };
}

/**
 * 简化版翻译 Hook（仅 t 函数）
 */
export function useT() {
  const _locale = useSyncExternalStore(
    subscribeLocaleChange,
    getLocaleSnapshot,
    getServerLocaleSnapshot,
  );

  // _locale 变化会触发重渲染，闭包 t 函数会自动读取最新语言
  return t;
}
