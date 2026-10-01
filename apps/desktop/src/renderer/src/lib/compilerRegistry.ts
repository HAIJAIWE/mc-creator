import { compileVariable } from './compileVariable.js';
import { compileCustomNode } from './compileCustomNode.js';
import { compileLoop } from './compileLoop.js';
import { registerCompiler } from './nodeCompilerRegistry.js';
import {
  compileItemNode,
  compileBlockNode,
  compileRecipeNode,
  compileEntityNode,
  compileMachineNode,
  compileBiomeNode,
  compileDimensionNode,
  compileFluidNode,
  compileGuiNode,
  compileCodeNode,
  compileMultiblockNode,
  compileEventNode,
  compileConditionNode,
  compileActionNode,
  compileProcedureNode,
} from './compileNodeGraph.js';

/**
 * 内置节点编译器注册（对标 MCreator ModElementGenerator registry）
 *
 * 每种 NodeKind 注册一个 compiler，把 per-kind 编译函数适配为统一的 CompilerOutput 契约。
 * 主编译器 compileNodeGraph 通过 compileAll 查表分发，新增内置类型只需在此追加 registerCompiler。
 *
 * 注册在模块加载时执行（顶层副作用）。编译函数保持私有，仅通过 registry 暴露。
 * 注意：comment 节点不注册（compileAll 静默跳过，保持「仅文档用途」语义）。
 */

// --- item ---
// 引用型 item 节点（isReference）只用于画布连线定位，代表本 mod 之外的物品
// （如 minecraft:diamond）。编译时跳过，否则会把外部物品"凭空"注册成本 mod 的物品。
registerCompiler({
  kind: 'item',
  compile: (node) =>
    node.data.kind === 'item' && node.data.isReference ? {} : { items: [compileItemNode(node)] },
});

// --- block ---
registerCompiler({
  kind: 'block',
  compile: (node) => ({ blocks: [compileBlockNode(node)] }),
});

// --- recipe ---
// 配方编译需要查连线（输入/输出物品），通过 ctx.graph 访问内联展开后的图
// P2 dogfood 优化：传入 ctx.nodeMap 加速节点查找
registerCompiler({
  kind: 'recipe',
  compile: (node, ctx) => ({ recipes: [compileRecipeNode(ctx.graph, node, ctx.nodeMap)] }),
});

// --- entity ---
registerCompiler({
  kind: 'entity',
  compile: (node) => ({ entities: [compileEntityNode(node)] }),
});

// --- machine ---
registerCompiler({
  kind: 'machine',
  compile: (node) => ({ machines: [compileMachineNode(node)] }),
});

// --- biome ---
registerCompiler({
  kind: 'biome',
  compile: (node) => ({ biomes: [compileBiomeNode(node)] }),
});

// --- dimension ---
registerCompiler({
  kind: 'dimension',
  compile: (node) => ({ dimensions: [compileDimensionNode(node)] }),
});

// --- fluid ---
registerCompiler({
  kind: 'fluid',
  compile: (node) => ({ fluids: [compileFluidNode(node)] }),
});

// --- gui ---
registerCompiler({
  kind: 'gui',
  compile: (node) => ({ guis: [compileGuiNode(node)] }),
});

// --- code ---
// P2-4 dogfood：传入 warnings 数组以便 compileCodeNode 报告端口签名解析失败
registerCompiler({
  kind: 'code',
  compile: (node, ctx) => ({ customCode: [compileCodeNode(node, ctx.warnings)] }),
});

// --- multiblock ---
registerCompiler({
  kind: 'multiblock',
  compile: (node) => ({ multiblocks: [compileMultiblockNode(node)] }),
});

// --- event ---
// 事件节点通过 control 边 BFS 收集可达的 condition/action/procedure 节点
registerCompiler({
  kind: 'event',
  compile: (node, ctx) => ({
    eventHandlers: [compileEventNode(ctx.graph, node, ctx.warnings, ctx.nodeMap)],
  }),
});

// --- condition ---
registerCompiler({
  kind: 'condition',
  compile: (node, ctx) => ({ conditions: [compileConditionNode(node, ctx.warnings)] }),
});

// --- action ---
registerCompiler({
  kind: 'action',
  compile: (node, ctx) => ({ actions: [compileActionNode(node, ctx.warnings)] }),
});

// --- procedure ---
// P1-3：过程编译为独立 ProcedureSpec，通过 BFS 收集体内 condition/action/procedure
registerCompiler({
  kind: 'procedure',
  compile: (node, ctx) => ({ procedures: [compileProcedureNode(ctx.graph, node, ctx.nodeMap)] }),
});

// --- subgraph (custom nodes) ---
// 自定义节点：kind=subgraph 且 customTypeId 非空
// 编译时查找 customNodeRegistry 中的 schema，验证并转换为 customCode snippet
registerCompiler({
  kind: 'subgraph',
  compile: async (node, _ctx) => {
    if (node.data.kind !== 'subgraph') return {};
    if (!node.data.customTypeId) return {};
    const result = await compileCustomNode(node.data, node.data.customFields ?? {});
    if (result.error) {
      return { errors: [`自定义节点 ${node.id} 编译失败：${result.error}`] };
    }
    if (result.snippet) {
      return { customCode: [result.snippet] };
    }
    return {};
  },
});

// --- variable ---
// 变量节点：编译为 Java 字段声明，push 到 customCode
registerCompiler({
  kind: 'variable',
  compile: (node) => {
    if (node.data.kind !== 'variable') return {};
    const { snippet } = compileVariable(node.data);
    return { customCode: [snippet] };
  },
});

// --- loop ---
// 循环节点：编译为 Java 循环代码，bodyCode 从 bodySubgraphId 子图编译（通过 ctx.compileLoopBody 递归）
registerCompiler({
  kind: 'loop',
  compile: (node, ctx) => {
    if (node.data.kind !== 'loop') return {};
    const data = node.data;
    const bodyCode = data.bodySubgraphId ? ctx.compileLoopBody(data.bodySubgraphId) : '// no body';
    const { snippet } = compileLoop(data, bodyCode);
    return { customCode: [snippet] };
  },
});
