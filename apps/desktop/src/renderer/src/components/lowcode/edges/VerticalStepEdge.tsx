import { type EdgeProps, MarkerType } from '@xyflow/react';

/**
 * 垂直折线边：正交布局（工业风），仅在垂直方向折线。
 * 继承 BezierEdge 但强制正交路径，适配 MC 工业风画布。
 */
export function VerticalStepEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition = 'bottom',
    targetPosition = 'top',
    style = {},
    markerEnd,
    ...rest
  } = props;

  // 计算正交路径：从 source 向下/向上延伸，再水平，再向 target
  const path = getOrthogonalPath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  );

  return (
    <>
      <path
        {...rest}
        d={path}
        style={{
          fill: 'none',
          stroke: '#6b7280',
          strokeWidth: 1.5,
          pointerEvents: 'stroke',
          ...style,
        }}
        markerEnd={markerEnd ?? { type: MarkerType.ArrowClosed, color: '#6b7280' } as any}
      />
    </>
  );
}

/**
 * 生成正交路径字符串 (SVG path d 属性)
 * 仅支持 sourcePosition='bottom' | 'top' 和 targetPosition='top' | 'bottom' 的垂直布局
 */
function getOrthogonalPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: 'bottom' | 'top' | 'left' | 'right' = 'bottom',
  targetPosition: 'bottom' | 'top' | 'left' | 'right' = 'top',
): string {
  // 垂直布局：source 在上，target 在下（或反之），折线在中间水平段
  const midY = (sourceY + targetY) / 2;

  // 起点
  let path = `M ${sourceX} ${sourceY}`;

  // 根据 sourcePosition 决定第一段方向
  if (sourcePosition === 'bottom') {
    path += ` V ${midY}`; // 向下延伸到中间 Y
  } else if (sourcePosition === 'top') {
    path += ` V ${midY}`; // 向上延伸到中间 Y
  } else if (sourcePosition === 'right') {
    path += ` H ${midY}`; // 这里 midY 其实应用于 X，但垂直布局不常用
  } else {
    path += ` H ${midY}`;
  }

  // 水平段到目标 X
  path += ` H ${targetX}`;

  // 根据 targetPosition 决定最后一段
  if (targetPosition === 'top') {
    path += ` V ${targetY}`; // 向上到目标
  } else if (targetPosition === 'bottom') {
    path += ` V ${targetY}`; // 向下到目标
  } else if (targetPosition === 'left') {
    path += ` H ${targetY}`;
  } else {
    path += ` H ${targetY}`;
  }

  return path;
}