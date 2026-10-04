/**
 * @mc-creator/generator-mod —— Mod 生成器实现包（设计文档 §15；§18 阶段 9 自 @mc-creator/core 迁入）。
 *
 * 深路径说明：本包 exports 为 { ".": "./src/index.ts", "./*": "./src/*" }，
 * 故深路径导入不带 /src/ 前缀（如 @mc-creator/generator-mod/mod-generator.js），
 * 用 .js 后缀与仓内惯例一致（TS moduleResolution Bundler 下回退到 .ts）。
 */
export * from './templates.js';
export * from './adapter.js';
export * from './unsupported.js';
export * from './fabric-adapter.js';
export * from './neoforge-adapter.js';
export * from './forge-adapter.js';
export * from './mod-generator.js';
export * from './fabric-assets.js';
export * from './recipe-json-generator.js';
export * from './kinds.js';
