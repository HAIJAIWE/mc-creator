interface McMarkProps {
  className?: string;
  /** 草方块顶部草皮颜色，默认继承 currentColor（即父级文字色） */
  grass?: string;
}

/**
 * MC Creator 品牌标记 —— 草方块（Grass Block）。
 * 方块感、零圆角，一眼认出「这是做 Minecraft 的」。
 * 草皮用 currentColor，便于在任意位置以强调色渲染。
 */
export function McMark({ className, grass }: McMarkProps) {
  const grassColor = grass ?? 'currentColor';
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" shapeRendering="crispEdges">
      {/* 泥土底座 */}
      <rect x="0" y="0" width="24" height="24" fill="#6b5638" />
      <rect x="0" y="0" width="24" height="24" fill="#000" opacity="0.06" />
      {/* 草皮顶面 */}
      <rect x="0" y="0" width="24" height="9" fill={grassColor} />
      {/* 草皮下垂的几处像素，模拟自然边缘 */}
      <rect x="3" y="9" width="3" height="3" fill={grassColor} />
      <rect x="11" y="9" width="4" height="4" fill={grassColor} />
      <rect x="18" y="9" width="2" height="3" fill={grassColor} />
      {/* 泥土上的草点纹理 */}
      <rect x="6" y="14" width="2" height="2" fill="#7d663f" />
      <rect x="15" y="17" width="2" height="2" fill="#7d663f" />
      <rect x="9" y="19" width="2" height="2" fill="#7d663f" />
    </svg>
  );
}
