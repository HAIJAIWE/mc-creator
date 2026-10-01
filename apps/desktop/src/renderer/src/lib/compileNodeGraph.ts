import type { NodeGraph, ModSpec, CustomCodeSnippetSpec } from '@mc-creator/shared';
import { inlineSubgraphNodes } from './compileSubgraph.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import { compileAll, type CompileContext } from './nodeCompilerRegistry.js';
import { compileLoopBody, compileLoopSubgraphSpecsAll } from './loopCompiler.js';
import './compilerRegistry.js'; // 触发内置编译器注册副作用
import { createCompileError, CompileError, CompileErrorCode } from './compileErrors.js';
import {
  isExternalModsCacheLoaded,
  collectExternalNamespaces,
  preloadExternalMods,
  isExternalModInstalled,
} from './nodegraph/externalMods.js';
import { sanitizeModId, deduplicateCustomCode } from './nodegraph/modUtils.js';

// === barrel：保持本模块对外可见符号集合不变 ===
// 各节点类型编译器 / JSON 解析辅助 / 连线索引 / modId 工具均下沉到 nodegraph/ 子模块，
// 此处重新导出，使所有现存 import（如 `import { compileItemNode } from './compileNodeGraph.js'`）继续有效。
export * from './nodegraph/nodeCompilers.js';
export * from './nodegraph/jsonParsing.js';
export * from './nodegraph/edgeIndex.js';
export * from './nodegraph/modUtils.js';
export {
  collectExternalNamespaces,
  preloadExternalMods,
  isExternalModInstalled,
} from './nodegraph/externalMods.js';

/**
 * 节点图编译器
 *
 * 将 NodeGraph 编译为 ModSpec（已有 schema），
 * 由 mod-generator 进一步生成 Java 文件。
 *
 * 编译策略：
 * 1. 遍历所有未禁用的节点，按类型分发到对应的编译函数
 * 2. 处理连线关系（如配方 → 物品引用）
 * 3. 代码节点（CodeNode）的代码嵌入到 ModSpec 的 customCode 字段
 *    （由 mod-generator 在生成 Java 时插入到对应位置）
 *
 * P1.3 已支持：items/blocks/recipes/entities/machines 完整编译。
 * P1.4 已支持：code/multiblock/event/condition/action 节点编译到 ModSpec 顶层。
 *   - event/condition/action 采用扁平结构编译到顶层 conditions/actions 数组。
 *   - comment 节点仅文档用途，编译时跳过。
 * P1.5 已支持：通过 control 边建立 event → condition → action 控制流链引用。
 *   - EventHandlerSpec.conditionIds/actionIds 通过 BFS 收集可达节点 id（去重）。
 *   - 顶层 conditions/actions 数组保持扁平列表不变（向后兼容 P1.4）。
 */

export interface CompileLocation {
  nodeId: string;
  /** 代码节点的行号（0-based） */
  line?: number | undefined;
  /** 代码节点的列号（0-based） */
  column?: number | undefined;
  /** 错误/警告所在的代码片段（用于高亮显示） */
  snippet?: string | undefined;
}

export interface CompileMessage {
  message: string;
  location?: CompileLocation | undefined;
}

export interface CompileResult {
  /** 编译出的 ModSpec */
  spec: ModSpec;
  /** 警告信息（非致命错误） - 兼容旧格式 */
  warnings: string[];
  /** 错误信息（致命错误，spec 仍可部分使用） - 兼容旧格式 */
  errors: string[];
  /** 结构化警告信息（包含节点定位） - 新格式 */
  warningsWithLocation?: CompileMessage[];
  /** 结构化错误信息（包含节点定位） - 新格式 */
  errorsWithLocation?: CompileMessage[];
  /** 结构化错误（带错误码、建议修复等） */
  structuredErrors?: CompileError[];
  /** 结构化警告 */
  structuredWarnings?: CompileError[];
}

