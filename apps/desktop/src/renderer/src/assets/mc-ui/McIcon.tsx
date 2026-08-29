import { mcAsset, mcAssetRaw, type McAssetScope } from './mc-ui';

interface McIconProps {
  scope: McAssetScope;
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 像素风图标组件 —— 渲染 mc-ui 文件夹里的 SVG，放大保持像素硬边。
 *
 * SVG 优先内联渲染（dangerouslySetInnerHTML），使 `fill="currentColor"`
 * 继承父元素的文字颜色 —— 这样 text-mc-* 等颜色类能正常给图标着色；
 * 而 <img> 引用 SVG 时 currentColor 会解析为黑色，在深色面板上几乎看不见。
 * png/webp 素材退回 <img>。
 */
export function McIcon({ scope, name, size = 18, className, style }: McIconProps) {
  const raw = mcAssetRaw(scope, name);
  if (raw) {
    return (
      <span
        className={`mc-icon-svg ${className ?? ''}`}
        role="img"
        aria-label={name}
        style={{ display: 'inline-block', width: size, height: size, ...style }}
        dangerouslySetInnerHTML={{ __html: raw }}
      />
    );
  }
  const src = mcAsset(scope, name);
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={name}
      className={className}
      style={{ imageRendering: 'pixelated', display: 'inline-block', ...style }}
    />
  );
}
