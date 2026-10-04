/**
 * 测试环境引导：注册 @testing-library/jest-dom 的 vitest 匹配器。
 *
 * 放在 src/ 内（而非 vitest.config.ts 内联）的原因：tsconfig 的
 * `include: ["src"]` 覆盖本文件，jest-dom 的类型增强因而注入整个
 * TS program，`toBeInTheDocument()` / `toHaveAttribute()` 等在任意
 * 测试文件里都有类型，无需逐文件 import。
 *
 * 同时清理可能残留的 document 根样式：主题切换测试会把 CSS 变量写到
 * document.documentElement.style 上，afterEach 里还原避免跨用例串味。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // 还原 setTheme 写入的 inline CSS 变量，保证用例之间互不污染
  const style = document.documentElement.style;
  for (let i = style.length - 1; i >= 0; i -= 1) {
    const prop = style.item(i);
    if (prop.startsWith('--mc-')) style.removeProperty(prop);
  }
});
