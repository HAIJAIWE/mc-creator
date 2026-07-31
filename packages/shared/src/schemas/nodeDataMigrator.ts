/**
 * 节点数据迁移器（对标 MCreator GeneratableElement.formatVersion + 转换器）
 *
 * ## 为什么需要
 *
 * 节点 schema 会随版本演进（字段改名 / 类型变更 / 结构重组）。直接用 Zod default
 * 只能处理「新增可选字段」这一种最简单的情况；遇到破坏性变更（如字段改名）时，
 * 旧 JSON 反序列化后会丢失语义。
 *
 * MCreator 的解法是给每个 GeneratableElement 加 `formatVersion` 字段，并在加载时
 * 按版本链 v1→v2→v3... 顺序应用 converter。本模块复刻这一机制。
 *
 * ## 使用方式
 *
 * 1. schema 演进时，bump `LATEST_FORMAT_VERSION`
 * 2. 调用 `registerMigrator(kind, fromVersion, toVersion, migrateFn)` 注册迁移函数
 * 3. 反序列化时调用 `migrateGraph(graph)`，自动遍历所有节点应用迁移
 *
 * ## 迁移函数约定
 *
 * - 输入/输出都是 `Record<string, unknown>`（不是严格的 NodeData，避免循环依赖）
 * - 必须返回新对象（不可原地修改输入）
 * - 应保持 `kind` / `nodeId` 等标识字段不变
 *
 * ## 注册时机
 *
 * 迁移器应在模块加载时注册（顶层 `registerMigrator` 调用）。当前版本（v1）尚无
 * 破坏性变更，注册表为空；后续 schema 演进时在此文件底部追加注册。
 */

import type { NodeData, NodeGraph, NodeKind } from './node-graph-spec.js';

// === 常量 ===

/**
 * 当前节点数据格式最新版本号。
 *
 * - 新创建的节点 data.formatVersion = LATEST_FORMAT_VERSION
 * - 反序列化旧 JSON 时，缺少 formatVersion 字段视为 v1
 * - migrateNodeData 把数据从其 formatVersion 顺序迁移到 LATEST
 *
 * 版本历史：
 * - v1（2026-07）：初始版本，BaseNodeData 含 nodeId/label/note/disabled/collapsed/codeLocked/lockedCode
 */
export const LATEST_FORMAT_VERSION = 1;

// === 类型 ===

