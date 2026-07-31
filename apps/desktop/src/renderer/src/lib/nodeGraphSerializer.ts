/**
 * 节点图序列化器
 *
 * 负责将 NodeGraph 导出为可读 JSON 字符串（用于版本控制 diff），
 * 以及将外部 JSON 字符串反序列化回 NodeGraph（用于导入项目）。
 *
 * 设计要点：
 * - 纯函数实现，不依赖 zustand store，便于在任意上下文中调用
 * - 使用手动校验而非 zod，避免运行时 schema 复杂性
 * - 输出格式化 JSON（2 空格缩进），便于 git diff 与人工审阅
 * - 包含魔数 `mc-creator-node-graph` 与版本号，便于未来迁移与识别
 * - 反序列化时严格校验 format / version / graph 三要素
 * - validateGraph 检查节点 id 唯一、边引用完整、type 与 data.kind 一致、必填字段存在
 */

import type { NodeGraph } from '@mc-creator/shared';
import { migrateGraph } from '@mc-creator/shared';

// === 常量 ===

/** 序列化格式魔数（用于识别本序列化器输出的 JSON） */
export const SERIALIZER_FORMAT = 'mc-creator-node-graph' as const;

/** 序列化版本号（前向兼容：将来升级时递增，反序列化时拒绝高于当前版本的输入） */
export const SERIALIZER_VERSION = 1 as const;

// === 类型 ===

/** 序列化结果格式 */
export interface SerializedNodeGraph {
  /** 魔数，便于识别文件来源 */
  format: typeof SERIALIZER_FORMAT;
  /** 序列化版本号 */
  version: typeof SERIALIZER_VERSION;
  /** 导出时间（ISO 8601 字符串） */
  exportedAt: string;
  /** 原始节点图数据 */
  graph: NodeGraph;
}

// === 序列化 ===

/**
 * 将 NodeGraph 序列化为格式化 JSON 字符串。
 *
 * 输出包含 format / version / exportedAt / graph 四个字段，
 * 使用 2 空格缩进，便于版本控制 diff。
 *
 * @param graph 待序列化的节点图
 * @returns 格式化 JSON 字符串
 */
export function serializeGraph(graph: NodeGraph): string {
  // P2-7 dogfood 修复：序列化前校验图结构（不阻断导出，但 warning 提醒用户）
  const validationErrors = validateGraph(graph);
  if (validationErrors.length > 0) {
    console.warn('[nodeGraphSerializer] 序列化的图存在结构问题：\n' + validationErrors.join('\n'));
  }

  const payload: SerializedNodeGraph = {
    format: SERIALIZER_FORMAT,
    version: SERIALIZER_VERSION,
    exportedAt: new Date().toISOString(),
    graph,
  };
  // 使用 2 空格缩进，便于 git diff 与人工审阅
  return JSON.stringify(payload, null, 2);
}

// === 反序列化 ===

/**
 * 将 JSON 字符串反序列化为 NodeGraph。
 *
 * 校验链：
 * 1. JSON 语法合法
 * 2. 根节点是对象（非 null / 非数组）
 * 3. format 字段存在且等于 SERIALIZER_FORMAT
 * 4. version 字段存在、是整数、且不高于当前 SERIALIZER_VERSION（前向兼容）
 * 5. graph 字段存在且是对象
 *
 * 任一校验失败时抛出 Error，错误消息包含具体字段名与实际值。
 *
 * @param json 待反序列化的 JSON 字符串
 * @returns 节点图
 * @throws Error 当 JSON 非法或字段校验失败时
 */
