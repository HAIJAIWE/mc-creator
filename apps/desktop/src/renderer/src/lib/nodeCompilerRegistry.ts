/**
 * 节点编译器注册表（对标 MCreator ModElementGenerator registry）
 *
 * ## 为什么需要
 *
 * MCreator 把「每种 mod 元素如何生成 Java」封装为独立的 Generator，并通过注册表
 * 按 mod 元素类型分发。本项目把节点编译为 ModSpec 的逻辑原本硬编码在
 * `compileNodeGraph` 的 13 个 per-kind 循环里，新增节点类型必须改主编译器。
 *
 * 本模块抽出统一的编译器契约：每种 NodeKind 注册一个 `NodeCompiler`，主编译器
 * 遍历节点一次、按 kind 查表分发，把产出合并到 ModSpec。这样：
 * - 新增内置节点类型 = 注册一个 compiler，不动主流程
 * - 自定义节点编译路径与内置路径统一（都是查表分发）
 * - 编译器可独立单测（register → compile → 断言 output）
 *
 * 与 P1-1 formatVersion 的关系：MCreator 每个 GeneratableElement 配一个 generator，
 * formatVersion 管数据演化、generator 管代码生成——本注册表是后者。
 *
 * ## 使用方式
 *
 * ```ts
 * registerCompiler({
 *   kind: 'item',
 *   compile: (node, ctx) => ({ items: [compileItemNode(node)] }),
 * });
 * const { output, errors } = compileAll(compilableNodes, ctx);
 * ```
 *
 * ## 设计约束
 *
 * - 编译器必须返回新对象（不可原地修改 ctx.graph）
 * - 编译器抛出的异常由 `compileAll` 捕获并转为 error（不中断其他节点）
 * - 编译器可通过 `output.errors` 上报自定义错误消息（如自定义节点的 schema 未注册）
 * - comment 等无需编译的 kind 不注册 compiler，`compileAll` 静默跳过
 */

import type {
  NodeGraph,
  NodeKind,
  ModNode,
  ItemSpec,
  BlockSpec,
  ModRecipeSpec,
  EntitySpec,
  MachineSpec,
  MultiBlockSpec,
  CustomCodeSnippetSpec,
  EventHandlerSpec,
  ConditionSpec,
  ActionSpec,
  ProcedureSpec,
  ModBiomeSpec,
  ModDimensionSpec,
  FluidSpec,
  GuiSpec,
  ModStructureSpec,
} from '@mc-creator/shared';

// === 类型 ===

/**
 * 编译器产出：描述本次编译贡献到 ModSpec 的哪些字段。
 *
 * 每个字段都是数组（一个节点可能产出多个 spec 条目，虽然当前内置节点都是 1:1）。
 * `compileAll` 会把所有编译器的产出按字段合并（concat）。
 */
export interface CompilerOutput {
  items?: ItemSpec[];
  blocks?: BlockSpec[];
  recipes?: ModRecipeSpec[];
  entities?: EntitySpec[];
  machines?: MachineSpec[];
  multiblocks?: MultiBlockSpec[];
  customCode?: CustomCodeSnippetSpec[];
  eventHandlers?: EventHandlerSpec[];
  conditions?: ConditionSpec[];
  actions?: ActionSpec[];
  /** P1-3：过程（由 procedure 节点编译） */
  procedures?: ProcedureSpec[];
  /** 世界生成：生物群系（biome 节点） */
  biomes?: ModBiomeSpec[];
  /** 世界生成：维度（dimension 节点） */
  dimensions?: ModDimensionSpec[];
  /** 流体（fluid 节点） */
  fluids?: FluidSpec[];
  /** GUI 界面（gui 节点） */
  guis?: GuiSpec[];
  /** Mod 侧结构（structure 节点） */
  structures?: ModStructureSpec[];
  /** 编译警告（合并到 CompileResult.warnings） */
  warnings?: string[];
  /** 编译错误（合并到 CompileResult.errors，spec 仍可部分使用） */
  errors?: string[];
}

/**
 * 编译上下文：主编译器提供给每个 NodeCompiler 的能力与数据。
 *
 * - `graph`：内联展开后的图，供需要查连线的编译器（recipe/event）使用
 * - `sanitizedModId`：净化后的合法命名空间，供需要拼 id 的编译器使用
 * - `nodeMap`：节点索引 Map，供 BFS 编译器 O(1) 查找目标节点（替代 O(n) 线性扫描）
 * - `compileLoopBody`：编译 loop 节点的 body 子图代码（供 loop 编译器递归调用）
 */
