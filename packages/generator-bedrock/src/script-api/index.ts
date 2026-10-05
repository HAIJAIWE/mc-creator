/**
 * 基岩版 Script API 代码生成（设计文档 §6.3）。
 *
 * 分层：
 * - `script-spec.ts` —— 增量 spec（挂在 BehaviorPackSpec.script，缺省即不启用）
 * - `script-versions.ts` —— MC 版本 → 包格式 / Script API 模块版本查表（§8.4）
 * - `script-events.ts` —— after/before 事件白名单与字段绑定（按 API 家族分表）
 * - `script-codegen.ts` —— `scripts/main.js` 代码生成（含幂等注册 guard）
 * - `unsupported.ts` —— 未实现原因登记表（沿用 generator-mod 的模式）
 */
export * from './script-spec.js';
export * from './script-versions.js';
export * from './script-events.js';
export * from './script-codegen.js';
export * from './unsupported.js';