export function deserializeGraph(json: string): NodeGraph {
  // 1. JSON 语法校验
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`反序列化失败：JSON 解析错误 - ${(e as Error).message}`);
  }

  // 2. 根节点必须是对象
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const actualType = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    throw new Error(`反序列化失败：根节点必须是对象，实际为 ${actualType}`);
  }

  const obj = parsed as Record<string, unknown>;

  // 3. format 字段校验
  if (!('format' in obj)) {
    throw new Error('反序列化失败：缺少 format 字段');
  }
  if (obj.format !== SERIALIZER_FORMAT) {
    throw new Error(
      `反序列化失败：format 字段不匹配，期望 "${SERIALIZER_FORMAT}"，实际为 "${String(obj.format)}"`,
    );
  }

  // 4. version 字段校验
  if (!('version' in obj)) {
    throw new Error('反序列化失败：缺少 version 字段');
  }
  const version = obj.version;
  if (typeof version !== 'number' || !Number.isFinite(version) || !Number.isInteger(version)) {
    throw new Error(`反序列化失败：version 字段必须是整数，实际为 "${String(version)}"`);
  }
  // P2 dogfood：版本号应 >= 1（0 或负数语义不合法）
  if (version < 1) {
    throw new Error(`反序列化失败：version 字段为 ${version}，版本号必须 >= 1`);
  }
  if (version > SERIALIZER_VERSION) {
    throw new Error(
      `反序列化失败：version 字段为 ${version}，当前序列化器仅支持到版本 ${SERIALIZER_VERSION}（前向不兼容，请升级序列化器）`,
    );
  }

  // 5. graph 字段校验
  if (!('graph' in obj)) {
    throw new Error('反序列化失败：缺少 graph 字段');
  }
  const graph = obj.graph;
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    const actualType = graph === null ? 'null' : Array.isArray(graph) ? 'array' : typeof graph;
    throw new Error(`反序列化失败：graph 字段必须是对象，实际为 ${actualType}`);
  }

  // 5.5. graph 内部结构校验：nodes/edges 必须是数组（migrateGraph 依赖 graph.nodes.map）
  // P0 dogfood 修复：缺少此校验会导致 migrateGraph 内部崩溃（TypeError: .map of undefined）
  const graphObj = graph as Record<string, unknown>;
  if (!('nodes' in graphObj)) {
    throw new Error('反序列化失败：graph 缺少 nodes 字段');
  }
  if (!Array.isArray(graphObj.nodes)) {
    throw new Error(
      `反序列化失败：graph.nodes 必须是数组，实际为 ${Array.isArray(graphObj.nodes) ? 'array' : typeof graphObj.nodes}`,
    );
  }
  // edges 可选缺失（旧 JSON 可能无此字段），默认为空数组
  if (!('edges' in graphObj) || !Array.isArray(graphObj.edges)) {
    graphObj.edges = [];
  }

  // 6. 节点数据迁移（对标 MCreator GeneratableElement.formatVersion 转换器）
  //    旧 JSON 的节点 data 可能缺少 formatVersion 字段（视为 v1），
  //    migrateGraph 顺序应用已注册的迁移器把数据升级到 LATEST_FORMAT_VERSION。
  //    迁移 warning 不阻断加载（旧数据仍可用），仅 console.warn 供调试。
  const { graph: migratedGraph, warnings } = migrateGraph(graph as NodeGraph);
  if (warnings.length > 0) {
    // 用 console.warn 而非 throw：迁移失败不应阻断项目打开，
    // 用户仍可手动修复受影响节点。warning 文本含节点 id 便于定位。
    console.warn('[nodeGraphSerializer] 节点数据迁移产生警告：\n' + warnings.join('\n'));
  }

  // 7. 迁移后结构校验（防止迁移器 bug 或旧数据缺失字段导致下游崩溃）
  // P0 dogfood 修复：不阻断加载，但记录 warning 供调试
  const postMigrationErrors = validateGraph(migratedGraph);
  if (postMigrationErrors.length > 0) {
    console.warn(
      '[nodeGraphSerializer] 迁移后图结构校验失败（不阻断加载，供调试）：\n' +
        postMigrationErrors.join('\n'),
    );
  }

  return migratedGraph;
}

/**
 * 安全反序列化：不抛错，返回结果对象。
 *
 * 适用于用户上传文件等不可信输入场景，调用方通过 ok 字段判断成功与否。
 *
 * @param json 待反序列化的 JSON 字符串
 * @returns 成功返回 `{ ok: true, graph }`，失败返回 `{ ok: false, error }`
 */
