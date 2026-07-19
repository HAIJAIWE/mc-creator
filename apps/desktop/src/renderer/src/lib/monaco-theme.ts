import type Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type { ComponentProps } from 'react';
import { registerMonacoRefresh } from './themes.js';

type StandaloneEditorConstructionOptions = NonNullable<ComponentProps<typeof Editor>['options']>;

export const MC_MONACO_THEME = 'mc-craft-dark';

/** 从实时 CSS 变量读 "R G B" -> "#RRGGBB"（读不到则用兜底值） */
function readRgb(name: string, fallback: string): string {
  const raw = (
    getComputedStyle(document.documentElement).getPropertyValue(name) || fallback
  ).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return '#' + parts.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  }
  return '#' + fallback.replace(/\s+/g, '');
}

let monacoRef: Parameters<OnMount>[1] | null = null;

/** 按当前 CSS 变量构建 Monaco 主题，使编辑器跟随整站换肤 */
function buildTheme(monaco: Parameters<OnMount>[1]) {
  const bg = readRgb('--mc-bg', '20 19 15');
  const fg = readRgb('--mc-text', '236 232 218');
  const dim = readRgb('--mc-text-mute', '138 132 105');
  const surface2 = readRgb('--mc-surface-2', '36 33 24');
  const border = readRgb('--mc-border-strong', '74 68 53');
  const accent = readRgb('--mc-accent', '106 176 76');
  const accentBright = readRgb('--mc-accent-bright', '139 195 74');
  const gold = readRgb('--mc-gold', '217 164 65');

  // Monaco 语法色用不带 # 的 6 位 hex；编辑器 UI 色用带 # 的 8/6 位
  const hex = (c: string) => c.replace('#', '').toUpperCase();

  monaco.editor.defineTheme(MC_MONACO_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: hex(fg) },
      { token: 'comment', foreground: hex(dim), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(accentBright) },
      { token: 'keyword.control', foreground: hex(accentBright) },
      { token: 'string', foreground: hex(gold) },
      { token: 'number', foreground: hex(accent) },
      { token: 'type', foreground: hex(fg) },
      { token: 'type.identifier', foreground: hex(fg) },
      { token: 'function', foreground: hex(fg) },
      { token: 'variable', foreground: hex(fg) },
      { token: 'variable.predefined', foreground: hex(accentBright) },
      { token: 'delimiter', foreground: hex(dim) },
      { token: 'tag', foreground: hex(accentBright) },
      { token: 'attribute.name', foreground: hex(gold) },
      { token: 'attribute.value', foreground: hex(gold) },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': dim,
      'editorLineNumber.activeForeground': accentBright,
      'editor.selectionBackground': accent + '33',
      'editor.lineHighlightBackground': surface2,
      'editorCursor.foreground': accentBright,
      'editorIndentGuide.background': surface2,
      'editorIndentGuide.activeBackground': border,
      'editorWidget.background': surface2,
      'editorWidget.border': border,
      'editorGutter.background': bg,
      'scrollbarSlider.background': border + '99',
      'scrollbarSlider.hoverBackground': accent + '99',
      // 补全 / 查找替换 UI
      'editorSuggestWidget.background': surface2,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': accent + '33',
      findMatchHighlightBackground: gold + '44',
      findMatchHighlightBorder: gold + '88',
      currentFindMatchHighlightBackground: accent + '55',
      currentFindMatchHighlightBorder: accent,
      findRangeHighlightBackground: surface2,
    },
  });
  monaco.editor.setTheme(MC_MONACO_THEME);
}

/** 编辑器挂载时注册：构建主题 + 把刷新回调交给主题系统 */
export const defineMcMonacoTheme: OnMount = (_editor, monaco) => {
  monacoRef = monaco;
  buildTheme(monaco);
  registerMonacoRefresh(() => {
    if (monacoRef) buildTheme(monacoRef);
  });
};

/** 供 Editor 的 theme 属性直接引用（defineTheme 需在 onMount 注册） */
export const mcEditorOptions: StandaloneEditorConstructionOptions = {
  fontSize: 13,
  minimap: { enabled: true, maxColumn: 80, showSlider: 'mouseover' },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  fontFamily: "'Monocraft', 'VT323', 'Courier New', Consolas, monospace",
  fontLigatures: true,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  padding: { top: 10 },
  // 查找/替换（Ctrl+F / Ctrl+H）
  find: {
    addExtraSpaceOnTop: true,
    autoFindInSelection: 'multiline',
    seedSearchStringFromSelection: 'selection',
  },
  // 代码编辑增强
  bracketPairColorization: { enabled: true },
  autoClosingBrackets: 'always',
  autoClosingQuotes: 'always',
  autoIndent: 'full',
  formatOnPaste: true,
  formatOnType: true,
  folding: true,
  foldingStrategy: 'indentation',
  showFoldingControls: 'mouseover',
  wordWrap: 'off',
  wordWrapColumn: 120,
  wrappingIndent: 'same',
  // 建议和补全
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'on',
  tabCompletion: 'on',
  quickSuggestions: { other: true, comments: false, strings: true },
  parameterHints: { enabled: true },
  // 缩进
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: true,
  // 无障碍和稳定性
  accessibilitySupport: 'auto',
};
