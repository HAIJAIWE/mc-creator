/**
 * @mc-creator/agent —— 智能体层（设计文档 §10 / §11）。
 *
 * ## 分层（单向依赖，反向 import 即为违规）
 *
 * ```
 * transport ──► agents ──► core
 *                   ├──► context ──► core
 *                   └──► kernel   （内核访问统一走 adapters，不直连）
 * ```
 *
 * - `core/`    纯函数层：状态机与工具定义，无副作用，不依赖上层
 * - `context/` 上下文打包
 * - `agents/`  编排：决定「何时做什么」
 * - `kernel/`  基础设施：内核访问的唯一入口（`adapters.ts`）
 * - `transport/` 协议层：MCP stdio / http
 *
 * 详见 docs/architecture-assessment.md §3.1。
 *
 * ## 对外导出
 *
 * 保持扁平导出（`@mc-creator/agent` 的调用方只有 `apps/desktop`，不需要感知分层），
 * 但顺序按依赖从低到高排列，便于阅读。
 */

// core（叶子）
export * from './core/tools.js';
export * from './core/pipeline.js';
// context
export * from './context/context-pack.js';
export * from './context/context-source.js';
// agents
export * from './agents/infer.js';
export * from './agents/generate.js';
export * from './agents/openai-chat.js';
export * from './agents/zen-free.js';
export * from './agents/closed-loop.js';
// kernel（基础设施收口）
export * from './kernel/adapters.js';
// transport
export * from './transport/mcp-server.js';
export * from './transport/host.js';
