// @vitest-environment jsdom

/**
 * 节点图持久化纯函数层测试
 *
 * 测试策略：
 * - 用 vi.stubGlobal 模拟 window.api.nodeGraph，不依赖真实 IPC / Electron / fs
 * - 用 spy 监听 localStorage.getItem/setItem/removeItem，验证最近列表行为
 * - 覆盖 saveGraphToDisk / loadGraphFromDisk / listRecentGraphs / addRecentGraph 的成功与失败路径
 * - 覆盖 localStorage 不可用时的降级（不抛错）
 * - 覆盖最近列表的 LRU 去重、截断、字段校验
 *
 * mock 策略：
 * - window.api.nodeGraph 由 beforeEach 重新注入，避免测试间互相污染
 * - localStorage 由 polyfill 提供（当前 vitest+jsdom 配置未带 url 选项，
 *   原生 localStorage 不可用），每个用例前 clear
 */

// === localStorage polyfill ===
// 当前 vitest 配置 environment: 'node' + 文件级 jsdom pragma，但 jsdom 未配置 url
// 选项导致 localStorage 不存在。这里安装一个符合 Storage 接口的内存实现，
// 让 nodeGraphPersistence.ts 中的 bare `localStorage` 引用能正常工作。
// 生产环境（Electron renderer）有原生 localStorage，polyfill 仅用于测试。
class LocalStoragePolyfill {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    if (index < 0 || index >= this.store.size) return null;
    let i = 0;
    for (const k of this.store.keys()) {
      if (i === index) return k;
      i++;
    }
    return null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

// 安装 polyfill 到 globalThis（bare localStorage 引用会解析到这里）
if (!globalThis.localStorage) {
  (globalThis as { localStorage: Storage }).localStorage =
    new LocalStoragePolyfill() as unknown as Storage;
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveGraphToDisk,
  loadGraphFromDisk,
  listRecentGraphs,
  addRecentGraph,
  clearRecentGraphs,
  type RecentGraphEntry,
} from './nodeGraphPersistence.js';
import { serializeGraph } from './nodeGraphSerializer.js';
import type { NodeGraph, ModNode, ModEdge, NodeData, NodeKind, NodePort } from '@mc-creator/shared';
import { LATEST_FORMAT_VERSION } from '@mc-creator/shared';

// === 测试辅助：构造合法 NodeGraph ===

function createDefaultNodeData(kind: NodeKind): NodeData {
  // P1-1：复刻 store 的 base 字段（含 collapsed/codeLocked/formatVersion），
  // 保证 round-trip 测试 original 与反序列化后的 graph 字段一致
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
    codeLocked: false,
    formatVersion: LATEST_FORMAT_VERSION,
  };
  switch (kind) {
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: 'new_item',
        displayName: '新物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      } as NodeData;
    case 'block':
      return {
        ...base,
        kind: 'block',
        blockId: 'new_block',
        displayName: '新方块',
        hardness: 1.0,
        blastResistance: 3.0,
        luminance: 0,
        transparent: false,
        solid: true,
        modelType: 'cube_all',
        isBlockEntity: false,
      } as NodeData;
    case 'event':
      return {
        ...base,
        kind: 'event',
        eventType: 'player_right_click_block',
        eventArgs: '{}',
      } as NodeData;
    case 'comment':
      return { ...base, kind: 'comment', text: '备注', color: 'yellow' } as NodeData;
    default:
      // 测试只用到 item/block/event/comment，其余 kind 不构造（避免大段重复代码）
      return { ...base, kind: 'comment', text: '', color: 'yellow' } as NodeData;
  }
}

function createDefaultPorts(_kind: NodeKind): NodePort[] {
  return [];
}

function makeNode(id: string, kind: NodeKind): ModNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: createDefaultNodeData(kind),
    ports: createDefaultPorts(kind),
    selected: false,
  };
}

function _makeEdge(id: string, source: string, target: string): ModEdge {
  return { id, source, target, kind: 'craft', disabled: false };
}