export interface CompileContext {
  graph: NodeGraph;
  sanitizedModId: string;
  /** P2 dogfood 优化：节点索引 Map，BFS 中 O(1) 查找节点 */
  nodeMap?: Map<string, ModNode>;
  compileLoopBody: (bodySubgraphId: string | undefined) => string;
}

/** 单个节点编译器：处理指定 kind 的节点，返回贡献到 ModSpec 的产出 */
export interface NodeCompiler {
  /** 处理的节点类型（一个 kind 只能注册一个 compiler，后注册覆盖先注册） */
  kind: NodeKind;
  /** 编译函数：抛出的异常由 compileAll 捕获转为 error */
  compile: (node: ModNode, ctx: CompileContext) => CompilerOutput;
}

// === 注册表 ===

const compilers = new Map<NodeKind, NodeCompiler>();

/**
 * 注册节点编译器。
 *
 * 同一 kind 重复注册时覆盖旧值（便于测试用 clearCompilers + 重新注册重置状态）。
 *
 * @param compiler 编译器定义
 */
export function registerCompiler(compiler: NodeCompiler): void {
  compilers.set(compiler.kind, compiler);
}

/** 按 kind 查找编译器（未注册返回 undefined，调用方决定跳过或告警） */
export function getCompiler(kind: NodeKind): NodeCompiler | undefined {
  return compilers.get(kind);
}

/** 清空所有注册的编译器（主要供测试使用） */
export function clearCompilers(): void {
  compilers.clear();
}

/** 返回已注册的所有 kind（主要供测试与调试） */
export function registeredKinds(): NodeKind[] {
  return [...compilers.keys()];
}

// === 合并 ===

/**
 * 把 `src` 的产出合并进 `dst`（原地修改 dst）。
 *
 * 数组字段用 concat 追加；warnings/errors 也追加。null/undefined 字段跳过。
 */
export function mergeOutput(dst: CompilerOutput, src: CompilerOutput): void {
  if (src.items) (dst.items ??= []).push(...src.items);
  if (src.blocks) (dst.blocks ??= []).push(...src.blocks);
  if (src.recipes) (dst.recipes ??= []).push(...src.recipes);
  if (src.entities) (dst.entities ??= []).push(...src.entities);
  if (src.machines) (dst.machines ??= []).push(...src.machines);
  if (src.multiblocks) (dst.multiblocks ??= []).push(...src.multiblocks);
  if (src.customCode) (dst.customCode ??= []).push(...src.customCode);
  if (src.eventHandlers) (dst.eventHandlers ??= []).push(...src.eventHandlers);
  if (src.conditions) (dst.conditions ??= []).push(...src.conditions);
  if (src.actions) (dst.actions ??= []).push(...src.actions);
  if (src.procedures) (dst.procedures ??= []).push(...src.procedures);
  if (src.biomes) (dst.biomes ??= []).push(...src.biomes);
  if (src.dimensions) (dst.dimensions ??= []).push(...src.dimensions);
  if (src.fluids) (dst.fluids ??= []).push(...src.fluids);
  if (src.guis) (dst.guis ??= []).push(...src.guis);
  if (src.warnings) (dst.warnings ??= []).push(...src.warnings);
  if (src.errors) (dst.errors ??= []).push(...src.errors);
}

// === 分发 ===

/**
 * 遍历所有节点，按 kind 查表分发到注册的编译器，合并产出。
 *
 * 算法：
 * 1. 对每个节点查 `getCompiler(node.data.kind)`
 * 2. 未注册 → 静默跳过（comment 等文档型节点）
 * 3. 注册 → 调用 compile，异常捕获转为 `${kind}节点 ${id} 编译失败：${msg}`
 * 4. 编译器返回的 output.errors 直接合并（保留编译器自定义的错误消息）
 *
 * 节点遍历顺序 = 入参 nodes 顺序（即图顺序），每个 ModSpec 字段内的条目保持图顺序。
 *
 * @param nodes 待编译节点（应已过滤禁用/锁定节点）
 * @param ctx 编译上下文
 * @returns 合并后的产出 + 中央收集的 errors（不含编译器自定义 errors，那些在 output.errors 里）
 */
export function compileAll(
  nodes: ModNode[],
  ctx: CompileContext,
): { output: CompilerOutput; errors: string[] } {
  const output: CompilerOutput = {};
  const errors: string[] = [];

  for (const node of nodes) {
    const compiler = getCompiler(node.data.kind);
    if (!compiler) continue; // comment / 未知 kind：静默跳过
    try {
      const result = compiler.compile(node, ctx);
      mergeOutput(output, result);
    } catch (e) {
      errors.push(`${node.data.kind}节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  return { output, errors };
}
