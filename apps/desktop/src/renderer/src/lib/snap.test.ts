// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  CANVAS_GRID_SIZE,
  snapValue,
  snapPosition,
  isSnapped,
  snapDragEndPosition,
} from './snap.js';

describe('画布网格吸附', () => {
  it('网格间距为 24（与画布点阵一致）', () => {
    expect(CANVAS_GRID_SIZE).toBe(24);
  });

  it('snapValue 四舍五入到网格', () => {
    expect(snapValue(0)).toBe(0);
    expect(snapValue(10)).toBe(0);
    expect(snapValue(12)).toBe(24);
    expect(snapValue(13)).toBe(24);
    expect(snapValue(36)).toBe(48);
    expect(snapValue(100)).toBe(96);
  });

  it('snapValue 处理负数与小数', () => {
    expect(snapValue(-10)).toBe(-0);
    expect(snapValue(-13)).toBe(-24);
    expect(snapValue(12.7)).toBe(24);
  });

  it('snapValue 支持自定义网格', () => {
    expect(snapValue(10, 8)).toBe(8);
    expect(snapValue(10, 16)).toBe(16);
  });

  it('snapValue 非法输入原样返回', () => {
    expect(snapValue(NaN)).toBeNaN();
    expect(snapValue(Infinity)).toBe(Infinity);
    expect(snapValue(10, 0)).toBe(10);
    expect(snapValue(10, -8)).toBe(10);
  });

  it('snapPosition 返回新对象（不改输入）', () => {
    const src = { x: 10, y: 50 };
    const out = snapPosition(src);
    expect(out).toEqual({ x: 0, y: 48 });
    expect(src).toEqual({ x: 10, y: 50 });
    expect(out).not.toBe(src);
  });

  it('isSnapped 判定网格对齐（含浮点容差）', () => {
    expect(isSnapped({ x: 0, y: 24 })).toBe(true);
    expect(isSnapped({ x: 10, y: 24 })).toBe(false);
    expect(isSnapped({ x: 24.0000001, y: 48 })).toBe(true);
  });
});

describe('拖拽结束吸附决策', () => {
  it('拖拽结束（dragging=false）返回吸附坐标', () => {
    expect(
      snapDragEndPosition({ type: 'position', position: { x: 10, y: 50 }, dragging: false }),
    ).toEqual({
      x: 0,
      y: 48,
    });
  });

  it('拖拽中（dragging=true/undefined）返回 null（透传原值）', () => {
    expect(
      snapDragEndPosition({ type: 'position', position: { x: 10, y: 50 }, dragging: true }),
    ).toBeNull();
    expect(snapDragEndPosition({ type: 'position', position: { x: 10, y: 50 } })).toBeNull();
  });

  it('非 position 变化或无坐标返回 null', () => {
    expect(snapDragEndPosition({ type: 'remove' })).toBeNull();
    expect(snapDragEndPosition({ type: 'select' })).toBeNull();
    expect(snapDragEndPosition({ type: 'position', dragging: false })).toBeNull();
  });
});
