import { useCallback } from 'react';

/**
 * 可拖拽分割条（P34）。
 *
 * - 水平方向拖拽（左右调整列宽）
 * - onResize 回调接收增量 delta（px），正值=向右，负值=向左
 * - 拖拽时全局 cursor=col-resize + 禁止文本选中
 * - hover 时蓝色高亮
 *
 * 用法：
 *   <Splitter onResize={(d) => setLeftWidth((w) => clamp(w + d, min, max))} />
 *   <Splitter onResize={(d) => setRightWidth((w) => clamp(w - d, min, max))} />
 */
interface SplitterProps {
  onResize: (delta: number) => void;
}

export function Splitter({ onResize }: SplitterProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      let lastX = e.clientX;

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX;
        lastX = ev.clientX;
        onResize(delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onResize],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 flex-shrink-0 cursor-col-resize bg-mc-surface-2 transition-colors hover:bg-mc-accent"
    />
  );
}
