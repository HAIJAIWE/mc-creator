import { useTranslation } from '../hooks/useTranslation';
import { McIcon } from '../assets/mc-ui/McIcon';

interface LanguageSwitcherProps {
  /** 显示模式 */
  variant?: 'dropdown' | 'buttons' | 'compact';
  /** 是否显示语言名称 */
  showLabel?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 语言切换器组件
 *
 * 用法：
 *   <LanguageSwitcher variant="dropdown" />
 *   <LanguageSwitcher variant="compact" showLabel={false} />
 *   <LanguageSwitcher variant="buttons" />
 */
export function LanguageSwitcher({
  variant = 'dropdown',
  showLabel = true,
  className = '',
}: LanguageSwitcherProps) {
  const { locale, setLocale, getAvailableLocales, getLocaleDisplayName } = useTranslation();
  const locales = getAvailableLocales();

  if (variant === 'buttons') {
    return (
      <div className={`flex items-center gap-1 ${className}`} role="group" aria-label="语言选择">
        {locales.map((loc) => (
          <button
            key={loc}
            onClick={() => setLocale(loc)}
            aria-pressed={locale === loc}
            className={`flex items-center gap-1 rounded-mc px-2 py-1 text-xs font-medium transition-all ${
              locale === loc
                ? 'bg-mc-accent/20 border border-mc-accent/50 text-mc-accent-bright'
                : 'bg-mc-surface-2/50 border border-transparent text-mc-text-dim hover:bg-mc-surface-2 hover:text-mc-text'
            }`}
            title={getLocaleDisplayName(loc)}
          >
            {showLabel && getLocaleDisplayName(loc)}
          </button>
        ))}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={() => {
          const nextIndex = (locales.indexOf(locale) + 1) % locales.length;
          setLocale(locales[nextIndex]);
        }}
        className={`mc-btn-ghost !px-2 !py-1 ${className}`}
        aria-label={`当前语言：${getLocaleDisplayName(locale)}，点击切换`}
        title={`当前语言：${getLocaleDisplayName(locale)}，点击切换`}
      >
        <span className="text-xs font-medium">{locale === 'zh' ? '中' : 'EN'}</span>
      </button>
    );
  }

  // dropdown variant (default)
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => {
          const nextIndex = (locales.indexOf(locale) + 1) % locales.length;
          setLocale(locales[nextIndex]);
        }}
        className="flex items-center gap-1.5 mc-btn-ghost !px-2 !py-1"
        aria-label={`当前语言：${getLocaleDisplayName(locale)}，点击切换`}
        aria-haspopup="listbox"
        aria-expanded="false"
      >
        <span className="text-xs font-medium">{locale === 'zh' ? '中文' : 'English'}</span>
        <McIcon scope="pixel" name="chevron-down" size={12} className="text-mc-text-dim" />
      </button>

      <div
        role="listbox"
        aria-label="选择语言"
        className="mc-pop absolute right-0 top-full mt-1 z-50 w-32 overflow-hidden animate-mc-panel-in"
      >
        <div className="bg-mc-surface border border-mc-border rounded-mc overflow-hidden">
          {locales.map((loc) => (
            <button
              key={loc}
              role="option"
              aria-selected={locale === loc}
              onClick={() => setLocale(loc)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                locale === loc
                  ? 'bg-mc-accent/15 text-mc-accent-bright'
                  : 'text-mc-text-dim hover:bg-mc-surface-2 hover:text-mc-text'
              }`}
            >
              {getLocaleDisplayName(loc)}
              {locale === loc && (
                <McIcon scope="pixel" name="check" size={12} className="text-mc-accent ml-auto" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
