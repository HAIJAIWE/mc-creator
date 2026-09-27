/**
 * 画布网格吸附
 *
 * 画布背景点阵间距 24px（NodeGraphEditor 的 Background gap），
 * dagre 自动排版也按该网格对齐。新节点落盘、节点拖拽结束统一吸附，
 * 保证存量坐标永远落在网格上。
 */

export interface XyPosition {
  x: number;
  y: number;
}

/** 网格间距（px），与画布 Background gap 保持一致 */
export const CANVAS_GRID_SIZE = 24;

/** 单值吸附到网格（负数/小数正确处理） */
export function snapValue(value: number, grid: number = CANVAS_GRID_SIZE): number {
  if (!Number.isFinite(value) || !Number.isFinite(grid) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** 坐标吸附到网格（返回新对象，不改输入） */
export function snapPosition<T extends XyPosition>(pos: T, grid: number = CANVAS_GRID_SIZE): T {
  return { ...pos, x: snapValue(pos.x, grid), y: snapValue(pos.y, grid) };
}

/** 坐标是否已在网格上（容差处理浮点误差） */
export function isSnapped(pos: XyPosition, grid: number = CANVAS_GRID_SIZE): boolean {
  const eps = 1e-6;
  return (
    Math.abs(pos.x - snapValue(pos.x, grid)) < eps && Math.abs(pos.y - snapValue(pos.y, grid)) < eps
  );
}

/** ReactFlow position 变化的最小形状（只取决策需要的字段） */
export interface DragPositionChange {
  type: string;
  position?: XyPosition;
  dragging?: boolean;
}

/**
 * 拖拽结束吸附决策（NodeGraphEditor.onNodesChange 用）。
 * 仅当 position 变化且拖拽结束（dragging === false）时返回吸附后坐标，
 * 其余情况返回 null（调用方按原值处理：拖拽中透传，删除/选中不处理）。
 */
export function snapDragEndPosition(
  change: DragPositionChange,
  grid: number = CANVAS_GRID_SIZE,
): XyPosition | null {
  if (change.type !== 'position' || !change.position) return null;
  if (change.dragging !== false) return null;
  return snapPosition(change.position, grid);
}
