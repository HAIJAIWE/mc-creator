/**
 * 节点图持久化纯函数层
 *
 * 职责：
 * - 将 NodeGraph 保存到磁盘（serializeGraph → IPC 写文件）
 * - 从磁盘加载 NodeGraph（IPC 读文件 → safeDeserializeGraph）
 * - 维护「最近打开」列表（localStorage，去重 + LRU，最多 10 条）
 *
 * 设计要点：
 * - 所有 fs 调用通过 `window.api.nodeGraph.save/load` 桥接（Electron IPC），
 *   渲染层不直接 require('fs')，便于在 jsdom 测试中 mock
 * - save/load 返回 discriminated union `{ ok: true; ... } | { ok: false; error }`，
 *   调用方通过 ok 字段判断成功与否，无需 try/catch
 * - 最近列表用 localStorage 存储（与主进程解耦，便于测试与多窗口共享）
 * - localStorage 不可用时静默降级（不抛错，最近列表功能失效但不阻断主流程）
 *
 * 与 nodeGraphSerializer 的关系：
 * - serializeGraph 把 NodeGraph → JSON 字符串（含 format/version/exportedAt 元信息）
 * - safeDeserializeGraph 把 JSON 字符串 → NodeGraph（带校验，不抛错）
 * - 本模块在两者基础上加 fs 持久化与最近列表管理
 */

import type { NodeGraph } from '@mc-creator/shared';
import { serializeGraph, safeDeserializeGraph } from './nodeGraphSerializer.js';

// === 类型 ===

/** 最近打开的节点图条目（存于 localStorage） */
export interface RecentGraphEntry {
  /** 文件绝对路径（唯一键，用于去重） */
  filePath: string;
  /** 来源 mod id（用于 UI 显示，可能为空字符串） */
  modId: string;
  /** 保存时间（ISO 8601 字符串） */
  savedAt: string;
  /** 节点数量（用于 UI 显示规模，0 表示未知） */
  nodeCount: number;
}

/** window.api.nodeGraph 的最小接口（与 preload 暴露的 NodeGraphApi 对齐） */
interface NodeGraphBridge {
  save(filePath: string, json: string): Promise<{ ok: true } | { ok: false; error: string }>;
  load(filePath: string): Promise<{ ok: true; json: string } | { ok: false; error: string }>;
  showSaveDialog(defaultName: string): Promise<{ ok: true; filePath: string } | { ok: false }>;
  showOpenDialog(): Promise<{ ok: true; filePath: string } | { ok: false }>;
}

// === 常量 ===

/** localStorage key（带项目前缀避免与其他应用冲突） */
const RECENT_STORAGE_KEY = 'mc-creator:recent-node-graphs';

/** 最近列表最大长度（LRU 截断阈值） */
const MAX_RECENT = 10;

// === 桥接访问 ===

/**
 * 从 window.api 取 nodeGraph 桥接对象。
 *
 * 在测试中可通过 `window.api = { nodeGraph: mock }` 注入 mock；
 * 在生产环境由 preload contextBridge.exposeInMainWorld('api', ...) 注入。
 * 桥接缺失时抛错（让调用方知道 preload 未正确加载，而非静默失败）。
 *
 * 类型安全：window.api 已在 preload/api.d.ts 声明为可选（反映 jsdom 测试环境
 * 可能未注入的现实），无需 `as unknown as` 断言。
 */
function getBridge(): NodeGraphBridge {
  const bridge = window.api?.nodeGraph;
  if (!bridge) {
    throw new Error('window.api.nodeGraph 未注入（preload 未加载或 contextBridge 失败）');
  }
  return bridge;
}

// === 保存到磁盘 ===

/**
 * 将节点图保存到磁盘。
 *
 * 行为：
 * - 若传入 `filePath`：直接序列化 + 写入该路径（不弹对话框）
 * - 若未传 `filePath`：弹保存对话框让用户选路径，取消时返回 `{ ok: false, error: 'canceled' }`
 * - 保存成功后调用 `addRecentGraph` 更新最近列表（含 nodeCount）
 *
 * @param graph 待保存的节点图
 * @param filePath 可选目标路径；不传则弹对话框
 * @returns 成功返回 `{ ok: true, path }`，失败/取消返回 `{ ok: false, error }`
 */