/** 单个迁移器条目：把 kind 节点从 fromVersion 迁移到 toVersion */
interface MigratorEntry {
  fromVersion: number;
  toVersion: number;
  migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

/** migrateNodeData 返回值 */
export interface MigrateNodeDataResult {
  /** 迁移后的节点数据 */
  data: NodeData;
  /** 是否实际发生了迁移（true=至少应用了一个迁移器） */
  migrated: boolean;
  /** 迁移过程中产生的警告（如缺失中间版本迁移器） */
  warnings: string[];
}

/** migrateGraph 返回值 */
export interface MigrateGraphResult {
  /** 迁移后的节点图 */
  graph: NodeGraph;
  /** 汇总的所有节点迁移警告 */
  warnings: string[];
}

// === 注册表 ===

const migrators = new Map<NodeKind, MigratorEntry[]>();

/**
 * 注册迁移器：把指定 kind 的节点从 fromVersion 迁移到 toVersion。
 *
 * 同一 (kind, fromVersion) 可注册多个迁移器（按注册顺序应用第一个），
 * 但建议保持 fromVersion 唯一，避免歧义。
 *
 * @param kind 节点类型
 * @param fromVersion 源版本号
 * @param toVersion 目标版本号（应 = fromVersion + 1）
 * @param migrate 迁移函数，输入/输出都是 plain object
 */
export function registerMigrator(
  kind: NodeKind,
  fromVersion: number,
  toVersion: number,
  migrate: (data: Record<string, unknown>) => Record<string, unknown>,
): void {
  // S-8 修复：拒绝反向/相同版本注册，否则 while 循环可能永不前进（死循环）
  if (toVersion <= fromVersion) {
    throw new Error(
      `registerMigrator(${kind}, ${fromVersion} -> ${toVersion})：toVersion 必须大于 fromVersion`,
    );
  }
  const list = migrators.get(kind) ?? [];
  list.push({ fromVersion, toVersion, migrate });
  migrators.set(kind, list);
}

/** 清空所有注册的迁移器（主要供测试使用） */
export function clearMigrators(): void {
  migrators.clear();
}

// === 迁移逻辑 ===

/**
 * 迁移单个节点数据到 LATEST_FORMAT_VERSION。
 *
 * 算法：
 * 1. 读取 data.formatVersion（缺失视为 1）
 * 2. 若当前版本 < LATEST，查找 fromVersion=current 的迁移器
 * 3. 找到则应用，current = entry.toVersion，重复
 * 4. 找不到则产生 warning 并停止（不阻断，返回当前数据）
 *
 * @param data 节点数据（可能是旧格式）
 * @returns 迁移结果（data / migrated / warnings）
 */
export function migrateNodeData(data: NodeData): MigrateNodeDataResult {
  const kind = data.kind;
  const entryList = migrators.get(kind) ?? [];
  let current = data as Record<string, unknown>;
  // 缺少 formatVersion 字段视为 v1（向前兼容旧 JSON）
  const rawVersion = current.formatVersion;
  let currentVersion: number =
    typeof rawVersion === 'number' && Number.isFinite(rawVersion) ? rawVersion : 1;
  const warnings: string[] = [];
  let migrated = false;

  while (currentVersion < LATEST_FORMAT_VERSION) {
    const entry = entryList.find((e) => e.fromVersion === currentVersion);
    if (!entry) {
      warnings.push(
        `${kind} 节点无法从 formatVersion ${currentVersion} 迁移到 ${currentVersion + 1}：未注册迁移器`,
      );
      break;
    }
    current = entry.migrate(current);
    currentVersion = entry.toVersion;
    migrated = true;
  }

  // 同步 formatVersion 字段到最终版本（即使无迁移器，也补全字段）
  if (migrated || current.formatVersion !== currentVersion) {
    current = { ...current, formatVersion: currentVersion };
  }

  return { data: current as NodeData, migrated, warnings };
}

/**
 * 迁移整张节点图的所有节点。
 *
 * 遍历 graph.nodes，对每个 node.data 调用 migrateNodeData，
 * 汇总 warnings（带节点 id 前缀，便于定位）。
 *
 * @param graph 原始节点图（可能是旧格式）
 * @returns 迁移结果（graph / warnings）
 */
export function migrateGraph(graph: NodeGraph): MigrateGraphResult {
  const allWarnings: string[] = [];

  // 迁移主图节点
  const nodes = graph.nodes.map((node) => {
    const { data, warnings } = migrateNodeData(node.data);
    if (warnings.length > 0) {
      allWarnings.push(...warnings.map((w) => `节点 ${node.id}: ${w}`));
    }
    return { ...node, data };
  });

  // S-1 修复：同时迁移子图内的节点（graph.subgraphs[id].nodes）。
  // 此前只迁移主图，子图节点数据保持旧格式，与新 schema 不兼容。
  const subgraphs = { ...graph.subgraphs };
  for (const [subgraphId, sg] of Object.entries(subgraphs)) {
    const sgNodes = sg.nodes.map((node) => {
      const { data, warnings } = migrateNodeData(node.data);
      if (warnings.length > 0) {
        allWarnings.push(...warnings.map((w) => `子图 ${subgraphId} 节点 ${node.id}: ${w}`));
      }
      return { ...node, data };
    });
    subgraphs[subgraphId] = { ...sg, nodes: sgNodes };
  }

  return { graph: { ...graph, nodes, subgraphs }, warnings: allWarnings };
}

// === 迁移器注册区 ===
//
// 当 schema 发生破坏性变更时，在此处追加 registerMigrator 调用。
// 例如：
//   registerMigrator('item', 1, 2, (data) => {
//     // v1→v2：把 itemId 字段重命名为 id
//     const { itemId, ...rest } = data;
//     return { ...rest, id: itemId };
//   });
//
// 当前版本（v1）无破坏性变更，注册表为空。
