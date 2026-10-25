/**
 * 皮肤正面预览组件（薄壳）。
 *
 * 合成逻辑与 UV 坐标表都在 `skin-preview.shared.ts` —— 组件文件只导出组件是
 * 本仓约定（`react-refresh/only-export-components`，同 `detail-shared.ts`）。
 */
import { compositeSkinFront, OUT_H, OUT_W } from './skin-preview.shared.js';

/**
 * 加载贴图并渲染正面小人。
 *
 * 失败（图加载不了 / 既不是 64×64 也不是 legacy 64×32 / canvas 不可用）时**什么都不画** ——
 * 留一个空白框，而不是回退到「显示整张贴图」。因为那个回退正是要消灭的
 * 噪声图；画不出来就说画不出来，列表里少个缩略图不影响挑选。
 */
export function SkinFrontPreview({
  url,
  alt,
  width = 32,
}: {
  url: string;
  alt: string;
  width?: number;
}): JSX.Element {
  // 8×32 的立绘按 4 倍放大 = 32×128，够看清脸又不占太多高度
  const height = width * (OUT_H / OUT_W);
  return (
    <canvas
      role="img"
      aria-label={alt}
      width={width}
      height={height}
      className="shrink-0 rounded-mc"
      ref={(el) => {
        if (el === null) return;
        const ctx = el.getContext('2d');
        if (ctx === null) return;
        // 皮肤不能插值：放大时保持像素边缘锐利
        ctx.imageSmoothingEnabled = false;
        const img = new Image();
        img.onload = () => {
          const data = compositeSkinFront(img);
          if (data === null) return;
          const composed = new Image();
          composed.onload = () => {
            ctx.clearRect(0, 0, el.width, el.height);
            ctx.drawImage(composed, 0, 0, el.width, el.height);
          };
          composed.onerror = () => undefined;
          composed.src = data;
        };
        img.onerror = () => undefined;
        img.src = url;
      }}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
