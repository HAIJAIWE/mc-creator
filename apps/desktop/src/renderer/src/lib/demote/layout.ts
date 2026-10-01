import type { ModNode } from '@mc-creator/shared';

/** 各类节点的 Y 轴基线（按 kind 分行排列，避免节点重叠） */
const Y_BY_KIND: Record<string, number> = {
  item: 100,
  block: 300,
  entity: 500,
  recipe: 700,
  event: 900,
  code: 1100,
};

/** 节点 X 轴起点与间距 */
const X_START = 200;
const X_STEP = 250;

// === 节点位置布局 ===

/**
 * 按 kind 分行排列节点：
 * - items 在 y=100，blocks 在 y=300，entities 在 y=500，recipes 在 y=700，events 在 y=900，code 在 y=1100
 * - 每行内节点按提取顺序 x=200+index*250
 *
 * 注意：此为按 kind 分行的内部布局算法，会就地修改节点 position。
 * 对外暴露的 spec-compliant 版本为 `layoutNodes`（见下方），采用网格布局（x+=260，每 5 个节点 y+=180）。
 */
export function applyLayoutByKind(nodes: ModNode[]): void {
  // 按 kind 分桶（保持插入顺序）
  const buckets = new Map<string, ModNode[]>();
  for (const node of nodes) {
    const kind = node.data.kind;
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind)!.push(node);
  }
  // 给每个桶分配位置
  for (const [kind, group] of buckets) {
    const y = Y_BY_KIND[kind] ?? 1300; // 未知 kind 放在更下方
    group.forEach((node, idx) => {
      node.position = { x: X_START + idx * X_STEP, y };
    });
  }
}

/**
 * 网格布局（spec: x+=260，每 5 个节点 y+=180）。
 *
 * 节点按提取顺序排列：
 *   - 第 0 个节点：(0, 0)
 *   - 第 1 个节点：(260, 0)  — x += 260
 *   - ...
 *   - 第 4 个节点：(1040, 0)
 *   - 第 5 个节点：(0, 180)  — y += 180，x 重置
 *   - 第 6 个节点：(260, 180)
 *   - ...
 *
 * @param nodes 节点列表
 * @returns 位置数组（与节点列表一一对应）
 */
export function layoutNodes(nodes: ModNode[]): Array<{ x: number; y: number }> {
  const X_STEP = 260;
  const Y_STEP = 180;
  const COLS = 5;
  const X_START = 0;
  const Y_START = 0;

  return nodes.map((_, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    return {
      x: X_START + col * X_STEP,
      y: Y_START + row * Y_STEP,
    };
  });
}
