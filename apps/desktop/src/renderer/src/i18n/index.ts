import zh from './zh.json' with { type: 'json' };
import enUS from './en-US.json' with { type: 'json' };

/** 支持的语言 */
export type Locale = 'zh' | 'en-US';

/** 语言包 */
const messages: Record<Locale, typeof zh> = {
  zh,
  'en-US': enUS,
};

/** 当前语言 */
let currentLocale: Locale = 'zh';

/** 语言变更监听器 */
const listeners: Set<() => void> = new Set();

/**
 * 设置当前语言
 */
export function setLocale(locale: Locale): void {
  if (locale !== currentLocale) {
    currentLocale = locale;
    // 通知所有监听器
    listeners.forEach((listener) => listener());
  }
}

/**
 * 获取当前语言
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * 订阅语言变更
 */
export function subscribeLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 简单的插值函数：将 {key} 替换为对应值
 */
function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

/**
 * 翻译函数：t('compileErrors.GRAPH_MISSING_MODID') → 中文/英文消息
 *
 * @param key 点号分隔的键路径，如 'compileErrors.GRAPH_MISSING_MODID'
 * @param params 插值参数，如 { modId: 'test', nodeId: 'item_1' }
 * @returns 翻译后的字符串，若键不存在则返回 key 本身
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.');
  let obj: unknown = messages[currentLocale];

  for (const part of parts) {
    if (obj && typeof obj === 'object' && part in obj) {
      obj = (obj as Record<string, unknown>)[part];
    } else {
      console.warn(`[i18n] Translation key not found: ${key}`);
      return key;
    }
  }

  if (typeof obj === 'string') {
    return interpolate(obj, params);
  }

  console.warn(`[i18n] Translation key resolves to non-string: ${key}`);
  return key;
}

/** 专用：编译错误码翻译 */
export function tCompileError(code: string, params?: Record<string, string | number>): string {
  return t(`compileErrors.${code}`, params);
}

/** 专用：构建错误翻译 */
export function tBuildError(code: string, params?: Record<string, string | number>): string {
  return t(`buildErrors.${code}`, params);
}

/** 专用：通用词汇翻译 */
export function tCommon(key: string, params?: Record<string, string | number>): string {
  return t(`common.${key}`, params);
}

/**
 * 获取所有可用语言
 */
export function getAvailableLocales(): Locale[] {
  return Object.keys(messages) as Locale[];
}

/**
 * 获取语言显示名称
 */
export function getLocaleDisplayName(locale: Locale): string {
  switch (locale) {
    case 'zh':
      return '中文';
    case 'en-US':
      return 'English';
    default:
      return locale;
  }
}