export function safeDeserializeGraph(
  json: string,
): { ok: true; graph: NodeGraph } | { ok: false; error: string } {
  try {
    const graph = deserializeGraph(json);
    return { ok: true, graph };
  } catch (e) {
    // P1 dogfood 修复：非 Error 对象的异常（如原生 TypeError）也应安全处理
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

// === 结构校验 ===

/**
 * 校验节点图结构完整性。
 *
 * 检查项：
 * - 节点 id 唯一
 * - 节点 type 与 data.kind 一致
 * - 各类节点的必填字段存在（item.itemId、block.blockId、entity.entityId、
 *   recipe.recipeId、machine.machineId、multiblock.structureId）
 * - 边的 source / target 必须指向存在的节点
 *
 * @param graph 待校验的节点图
 * @returns 错误消息数组，空数组表示通过校验
 */
export function validateGraph(graph: NodeGraph): string[] {
  const errors: string[] = [];

  // 基本结构校验：nodes / edges 必须是数组
  if (!graph || typeof graph !== 'object') {
    errors.push('graph 必须是对象');
    return errors;
  }
  if (!Array.isArray(graph.nodes)) {
    errors.push(`graph.nodes 必须是数组，实际为 ${typeof graph.nodes}`);
    return errors; // 后续校验依赖 nodes，直接返回
  }
  if (!Array.isArray(graph.edges)) {
    errors.push(`graph.edges 必须是数组，实际为 ${typeof graph.edges}`);
    // 不返回，继续校验节点
  }

  // 节点 id 唯一性校验 + 收集 id 集合供边校验使用
  const nodeIdSet = new Set<string>();
  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object') {
      errors.push(`节点结构非法：${JSON.stringify(node)}`);
      continue;
    }
    if (typeof node.id !== 'string' || node.id === '') {
      errors.push(`节点 id 必须是非空字符串，实际为 "${String(node.id)}"`);
      continue;
    }
    if (nodeIdSet.has(node.id)) {
      errors.push(`节点 id 重复：${node.id}`);
    } else {
      nodeIdSet.add(node.id);
    }
  }

  // 节点 type 与 data.kind 一致性校验 + 必填字段校验
  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object') continue;
    if (typeof node.id !== 'string' || node.id === '') continue;

    const data = node.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') {
      errors.push(`节点 ${node.id} 的 data 字段必须是对象`);
      continue;
    }

    // type 与 data.kind 一致
    const nodeType = node.type;
    const dataKind = data.kind;
    if (nodeType !== dataKind) {
      errors.push(
        `节点 ${node.id} 的 type (${String(nodeType)}) 与 data.kind (${String(dataKind)}) 不一致`,
      );
    }

    // P2 dogfood：节点 position 校验（undefined/NaN 导致 React Flow 崩溃）
    if (
      !node.position ||
      typeof node.position !== 'object' ||
      typeof (node.position as Record<string, unknown>).x !== 'number' ||
      typeof (node.position as Record<string, unknown>).y !== 'number' ||
      !Number.isFinite((node.position as Record<string, unknown>).x as number) ||
      !Number.isFinite((node.position as Record<string, unknown>).y as number)
    ) {
      errors.push(`节点 ${node.id} 的 position 字段必须是 { x: finite, y: finite }`);
    }

    // 各类节点的必填字段校验
    const requiredFieldError = checkRequiredFields(node.id, dataKind, data);
    if (requiredFieldError) {
      errors.push(requiredFieldError);
    }
  }

  // 边引用完整性校验
  if (Array.isArray(graph.edges)) {
    // P2-5 dogfood 修复：边 ID 唯一性检查（重复边 ID 导致 removeEdge 操作不可预测）
    const edgeIdSet = new Set<string>();
    for (const edge of graph.edges) {
      if (!edge || typeof edge !== 'object') {
        errors.push(`边结构非法：${JSON.stringify(edge)}`);
        continue;
      }
      const edgeId = typeof edge.id === 'string' ? edge.id : '(无 id)';
      const source = edge.source;
      const target = edge.target;
      if (typeof source !== 'string' || !nodeIdSet.has(source)) {
        errors.push(`边 ${edgeId} 引用了不存在的源节点：${String(source)}`);
      }
      if (typeof target !== 'string' || !nodeIdSet.has(target)) {
        errors.push(`边 ${edgeId} 引用了不存在的目标节点：${String(target)}`);
      }
      // P2 dogfood：边 kind 字段校验（非法 kind 导致编译器分发失败）
      const VALID_EDGE_KINDS = new Set([
        'craft',
        'structure',
        'flow',
        'control',
        'depends',
        'data',
      ]);
      if (typeof edge.kind === 'string' && !VALID_EDGE_KINDS.has(edge.kind)) {
        errors.push(`边 ${edgeId} 的 kind 字段非法：${String(edge.kind)}`);
      }
      // P2-5：边 ID 唯一性
      if (typeof edge.id === 'string') {
        if (edgeIdSet.has(edge.id)) {
          errors.push(`边 ID 重复：${edge.id}`);
        } else {
          edgeIdSet.add(edge.id);
        }
      }
      // P2-6 dogfood 修复：自连接边检查（source === target 可能是误操作）
      if (typeof source === 'string' && typeof target === 'string' && source === target) {
        errors.push(`边 ${edgeId} 为自连接（source === target: ${source}），可能是误操作`);
      }
    }
  }

  return errors;
}

/**
 * 检查各类节点的必填字段。
 * 返回错误消息字符串（首个缺失字段），通过则返回 null。
 */