function makeGraph(modId = 'test_mod', nodes: ModNode[] = [], edges: ModEdge[] = []): NodeGraph {
  return {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };
}

// === mock window.api.nodeGraph ===

interface MockNodeGraphBridge {
  save: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  showSaveDialog: ReturnType<typeof vi.fn>;
  showOpenDialog: ReturnType<typeof vi.fn>;
}

let mockBridge: MockNodeGraphBridge;

function setupMockApi(bridge: MockNodeGraphBridge): void {
  // 与 preload 暴露的 window.api.nodeGraph 命名空间对齐
  (window as unknown as { api: { nodeGraph: MockNodeGraphBridge } }).api = {
    nodeGraph: bridge,
  };
}

beforeEach(() => {
  mockBridge = {
    save: vi.fn(),
    load: vi.fn(),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  };
  setupMockApi(mockBridge);
  // 清空 localStorage（jsdom 提供）
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  // 清理 window.api，避免测试间污染
  delete (window as unknown as { api?: unknown }).api;
});

// === saveGraphToDisk ===

describe('saveGraphToDisk', () => {
  it('1. 成功保存（传 filePath）：序列化 → 写盘 → 加入最近列表', async () => {
    const graph = makeGraph('my_mod', [makeNode('n1', 'item')]);
    mockBridge.save.mockResolvedValue({ ok: true });

    const res = await saveGraphToDisk(graph, '/path/to/my_mod-node-graph.json');

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.path).toBe('/path/to/my_mod-node-graph.json');
    // 调用了 bridge.save，参数为路径 + 序列化后的 JSON
    expect(mockBridge.save).toHaveBeenCalledTimes(1);
    const [savePath, saveJson] = mockBridge.save.mock.calls[0];
    expect(savePath).toBe('/path/to/my_mod-node-graph.json');
    // saveJson 应为 serializeGraph 的输出（含 format/version/graph）
    // 注意：exportedAt 含毫秒时间戳，两次调用可能差 1ms，故解析后比较结构
    const parsed = JSON.parse(saveJson) as {
      format: string;
      version: number;
      graph: NodeGraph;
    };
    expect(parsed.format).toBe('mc-creator-node-graph');
    expect(parsed.version).toBe(1);
    expect(parsed.graph).toEqual(graph);
    // 应写入最近列表
    const recent = await listRecentGraphs();
    expect(recent).toHaveLength(1);
    expect(recent[0].filePath).toBe('/path/to/my_mod-node-graph.json');
    expect(recent[0].modId).toBe('my_mod');
    expect(recent[0].nodeCount).toBe(1);
  });

  it('2. 成功保存（不传 filePath）：弹保存对话框 → 写盘', async () => {
    const graph = makeGraph('my_mod', [makeNode('n1', 'item'), makeNode('n2', 'block')]);
    mockBridge.showSaveDialog.mockResolvedValue({
      ok: true,
      filePath: '/users/me/graph.json',
    });
    mockBridge.save.mockResolvedValue({ ok: true });

    const res = await saveGraphToDisk(graph);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.path).toBe('/users/me/graph.json');
    // showSaveDialog 默认文件名应为 `${modId}-node-graph.json`
    expect(mockBridge.showSaveDialog).toHaveBeenCalledWith('my_mod-node-graph.json');
    // save 用对话框返回的路径，第二个参数为序列化 JSON（exportedAt 含毫秒，解析后比较）
    const saveCallArgs = mockBridge.save.mock.calls[0];
    expect(saveCallArgs[0]).toBe('/users/me/graph.json');
    const parsed = JSON.parse(saveCallArgs[1]) as { format: string; graph: NodeGraph };
    expect(parsed.format).toBe('mc-creator-node-graph');
    expect(parsed.graph).toEqual(graph);
  });

  it('3. 用户取消保存对话框：返回 { ok: false, error: "canceled" }，不写盘', async () => {
    const graph = makeGraph('my_mod');
    mockBridge.showSaveDialog.mockResolvedValue({ ok: false });

    const res = await saveGraphToDisk(graph);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('canceled');
    // 未调用 save
    expect(mockBridge.save).not.toHaveBeenCalled();
    // 最近列表也不应更新
    const recent = await listRecentGraphs();
    expect(recent).toEqual([]);
  });

  it('4. 写盘失败（IO 错误）：返回 { ok: false, error }', async () => {
    const graph = makeGraph('my_mod');
    mockBridge.save.mockResolvedValue({ ok: false, error: 'EACCES: permission denied' });

    const res = await saveGraphToDisk(graph, '/readonly/graph.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('EACCES: permission denied');
    // 写盘失败时不应加入最近列表
    const recent = await listRecentGraphs();
    expect(recent).toEqual([]);
  });

  it('5. modId 为空时默认文件名为 node-graph.json', async () => {
    const graph = makeGraph('', [makeNode('n1', 'item')]);
    mockBridge.showSaveDialog.mockResolvedValue({ ok: true, filePath: '/tmp/x.json' });
    mockBridge.save.mockResolvedValue({ ok: true });

    await saveGraphToDisk(graph);

    expect(mockBridge.showSaveDialog).toHaveBeenCalledWith('node-graph.json');
  });

  it('6. bridge.save 抛异常时被捕获，返回 { ok: false, error }', async () => {
    const graph = makeGraph('my_mod');
    mockBridge.save.mockRejectedValue(new Error('IPC 通道断开'));

    const res = await saveGraphToDisk(graph, '/tmp/x.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('IPC 通道断开');
  });

  it('7. window.api 未注入时返回 { ok: false, error }（不抛错）', async () => {
    delete (window as unknown as { api?: unknown }).api;
    const graph = makeGraph('my_mod');

    const res = await saveGraphToDisk(graph, '/tmp/x.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('window.api.nodeGraph');
  });

  it('8. 保存成功后最近列表 nodeCount 反映实际节点数', async () => {
    const graph = makeGraph('mod_x', [
      makeNode('n1', 'item'),
      makeNode('n2', 'block'),
      makeNode('n3', 'event'),
    ]);
    mockBridge.save.mockResolvedValue({ ok: true });

    await saveGraphToDisk(graph, '/p/x.json');

    const recent = await listRecentGraphs();
    expect(recent[0].nodeCount).toBe(3);
  });
});

// === loadGraphFromDisk ===

describe('loadGraphFromDisk', () => {
  it('9. 成功加载：读盘 → 反序列化为 NodeGraph', async () => {
    const original = makeGraph('loaded_mod', [makeNode('n1', 'item')]);
    const json = serializeGraph(original);
    mockBridge.load.mockResolvedValue({ ok: true, json });

    const res = await loadGraphFromDisk('/path/to/graph.json');

    expect(mockBridge.load).toHaveBeenCalledWith('/path/to/graph.json');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.graph).toEqual(original);
      expect(res.graph.modId).toBe('loaded_mod');
      expect(res.graph.nodes).toHaveLength(1);
    }
  });

  it('10. 文件不存在（读盘失败）：返回 { ok: false, error }', async () => {
    mockBridge.load.mockResolvedValue({ ok: false, error: 'ENOENT: no such file' });

    const res = await loadGraphFromDisk('/missing/graph.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('ENOENT: no such file');
  });

  it('11. JSON 损坏（反序列化失败）：返回 { ok: false, error }', async () => {
    mockBridge.load.mockResolvedValue({ ok: true, json: 'not-a-valid-json{{{}}}' });

    const res = await loadGraphFromDisk('/bad/graph.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('反序列化失败');
  });

  it('12. JSON 合法但 format 字段错误：返回 { ok: false, error }', async () => {
    // 合法 JSON 但缺少 format/version/graph 字段
    mockBridge.load.mockResolvedValue({ ok: true, json: JSON.stringify({ foo: 'bar' }) });

    const res = await loadGraphFromDisk('/wrong-format/graph.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('format');
  });

  it('13. bridge.load 抛异常时被捕获，返回 { ok: false, error }', async () => {
    mockBridge.load.mockRejectedValue(new Error('IPC 超时'));

    const res = await loadGraphFromDisk('/path/graph.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('IPC 超时');
  });

  it('14. window.api 未注入时返回 { ok: false, error }（不抛错）', async () => {
    delete (window as unknown as { api?: unknown }).api;

    const res = await loadGraphFromDisk('/path/graph.json');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('window.api.nodeGraph');
  });
});

// === listRecentGraphs ===

describe('listRecentGraphs', () => {
  it('15. localStorage 为空时返回空数组', async () => {
    const res = await listRecentGraphs();
    expect(res).toEqual([]);
  });

  it('16. localStorage 有 3 条时返回 3 条（按最近优先）', async () => {
    const entries: RecentGraphEntry[] = [
      { filePath: '/a.json', modId: 'a', savedAt: '2026-07-21T00:00:00.000Z', nodeCount: 1 },
      { filePath: '/b.json', modId: 'b', savedAt: '2026-07-20T00:00:00.000Z', nodeCount: 2 },
      { filePath: '/c.json', modId: 'c', savedAt: '2026-07-19T00:00:00.000Z', nodeCount: 3 },
    ];
    localStorage.setItem('mc-creator:recent-node-graphs', JSON.stringify(entries));

    const res = await listRecentGraphs();

    expect(res).toHaveLength(3);
    expect(res[0].filePath).toBe('/a.json');
    expect(res[2].filePath).toBe('/c.json');
  });

  it('17. localStorage 超过 10 条时截断到 10 条', async () => {
    const entries: RecentGraphEntry[] = Array.from({ length: 15 }, (_, i) => ({
      filePath: `/file-${i}.json`,
      modId: `mod_${i}`,
      savedAt: `2026-07-${String(20 - i).padStart(2, '0')}T00:00:00.000Z`,
      nodeCount: i,
    }));
    localStorage.setItem('mc-creator:recent-node-graphs', JSON.stringify(entries));

    const res = await listRecentGraphs();

    expect(res).toHaveLength(10);
    // 应保留前 10 条（readRecentSync 在长度达到 MAX_RECENT 时 break）
    expect(res[0].filePath).toBe('/file-0.json');
    expect(res[9].filePath).toBe('/file-9.json');
  });

  it('18. localStorage 损坏（非 JSON）时返回空数组', async () => {
    localStorage.setItem('mc-creator:recent-node-graphs', 'not-valid-json{{{');

    const res = await listRecentGraphs();

    expect(res).toEqual([]);
  });

  it('19. localStorage 是合法 JSON 但非数组时返回空数组', async () => {
    localStorage.setItem('mc-creator:recent-node-graphs', JSON.stringify({ not: 'array' }));

    const res = await listRecentGraphs();

    expect(res).toEqual([]);
  });

  it('20. 条目字段缺失（无 filePath）时跳过该条', async () => {
    const raw = [
      { filePath: '/a.json', modId: 'a', savedAt: '2026-07-21T00:00:00.000Z', nodeCount: 1 },
      { modId: 'b', savedAt: '2026-07-21T00:00:00.000Z', nodeCount: 1 }, // 缺 filePath
      { filePath: '/c.json', modId: 'c', savedAt: '2026-07-21T00:00:00.000Z', nodeCount: 1 },
    ];
    localStorage.setItem('mc-creator:recent-node-graphs', JSON.stringify(raw));

    const res = await listRecentGraphs();

    expect(res).toHaveLength(2);
    expect(res.map((e) => e.filePath)).toEqual(['/a.json', '/c.json']);
  });

  it('21. 条目 nodeCount 类型错（字符串）时跳过该条', async () => {
    const raw = [
      { filePath: '/a.json', modId: 'a', savedAt: '2026-07-21T00:00:00.000Z', nodeCount: 'bad' },
      { filePath: '/b.json', modId: 'b', savedAt: '2026-07-21T00:00:00.000Z', nodeCount: 2 },
    ];
    localStorage.setItem('mc-creator:recent-node-graphs', JSON.stringify(raw));

    const res = await listRecentGraphs();

    expect(res).toHaveLength(1);
    expect(res[0].filePath).toBe('/b.json');
  });
});

// === addRecentGraph ===

describe('addRecentGraph', () => {
  it('22. 新增条目：插入到列表头部', async () => {
    addRecentGraph('/a.json', 'mod_a', 1);

    const recent = await listRecentGraphs();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      filePath: '/a.json',
      modId: 'mod_a',
      nodeCount: 1,
    });
    // savedAt 应为合法 ISO 时间
    expect(new Date(recent[0].savedAt).getTime()).not.toBeNaN();
  });

  it('23. 重复路径：上移到头部并更新 savedAt（LRU 去重）', async () => {
    addRecentGraph('/a.json', 'mod_a', 1);
    // 等 1ms 确保 savedAt 不同（ISO 时间戳精度到 ms）
    await new Promise((r) => setTimeout(r, 2));
    addRecentGraph('/b.json', 'mod_b', 2);
    await new Promise((r) => setTimeout(r, 2));
    // 再次添加 /a.json，应上移到头部
    addRecentGraph('/a.json', 'mod_a_v2', 3);

    const recent = await listRecentGraphs();
    expect(recent).toHaveLength(2);
    // /a.json 应在头部
    expect(recent[0].filePath).toBe('/a.json');
    expect(recent[0].modId).toBe('mod_a_v2');
    expect(recent[0].nodeCount).toBe(3);
    // /b.json 应在第二位
    expect(recent[1].filePath).toBe('/b.json');
  });

  it('24. 超过 10 条时截断尾部（仅保留最近 10 条）', async () => {
    for (let i = 0; i < 15; i++) {
      addRecentGraph(`/file-${i}.json`, `mod_${i}`, i);
    }

    const recent = await listRecentGraphs();
    expect(recent).toHaveLength(10);
    // 最后添加的 file-14 应在头部
    expect(recent[0].filePath).toBe('/file-14.json');
    // 第 10 条应为 file-5（file-14 到 file-5 共 10 条）
    expect(recent[9].filePath).toBe('/file-5.json');
  });

  it('25. nodeCount 默认为 0（未传第三个参数）', async () => {
    addRecentGraph('/a.json', 'mod_a');

    const recent = await listRecentGraphs();
    expect(recent[0].nodeCount).toBe(0);
  });

  it('26. localStorage 不可用时静默降级（不抛错）', () => {
    // 模拟 localStorage.setItem 抛错（隐私模式 / 配额满）
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => addRecentGraph('/a.json', 'mod_a', 1)).not.toThrow();

    spy.mockRestore();
  });

  it('27. clearRecentGraphs 清空最近列表', async () => {
    addRecentGraph('/a.json', 'mod_a', 1);
    addRecentGraph('/b.json', 'mod_b', 2);
    expect(await listRecentGraphs()).toHaveLength(2);

    clearRecentGraphs();

    expect(await listRecentGraphs()).toEqual([]);
  });
});

// === RecentGraphEntry 形状 ===

describe('RecentGraphEntry 接口形状', () => {
  it('28. 包含 filePath / modId / savedAt / nodeCount 四字段', async () => {
    addRecentGraph('/path/graph.json', 'my_mod', 5);

    const recent = await listRecentGraphs();
    const entry = recent[0];
    expect(entry).toHaveProperty('filePath', '/path/graph.json');
    expect(entry).toHaveProperty('modId', 'my_mod');
    expect(entry).toHaveProperty('savedAt');
    expect(typeof entry.savedAt).toBe('string');
    expect(entry).toHaveProperty('nodeCount', 5);
  });

  it('29. savedAt 是合法 ISO 8601 时间字符串', async () => {
    addRecentGraph('/a.json', 'mod_a', 1);

    const recent = await listRecentGraphs();
    const savedAt = recent[0].savedAt;
    // ISO 8601 格式：YYYY-MM-DDTHH:mm:ss.sssZ
    expect(savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    // Date 能解析
    expect(new Date(savedAt).getTime()).not.toBeNaN();
  });
});