export async function saveGraphToDisk(
  graph: NodeGraph,
  filePath?: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const bridge = getBridge();
    let path = filePath;
    if (!path) {
      // 默认文件名：modId-node-graph.json（modId 为空时退化为 node-graph.json）
      const defaultName = graph.modId ? `${graph.modId}-node-graph.json` : 'node-graph.json';
      const dialogRes = await bridge.showSaveDialog(defaultName);
      if (!dialogRes.ok) {
        return { ok: false, error: 'canceled' };
      }
      path = dialogRes.filePath;
    }
    // 序列化（serializeGraph 不抛错，固定产出合法 JSON 字符串）
    const json = serializeGraph(graph);
    // 写盘
    const writeRes = await bridge.save(path, json);
    if (!writeRes.ok) {
      return { ok: false, error: writeRes.error };
    }
    // 更新最近列表（localStorage 不可用时静默降级）
    addRecentGraph(path, graph.modId, graph.nodes.length);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// === 从磁盘加载 ===

/**
 * 从磁盘加载节点图。
 *
 * 行为：
 * - 读取指定路径的 JSON 字符串
 * - 用 `safeDeserializeGraph` 反序列化为 NodeGraph（带 format/version/graph 校验）
 * - 文件不存在 / JSON 损坏 / 反序列化失败均返回 `{ ok: false, error }`，不抛错
 *
 * @param filePath 目标文件绝对路径
 * @returns 成功返回 `{ ok: true, graph }`，失败返回 `{ ok: false, error }`
 */
export async function loadGraphFromDisk(
  filePath: string,
): Promise<{ ok: true; graph: NodeGraph } | { ok: false; error: string }> {
  try {
    const bridge = getBridge();
    const readRes = await bridge.load(filePath);
    if (!readRes.ok) {
      return { ok: false, error: readRes.error };
    }
    // 反序列化（safeDeserializeGraph 不抛错，失败时返回 { ok: false, error }）
    const deser = safeDeserializeGraph(readRes.json);
    if (!deser.ok) {
      return { ok: false, error: deser.error };
    }
    return { ok: true, graph: deser.graph };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// === 最近列表（localStorage）===

/**
 * 读取最近打开的节点图列表。
 *
 * 从 localStorage 读取，返回最多 10 条，按最近优先排序（数组头部为最新）。
 * localStorage 不可用 / 数据损坏时返回空数组，不抛错。
 *
 * @returns 最近打开条目数组
 */
export async function listRecentGraphs(): Promise<RecentGraphEntry[]> {
  return readRecentSync();
}

/**
 * 添加/更新一条最近打开记录。
 *
 * 行为：
 * - 若 filePath 已存在：移除旧记录，将新记录插入头部（LRU 上移）
 * - 若 filePath 不存在：在头部插入新记录
 * - 列表长度超过 MAX_RECENT (10) 时截断尾部
 * - localStorage 不可用时静默降级（不抛错）
 *
 * @param filePath 文件绝对路径
 * @param modId 来源 mod id（可能为空字符串）
 * @param nodeCount 节点数量（可选，默认 0 表示未知）
 */
export function addRecentGraph(filePath: string, modId: string, nodeCount = 0): void {
  try {
    const current = readRecentSync();
    // 去重：移除同路径旧记录
    const filtered = current.filter((e) => e.filePath !== filePath);
    // 头部插入新记录
    filtered.unshift({
      filePath,
      modId,
      savedAt: new Date().toISOString(),
      nodeCount,
    });
    // LRU 截断
    const next = filtered.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式 / 配额满 / 序列化失败）时静默降级
  }
}

/**
 * 同步读取最近列表（供 addRecentGraph 内部使用，避免 async 调用链）。
 *
 * 校验链：
 * - localStorage.getItem 返回 null → 空数组
 * - JSON.parse 失败 → 空数组
 * - 解析结果非数组 → 空数组
 * - 单条记录字段缺失/类型错 → 跳过该条
 */
function readRecentSync(): RecentGraphEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentGraphEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      if (typeof e.filePath !== 'string' || e.filePath === '') continue;
      if (typeof e.modId !== 'string') continue;
      if (typeof e.savedAt !== 'string') continue;
      if (typeof e.nodeCount !== 'number' || !Number.isFinite(e.nodeCount)) continue;
      out.push({
        filePath: e.filePath,
        modId: e.modId,
        savedAt: e.savedAt,
        nodeCount: e.nodeCount,
      });
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 清空最近打开列表（仅供测试与用户「清空历史」按钮使用）。
 * localStorage 不可用时静默降级。
 */
export function clearRecentGraphs(): void {
  try {
    localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    // 静默降级
  }
}

/**
 * 从最近列表移除指定路径的单条记录（不删除磁盘文件）。
 *
 * 用于用户在 UI 上点击某条最近记录的「移除」按钮。
 * 与 clearRecentGraphs 的区别：仅移除一条，保留其他记录。
 *
 * 行为：
 * - 读取当前列表，过滤掉 filePath 匹配的条目，写回 localStorage
 * - 不存在该路径时静默成功（幂等）
 * - localStorage 不可用时静默降级（不抛错）
 *
 * @param filePath 要移除的文件绝对路径
 */
export function removeRecentGraph(filePath: string): void {
  try {
    const current = readRecentSync();
    const next = current.filter((e) => e.filePath !== filePath);
    // 没有变化时不写文件，减少 IO
    if (next.length === current.length) return;
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时静默降级
  }
}
