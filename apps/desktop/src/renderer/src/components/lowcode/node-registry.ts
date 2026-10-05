import { z } from 'zod';
import type { FileNode, NodeGraph, NodePort } from '@mc-creator/shared';
import { FileNode as FileNodeSchema, NodePort as NodePortSchema } from '@mc-creator/shared';
import { customNodeRegistry } from '../../domain/customNodeRegistry.js';

/**
 * 低代码插件节点注册表（开放给插件系统）。
 *
 * 与 `domain/customNodeRegistry`（JSON schema 驱动的 Mustache 自定义节点）的区别：
 * - 本注册表面向 **代码插件**：插件用 JS 定义节点并提供 `toSpec` 纯函数，
 *   编译时直接产出 `FileNode[]`，走 `applyGeneratedFiles` 合并逻辑落盘。
 * - 为复用现有画布/编译链路，注册成功后会自动向 `customNodeRegistry`
 *   桥接一条同 `typeId` 的合成 schema（端口 = inputs + outputs），
 *   使节点能以 `subgraph + customTypeId` 形态被画布渲染、拖拽、序列化。
 *   插件文件产物由 `compilePluginFiles` 收集；合成 schema 的 `codeTemplate`
 *   仅作占位（`compileCustomNode` 会产出一条 marker snippet，不影响文件产物）。
 *
 * 安全约定：
 * - `toSpec` 必须是纯函数：仅依赖传入的 `ctx`（nodeId/label/fields/graphModId），
 *   不得访问 `node:fs` / `process` / `require` 等 Node 能力。
 * - 插件 JS 在渲染进程沙箱中求值（见 `plugin-node-loader.ts`），仅暴露
 *   `registerNode` + `mcApi` 白名单 + 受限 `console`。
 */

// === 类型 ===

/** 插件 `toSpec` 的调用上下文（纯数据，可序列化）。 */
export interface PluginNodeContext {
  /** 图中节点实例 id（`ModNode.id`） */
  nodeId: string;
  /** 节点显示名（`data.label`） */
  label: string;
  /** 节点字段值（`SubgraphNodeData.customFields`） */
  fields: Record<string, unknown>;
  /** 所属图的 `modId`（用于拼资源命名空间） */
  graphModId: string;
}

/** 插件节点编译函数：纯函数，返回要写入项目的文件列表（支持异步）。 */
export type PluginToSpecFn = (ctx: PluginNodeContext) => FileNode[] | Promise<FileNode[]>;

const PluginToSpecSchema = z.custom<PluginToSpecFn>((v) => typeof v === 'function', {
  message: 'toSpec 必须是函数',
});

/**
 * 插件节点定义。
 *
 * - `id`：全局唯一（如 `myplugin:hello_block`），同时用作画布 `customTypeId`。
 * - `title`：面板显示名。
 * - `category`：分组名（内置分组见 `nodes/NODE_CATEGORIES`；插件可自定义新分组）。
 * - `inputs` / `outputs`：端口定义（复用 `NodePort`）。
 * - `toSpec`：纯函数，产出 `FileNode[]`。
 */
export const PluginNodeDefSchema = z.object({
  id: z
    .string()
    .min(1, 'id 不能为空')
    .max(128)
    .regex(/^[A-Za-z0-9_:\-.]+$/, 'id 仅允许字母/数字/_/:/-/.'),
  title: z.string().min(1, 'title 不能为空').max(64),
  category: z.string().min(1, 'category 不能为空').max(32),
  description: z.string().default(''),
  inputs: z.array(NodePortSchema).default([]),
  outputs: z.array(NodePortSchema).default([]),
  toSpec: PluginToSpecSchema,
});

export type PluginNodeDef = z.infer<typeof PluginNodeDefSchema>;

// === 注册表 ===

const registry = new Map<string, PluginNodeDef>();
/** 已向 customNodeRegistry 桥接的 id（unregister 时一并清理）。 */
const bridgedIds = new Set<string>();

type PluginNodesListener = () => void;
const listeners = new Set<PluginNodesListener>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* 监听器异常不影响注册表 */
    }
  }
}