/** 编译入口 */
export async function compileNodeGraph(graph: NodeGraph): Promise<CompileResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const warningsWithLocation: CompileMessage[] = [];
  const errorsWithLocation: CompileMessage[] = [];
  const structuredWarnings: CompileError[] = [];
  const structuredErrors: CompileError[] = [];

  // Helper to add warning with nodeId (updates both old and new formats)
  const addWarning = (
    message: string,
    nodeId?: string | undefined,
    line?: number | undefined,
    column?: number | undefined,
    snippet?: string | undefined,
    code?: CompileErrorCode | undefined,
    suggestion?: string | undefined,
  ) => {
    warnings.push(message);
    warningsWithLocation.push({
      message,
      location: nodeId ? { nodeId, line, column, snippet } : undefined,
    });
    if (code) {
      structuredWarnings.push(
        createCompileError(code, message, {
          nodeId,
          location: { line, column, snippet },
          suggestion,
        }),
      );
    }
  };
  const addError = (
    message: string,
    nodeId?: string | undefined,
    line?: number | undefined,
    column?: number | undefined,
    snippet?: string | undefined,
    code?: CompileErrorCode | undefined,
    suggestion?: string | undefined,
  ) => {
    errors.push(message);
    errorsWithLocation.push({
      message,
      location: nodeId ? { nodeId, line, column, snippet } : undefined,
    });
    if (code) {
      structuredErrors.push(
        createCompileError(code, message, {
          nodeId,
          location: { line, column, snippet },
          suggestion,
        }),
      );
    }
  };

  // L-3 修复：惰性预取已安装外部 mod 列表（缓存为 null 时异步拉取一次）。
  // 本次编译仍以空缓存执行（isExternalModInstalled 返回 true 不误报），
  // 后续编译即可使用真实的已安装列表做未安装依赖检测。
  if (!isExternalModsCacheLoaded()) {
    import('../components/lowcode/custom/externalModList.js')
      .then((mod) => mod.listExternalMods())
      .then((mods) =>
        preloadExternalMods(mods.map((m) => ({ namespace: m.namespace, installed: m.installed }))),
      )
      .catch(() => {
        // IPC 失败：保持空缓存（不误报）
      });
  }

  // === 阶段 C：子图内联展开 ===
  // 把 customTypeId 为 null 的 subgraph 节点替换为其引用的子图内部节点。
  // customTypeId 非空的 subgraph 节点（自定义节点）不展开，由 compileCustomNode 处理。
  const inlineResult = inlineSubgraphNodes(graph, subgraphManager);
  for (const w of inlineResult.warnings) {
    addWarning(w);
  }
  const inlinedGraph = inlineResult.graph;

  // P2 dogfood 优化：重建内联展开后的节点索引（子图展开后节点可能变化）
  const inlinedNodeMap = new Map(inlinedGraph.nodes.map((n) => [n.id, n]));

  // 过滤禁用节点
  const activeNodes = inlinedGraph.nodes.filter((n) => !n.data.disabled);

  // === P0-1: 节点级 codeLock（对标 MCreator codeLock）===
  // 锁定节点（codeLocked=true 且 lockedCode 非空）跳过常规编译，直接使用用户手改代码。
  // 锁定但 lockedCode 为空的节点回退到常规编译并产生 warning（提示用户补全或解锁）。
  // comment 节点即使锁定也不产生 customCode（本就跳过编译）。
  const lockedNodes = activeNodes.filter(
    (n) => n.data.codeLocked && n.data.lockedCode && n.data.kind !== 'comment',
  );
  const compilableNodes = activeNodes.filter((n) => !lockedNodes.includes(n));
  for (const n of activeNodes) {
    if (n.data.codeLocked && !n.data.lockedCode && n.data.kind !== 'comment') {
      addWarning(
        `节点 ${n.id} 已锁定代码但 lockedCode 为空，回退到常规编译（请补全锁定代码或解锁节点）`,
        n.id,
        undefined,
        undefined,
        undefined,
        CompileErrorCode.NODE_LOCKED_EMPTY,
        '补全 lockedCode 或解锁节点',
      );
    }
  }

  // === 问题 13：modId 净化为合法命名空间 ===
  // modId 用作 Java 包名/资源命名空间，必须为小写字母/数字/下划线。
  // 净化规则：转小写 → 非法字符替换为下划线 → 折叠连续下划线 → 去除首尾下划线。
  const sanitizedModId = sanitizeModId(inlinedGraph.modId);

  // 校验：modId 必须有（净化前为空才报错）
  if (!inlinedGraph.modId) {
    addError(
      '节点图缺少 modId，无法编译',
      undefined,
      undefined,
      undefined,
      undefined,
      CompileErrorCode.GRAPH_MISSING_MODID,
      '在图设置中填写 modId（小写字母/数字/下划线）',
    );
  } else if (!sanitizedModId) {
    // P1-2 dogfood 修复：原始 modId 非空但净化后为空（全是非法字符），明确报错
    addError(
      `modId「${inlinedGraph.modId}」净化后为空（全部为非法字符），请使用小写字母/数字/下划线`,
      undefined,
      undefined,
      undefined,
      undefined,
      CompileErrorCode.GRAPH_INVALID_MODID,
      '修改 modId 仅包含 a-z、0-9、_',
    );
  } else if (sanitizedModId !== inlinedGraph.modId.toLowerCase()) {
    // 净化后与原始不同（含有非法字符被替换），发出 warning
    addWarning(
      `modId「${inlinedGraph.modId}」包含非法字符，已净化为「${sanitizedModId}」`,
      undefined,
      undefined,
      undefined,
      undefined,
      CompileErrorCode.GRAPH_MODID_SANITIZED,
      '建议直接使用净化后的 modId',
    );
  }

  // === P0-1: 锁定节点的手改代码先收集（跳过常规编译）===
  // 锁定节点不经过编译器注册表分发，直接用用户保存的 lockedCode 包装为 snippet。
  // language 固定为 java（MC mod 主体语言）；methodName/snippetId 用节点 id 保持可追溯。
  // 这部分先于 dispatch 收集，保证锁定代码排在 customCode 数组最前（便于回溯）。
  const lockedCustomCode: CustomCodeSnippetSpec[] = [];
  for (const node of lockedNodes) {
    lockedCustomCode.push({
      snippetId: node.id,
      language: 'java',
      code: node.data.lockedCode ?? '',
      inputSignature: {},
      outputSignature: {},
      methodName: `locked_${node.id}`,
    });
  }

  // === P1-2: 通过编译器注册表分发（对标 MCreator ModElementGenerator registry）===
  // 遍历 compilableNodes 一次，按 node.data.kind 查 nodeCompilerRegistry 分发，
  // 每个编译器返回贡献到 ModSpec 各字段的产出，由 compileAll 合并。
  // - comment 等文档型节点未注册 compiler，静默跳过（不产生 warning 或 error）
  // - 编译器抛异常由 compileAll 捕获转为 error（带 kind 前缀，不中断其他节点）
  // - 自定义节点（subgraph + customTypeId）的 schema 未注册错误经 output.errors 上报，
  //   保留「自定义节点 ... 编译失败」原始消息（见 subgraph compiler 注册）
  // - 配方/事件等需要查连线的编译器通过 ctx.graph 访问内联展开后的图
  // - 循环节点通过 ctx.compileLoopBody 递归编译 body 子图
  const ctx: CompileContext = {
    graph: inlinedGraph,
    sanitizedModId,
    nodeMap: inlinedNodeMap,
    // P1-4 dogfood 修复：传入 warnings 数组以便 compileLoopBody 报告 condition/procedure 节点
    compileLoopBody: (bodySubgraphId) => compileLoopBody(inlinedGraph, bodySubgraphId, warnings),
    warnings,
  };
  const { output: dispatched, errors: dispatchErrors } = await compileAll(compilableNodes, ctx);
  for (const message of dispatchErrors) {
    addError(message);
  }
  if (dispatched.errors) {
    for (const message of dispatched.errors) addError(message);
  }
  if (dispatched.warnings) {
    for (const message of dispatched.warnings) addWarning(message);
  }

  const items = dispatched.items ?? [];
  const blocks = dispatched.blocks ?? [];
  const recipes = dispatched.recipes ?? [];
  const entities = dispatched.entities ?? [];
  const machines = dispatched.machines ?? [];
  const multiblocks = dispatched.multiblocks ?? [];
  const biomes = dispatched.biomes ?? [];
  const dimensions = dispatched.dimensions ?? [];
  const fluids = dispatched.fluids ?? [];
  const guis = dispatched.guis ?? [];
  const structures = dispatched.structures ?? [];
  const eventHandlers = dispatched.eventHandlers ?? [];
  const conditions = dispatched.conditions ?? [];
  const actions = dispatched.actions ?? [];
  const procedures = dispatched.procedures ?? [];

  // === P2-5: 循环节点 body 子图的 condition/procedure 收集 ===
  // 循环体的 Java 代码引用 check_<id> / procedure_<name> 方法，
  // 因此需把循环体子图内的条件与过程节点编译进 spec.conditions / spec.procedures。
  // 按节点 id 去重（同一子图可能被多个 loop 节点引用）。
  {
    const loopSubgraphSpecs = compileLoopSubgraphSpecsAll(compilableNodes, inlinedGraph, warnings);
    for (const c of loopSubgraphSpecs.conditions) {
      if (!conditions.some((existing) => existing.conditionId === c.conditionId)) {
        conditions.push(c);
      }
    }
    for (const p of loopSubgraphSpecs.procedures) {
      if (!procedures.some((existing) => existing.procedureId === p.procedureId)) {
        procedures.push(p);
      }
    }
  }
  // customCode = 锁定代码（最前，便于回溯）+ dispatch 产出的 code/variable/loop/subgraph-custom（图顺序）
  const customCode: CustomCodeSnippetSpec[] = [
    ...lockedCustomCode,
    ...(dispatched.customCode ?? []),
  ];

  // === 阶段 C：外部 mod 依赖检测 ===
  // 扫描所有物品/方块/配方的 id 和 customCode，提取 modid 命名空间，
  // 与已安装外部 mod 列表比对，未安装的加 warning（不阻断编译）。
  // 注意：listExternalMods 是异步函数，但编译器同步执行——此处用同步缓存，
  // 真正的已安装列表由 preload 阶段异步预取并缓存到 module-level 变量。
  // 问题 14：使用净化后的 modId 做命名空间比较，避免大小写不一致误报当前 mod 引用。
  const externalNamespaces = collectExternalNamespaces(
    items,
    blocks,
    recipes,
    entities,
    machines,
    multiblocks,
    customCode,
    sanitizedModId,
  );
  for (const ns of externalNamespaces) {
    if (!isExternalModInstalled(ns)) {
      addWarning(
        `引用了外部 mod 命名空间「${ns}」，但该 mod 未安装，运行时可能缺失依赖`,
        undefined,
        undefined,
        undefined,
        undefined,
        CompileErrorCode.EXTERNAL_MOD_NOT_INSTALLED,
        '安装对应的外部 mod 或移除引用',
      );
    }
  }

  // === P1-4 dogfood：过程调用环检测 ===
  // 构建过程调用有向图，检测环（互递归在 Java 运行时导致 StackOverflowError）
  // P2-1 dogfood 修复：环检测去重——同一环内的成员只报一次，避免 A→B→A 产生两条重复 error
  // P1-6 dogfood 修复：孤立过程（无 event/procedure 引用）产生 warning，帮助用户发现死代码
  if (procedures.length > 0) {
    const procedureMap = new Map(procedures.map((p) => [p.procedureId, p.procedureCallIds]));
    const reportedCycleMembers = new Set<string>();

    // 环检测（去重）
    for (const proc of procedures) {
      if (proc.procedureCallIds.length === 0) continue;
      const visited = new Set<string>();
      const inStack = new Set<string>();
      const hasCycle = (pid: string): boolean => {
        if (inStack.has(pid)) return true;
        if (visited.has(pid)) return false;
        inStack.add(pid);
        const callees = procedureMap.get(pid);
        if (callees) {
          for (const calleeId of callees) {
            if (hasCycle(calleeId)) return true;
          }
        }
        inStack.delete(pid);
        visited.add(pid);
        return false;
      };
      if (hasCycle(proc.procedureId)) {
        // 仅当该过程自身不在已报告的环中时才报告（避免对同一环重复报告）
        // P2-1 dogfood 修复：把当前 inStack（含整个环的成员）全部标记为已报告，
        // 否则 A→B→A 互递归会对 A 和 B 各报一条 error。
        if (!reportedCycleMembers.has(proc.procedureId)) {
          for (const memberId of inStack) reportedCycleMembers.add(memberId);
          addError(
            `过程 ${proc.procedureId}（${proc.procedureName}）存在递归调用链，Java 运行时将导致 StackOverflowError`,
            proc.procedureId,
            undefined,
            undefined,
            undefined,
            CompileErrorCode.CYCLE_PROCEDURE_RECURSIVE,
            '移除过程间的相互调用',
          );
        }
      }
    }

    // P1-6：孤立过程检测——未被任何 event/procedure 的 procedureCallIds 引用的过程是死代码
    const calledProcedureIds = new Set<string>();
    for (const eh of eventHandlers) {
      for (const pid of eh.procedureCallIds) calledProcedureIds.add(pid);
    }
    for (const proc of procedures) {
      for (const pid of proc.procedureCallIds) calledProcedureIds.add(pid);
    }
    for (const proc of procedures) {
      if (!calledProcedureIds.has(proc.procedureId)) {
        addWarning(
          `过程 ${proc.procedureId}（${proc.procedureName}）未被任何事件或过程引用，生成的 Java 方法将无调用方`,
          proc.procedureId,
          undefined,
          undefined,
          undefined,
          CompileErrorCode.PROCEDURE_UNUSED,
          '在事件或其他过程中调用此过程，或删除它',
        );
      }
    }
  }

  // === 问题 24：customCode 按 snippetId 去重 ===
  // 子图内联展开后可能引入重复 snippetId（虽然 inlineSubgraphNodes 已做 ID 碰撞处理，
  // 但仍可能出现用户手动构造的重复或边界情况）。保留首次出现的 snippet，重复项加 warning。
  const dedupedCustomCode = deduplicateCustomCode(customCode, warnings);

  // === 问题 19：边数量统计只计入未禁用边 ===
  const activeEdgeCount = inlinedGraph.edges.filter((e) => !e.disabled).length;

  const spec: ModSpec = {
    modId: sanitizedModId || 'unnamed_mod',
    version: '1.0.0',
    name: sanitizedModId || '未命名 Mod',
    description: `由节点图编译生成（${activeNodes.length} 个节点，${activeEdgeCount} 条连线）`,
    items,
    blocks,
    license: 'MIT',
    authors: [],
    credits: '',
    dependencies: [],
    website: '',
    lootTables: [],
    advancements: [],
    tags: [],
    functions: [],
    recipes,
    entities,
    machines,
    customCode: dedupedCustomCode,
    multiblocks,
    // Mod 侧世界生成（由 biome/dimension/fluid 节点编译）
    biomes,
    dimensions,
    fluids,
    // GUI 界面（由 gui 节点编译）
    guis,
    // Mod 侧结构（当前无结构节点，恒为空数组；为 ModSpec 兼容保留）
    structures,
    eventHandlers,
    conditions,
    actions,
    procedures,
  };

  return {
    spec,
    warnings,
    errors,
    warningsWithLocation,
    errorsWithLocation,
    structuredWarnings,
    structuredErrors,
  };
}
