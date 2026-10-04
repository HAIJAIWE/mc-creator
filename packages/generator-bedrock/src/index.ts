/**
 * @mc-creator/generator-bedrock —— behavior_pack / behavior_item / behavior_entity
 * 实现包（设计文档 §15；§18 阶段 8 自 @mc-creator/core 迁入）。
 *
 * 深路径说明：本包 exports 为 { ".": "./src/index.ts", "./*": "./src/*" }，
 * 故深路径导入不带 /src/ 前缀（如
 * @mc-creator/generator-bedrock/behavior-pack/index.js），用 .js 后缀与仓内
 * 惯例一致（TS moduleResolution Bundler 下回退到 .ts）。
 */
export * from './behavior-pack/index.js';
export * from './behavior-item/index.js';
export * from './behavior-entity/index.js';
export * from './kinds.js';