function checkRequiredFields(
  nodeId: string,
  kind: unknown,
  data: Record<string, unknown>,
): string | null {
  switch (kind) {
    case 'item': {
      const v = data.itemId;
      if (typeof v !== 'string' || v === '') {
        return `物品节点 ${nodeId} 缺少必填字段 itemId（期望非空字符串，实际为 "${String(v)}"）`;
      }
      return null;
    }
    case 'block': {
      const v = data.blockId;
      if (typeof v !== 'string' || v === '') {
        return `方块节点 ${nodeId} 缺少必填字段 blockId（期望非空字符串，实际为 "${String(v)}"）`;
      }
      return null;
    }
    case 'entity': {
      const v = data.entityId;
      if (typeof v !== 'string' || v === '') {
        return `实体节点 ${nodeId} 缺少必填字段 entityId（期望非空字符串，实际为 "${String(v)}"）`;
      }
      return null;
    }
    case 'recipe': {
      const v = data.recipeId;
      if (typeof v !== 'string' || v === '') {
        return `配方节点 ${nodeId} 缺少必填字段 recipeId（期望非空字符串，实际为 "${String(v)}"）`;
      }
      return null;
    }
    case 'machine': {
      const v = data.machineId;
      if (typeof v !== 'string' || v === '') {
        return `机器节点 ${nodeId} 缺少必填字段 machineId（期望非空字符串，实际为 "${String(v)}"）`;
      }
      return null;
    }
    case 'multiblock': {
      const v = data.structureId;
      if (typeof v !== 'string' || v === '') {
        return `多方块节点 ${nodeId} 缺少必填字段 structureId（期望非空字符串，实际为 "${String(v)}"）`;
      }
      return null;
    }
    // P1 dogfood 修复：event/condition/action 有必填枚举字段，不应跳过校验
    case 'event': {
      const v = data.eventType;
      if (typeof v !== 'string' || v === '') {
        return `事件节点 ${nodeId} 缺少必填字段 eventType`;
      }
      return null;
    }
    case 'condition': {
      const v = data.conditionType;
      if (typeof v !== 'string' || v === '') {
        return `条件节点 ${nodeId} 缺少必填字段 conditionType`;
      }
      return null;
    }
    case 'action': {
      const v = data.actionType;
      if (typeof v !== 'string' || v === '') {
        return `动作节点 ${nodeId} 缺少必填字段 actionType`;
      }
      return null;
    }
    case 'code':
    case 'comment':
      return null;
    // P1-3 dogfood 修复：新增节点类型 variable/loop/procedure/subgraph 的必填校验
    case 'variable': {
      const name = data.varName;
      if (typeof name !== 'string' || name === '') {
        return `变量节点 ${nodeId} 缺少必填字段 varName`;
      }
      const type = data.varType;
      if (typeof type !== 'string' || type === '') {
        return `变量节点 ${nodeId} 缺少必填字段 varType`;
      }
      return null;
    }
    case 'loop': {
      // P1 dogfood 修复：condition 有 z.string().default('')，空字符串合法；
      // 仅校验 loopType（必填 enum，无 default）
      const lt = data.loopType;
      if (typeof lt !== 'string' || lt === '') {
        return `循环节点 ${nodeId} 缺少必填字段 loopType`;
      }
      return null;
    }
    case 'procedure': {
      const v = data.procedureName;
      if (typeof v !== 'string' || v === '') {
        return `过程节点 ${nodeId} 缺少必填字段 procedureName`;
      }
      return null;
    }
    case 'subgraph':
      // subgraph 节点无额外必填字段（subgraphId/customTypeId 可选）
      return null;
    default:
      return `节点 ${nodeId} 的 data.kind 未知：${String(kind)}`;
  }
}

// === 文件下载 ===

/**
 * 将已序列化的 JSON 字符串作为 .json 文件下载（浏览器端）。
 *
 * 实现步骤：
 * 1. 创建 Blob（MIME 类型 application/json）
 * 2. 通过 URL.createObjectURL 生成临时下载链接
 * 3. 创建 `<a>` 元素并附加到 document.body（Firefox 要求附加到 DOM 才能触发 click）
 * 4. 触发 click 下载
 * 5. 移除 `<a>` 元素并调用 URL.revokeObjectURL 释放内存
 *
 * 文件名约定：调用方应传入 `${modId || 'untitled'}-node-graph.json` 格式的文件名，
 * 便于在文件系统中识别来源项目。
 *
 * @param graph 已序列化的 JSON 字符串（即 serializeGraph 的返回值）
 * @param filename 下载文件名（如 'my_mod-node-graph.json'）
 */
export function downloadGraphAsJson(graph: string, filename: string): void {
  // P2 dogfood：SSR 环境下 document 不存在，防御性检查
  if (typeof document === 'undefined' || !document.body) {
    console.error('[nodeGraphSerializer] downloadGraphAsJson 仅支持浏览器环境');
    return;
  }

  // 1. 创建 Blob
  const blob = new Blob([graph], { type: 'application/json' });

  // 2. 创建对象 URL
  const url = URL.createObjectURL(blob);

  // 3. 创建 <a> 元素并触发下载
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // 部分浏览器要求 <a> 必须附加到 DOM 才能触发 click 下载
  document.body.appendChild(anchor);
  anchor.click();

  // 4. 清理 DOM 与对象 URL
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
