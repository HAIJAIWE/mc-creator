/**
 * 浏览器安全的 core 入口。
 *
 * 只导出浏览器可运行的模块（生成器 + spec 配置），不包含依赖 node: 内置
 * 模块的 builder / 构建链路（build-fixer、gradle 等）。渲染进程的 web-preview
 * 模式应通过 `@mc-creator/core/browser.js` 导入，而不是顶层 barrel `.`。
 */
export * from './generators/index.js';
export * from './orchestrator/index.js';