/** 订阅注册表变更（供 NodePalette 等 UI 刷新），返回取消订阅函数。 */
export function subscribePluginNodes(listener: PluginNodesListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 注册插件节点（Zod 校验 + 桥接 customNodeRegistry）。
 *
 * 同 `id` 重复注册时覆盖旧定义（便于插件热重载）。
 *
 * @throws ZodError 当定义校验失败时
 */
export function registerNode(def: unknown): PluginNodeDef {
  const parsed = PluginNodeDefSchema.parse(def);
  registry.set(parsed.id, parsed);
  bridgeToCustomRegistry(parsed);
  notify();
  return parsed;
}

/**
 * 注销插件节点。
 *
 * @returns true=曾存在并已移除，false=id 不存在
 */
export function unregisterNode(id: string): boolean {
  const existed = registry.delete(id);
  if (bridgedIds.has(id)) {
    bridgedIds.delete(id);
    customNodeRegistry.unregister(id);
  }
  if (existed) notify();
  return existed;
}

/** 按 id 获取插件节点定义，未注册返回 undefined。 */
export function getNode(id: string): PluginNodeDef | undefined {
  return registry.get(id);
}

/** 列出插件节点，可按 category 过滤（无参数时返回全部，按 id 排序）。 */
export function listNodes(category?: string): PluginNodeDef[] {
  const all = [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (category === undefined || category === '') return all;
  return all.filter((d) => d.category === category);
}

/** 是否为代码插件注册的节点（用于与 JSON 导入的自定义节点区分展示）。 */
export function isPluginNode(id: string): boolean {
  return registry.has(id);
}

/** 列出已注册的分组名（排序后返回，供面板分组）。 */
export function listPluginCategories(): string[] {
  const set = new Set<string>();
  for (const d of registry.values()) set.add(d.category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** 清空注册表（主要供测试使用）。 */
export function clearPluginNodes(): void {
  registry.clear();
  for (const id of bridgedIds) {
    customNodeRegistry.unregister(id);
  }
  bridgedIds.clear();
  notify();
}

// === customNodeRegistry 桥接 ===

/**
 * 向 customNodeRegistry 桥接合成 schema，使插件节点可复用现有链路：
 * 画布渲染（CustomNodeContent）、拖拽创建（addCustomNode）、序列化（subgraph+customTypeId）。
 *
 * 若 `customTypeId` 已被用户导入的 JSON schema 占用，则不覆盖（保留用户版本），
 * 插件文件产物仍由 `compilePluginFiles` 按本注册表收集。
 */
function bridgeToCustomRegistry(def: PluginNodeDef): void {
  if (customNodeRegistry.has(def.id)) return;
  const ports: NodePort[] = [...def.inputs, ...def.outputs];
  customNodeRegistry.register({
    typeId: def.id,
    label: def.title,
    description: def.description,
    icon: 'puzzle',
    color: 'mc-code',
    ports,
    fields: [],
    codeTemplate: `// plugin node ${def.id}: files via toSpec`,
  });
  bridgedIds.add(def.id);
}

// === 编译 ===

export interface PluginCompileResult {
  /** 插件 `toSpec` 产出的文件（已做 FileNode 校验 + 同 path 去重，后者胜）。 */
  files: FileNode[];
  warnings: string[];
  errors: string[];
}

/**
 * 遍历图中引用本注册表的节点（`subgraph + customTypeId`），调用各自 `toSpec` 生成文件。
 *
 * - 主图 + 各子图内部节点都会被遍历。
 * - 未在本注册表的 `customTypeId` 会被跳过（留给 `compileCustomNode` 按 JSON schema 路径处理）。
 * - `toSpec` 抛错或返回非法 `FileNode` 时记为 error，不中断其他节点。
 */
export async function compilePluginFiles(graph: NodeGraph): Promise<PluginCompileResult> {
  const files: FileNode[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const seenPaths = new Map<string, string>();

  const allNodes = [
    ...graph.nodes,
    ...Object.values(graph.subgraphs ?? {}).flatMap((sg) => sg.nodes),
  ];

  for (const node of allNodes) {
    if (node.data.kind !== 'subgraph') continue;
    const typeId = node.data.customTypeId;
    if (typeof typeId !== 'string' || typeId === '') continue;
    const def = registry.get(typeId);
    if (!def) continue;

    const ctx: PluginNodeContext = {
      nodeId: node.id,
      label: node.data.label,
      fields: { ...(node.data.customFields ?? {}) },
      graphModId: graph.modId,
    };

    let produced: FileNode[];
    try {
      produced = await def.toSpec(ctx);
    } catch (e) {
      errors.push(`插件节点 ${node.id}（${typeId}）toSpec 执行失败：${(e as Error).message}`);
      continue;
    }

    if (!Array.isArray(produced)) {
      errors.push(`插件节点 ${node.id}（${typeId}）toSpec 未返回数组`);
      continue;
    }

    for (const f of produced) {
      const parsed = FileNodeSchema.safeParse(f);
      if (!parsed.success) {
        errors.push(`插件节点 ${node.id}（${typeId}）产出非法文件：${parsed.error.message}`);
        continue;
      }
      const prev = seenPaths.get(parsed.data.path);
      if (prev !== undefined && prev !== parsed.data.content) {
        warnings.push(`插件产物路径冲突 ${parsed.data.path}：后产出的文件覆盖先产出者`);
      }
      seenPaths.set(parsed.data.path, parsed.data.content);
    }
  }

  for (const [path, content] of seenPaths) {
    files.push({ path, content });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, warnings, errors };
}
