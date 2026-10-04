/**
 * @mc-creator/generator-datapack —— 数据驱动生成器包（设计文档 §15）。
 *
 * datapack 实现已自 @mc-creator/core 迁入本包（§18 阶段 8）；
 * kubejs/crafttweaker/enchantment 实现亦已迁入本包 src/{kubejs,crafttweaker,enchantment}/，
 * core 原位仅留转接 shim（§2.1）。
 *
 * 深路径说明：本包及 core 的 exports 均为 { ".": "./src/index.ts", "./*": "./src/*" }，
 * 故深路径导入不带 /src/ 前缀（如 @mc-creator/generator-datapack/writers/recipes.js），
 * 用 .js 后缀与仓内惯例一致（TS moduleResolution Bundler 下回退到 .ts）。
 */
export * from './datapack-generator.js';
export * from './recipe-adapter.js';
export * from './kubejs/index.js';
export * from './crafttweaker/index.js';
export * from './enchantment/index.js';
export * from './kinds.js';
