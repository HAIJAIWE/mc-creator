import { mcAsset, type McAssetScope } from './mc-ui';

interface McIconProps {
  scope: McAssetScope;
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** 像素风图标组件 —— 渲染 mc-ui 文件夹里的 SVG，放大保持像素硬边 */
export function McIcon({ scope, name, size = 18, className, style }: McIconProps) {
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
