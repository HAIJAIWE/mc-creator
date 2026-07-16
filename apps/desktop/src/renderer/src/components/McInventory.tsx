import { McIcon } from '../assets/mc-ui/McIcon';
import type { McAssetScope } from '../assets/mc-ui/mc-ui';

export interface McInventoryItem {
  /** 图标所在素材库：mob（生物）/ game（游戏）/ pixel（通用像素）。默认 mob */
  scope?: McAssetScope;
  /** 素材文件名（去扩展名），如 'creeper' / 'chest' / 'home' */
  name: string;
  /** 堆叠数量，>1 时在右下角显示 MC 风数字角标 */
  amount?: number;
}

export interface McInventoryProps {
  /** 像素缩放，默认 1（每格 16px）；演示用 2 更清晰 */
  scale?: number;
  /** 主物品栏：3 行 × 9 列（共 27 格），行优先排布 */
  main?: (McInventoryItem | null)[];
  /** 快捷栏：1 行 × 9 列（共 9 格） */
  hotbar?: (McInventoryItem | null)[];
}

const COLUMNS = 9;
const MAIN_ROWS = 3;

/**
 * MC 风物品栏面板（物品栏 + 快捷栏）。
 *
 * 布局几何（槽位尺寸 16px、内边距 8px、间隙 2px、快捷栏偏移 6px、面板 176×90px）
 * vendor 自 burigg/minecraft-inventory-ui（MIT, © 2025 kabaodao，见
 * assets/mc-ui/LICENSE-burigg.md）。在此基础上做了两处版权安全替换：
 *   1) Mojang 原版背景图 minecraft_inventory.png → 本项目 CSS 绘制的方块面板；
 *   2) getItemIconUrl 对 Mojang 物品贴图的硬编码映射 → 本项目自有 CC0/CC-BY 图标（mcAsset）。
 * 因此本组件不依赖、也不包含任何 Mojang 原版资产。
 */
export function McInventory({ scale = 1, main = [], hotbar = [] }: McInventoryProps) {
  const slotSize = 16 * scale;
  const padding = 8 * scale;
  const gap = 2 * scale;
  const hotbarGap = 6 * scale;

  const renderSlot = (item: McInventoryItem | null, key: string) => (
    <div
      key={key}
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        width: slotSize,
        height: slotSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgb(var(--mc-surface-2))',
        boxShadow:
          'inset 1px 1px 0 rgb(0 0 0 / 0.5), inset -1px -1px 0 rgb(255 255 255 / 0.08)',
        imageRendering: 'pixelated',
      }}
    >
      {item && (
        <>
          <McIcon scope={item.scope ?? 'mob'} name={item.name} size={slotSize} />
          {item.amount != null && item.amount > 1 && (
            <span
              style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                fontSize: 8 * scale,
                fontFamily: 'var(--mc-font-mono)',
                fontWeight: 700,
                color: '#fff',
                textShadow: '1px 1px 0 #3f3f3f',
                lineHeight: 1,
                pointerEvents: 'none',
              }}
            >
              {item.amount}
            </span>
          )}
        </>
      )}
    </div>
  );

  const mainGridHeight = MAIN_ROWS * slotSize + (MAIN_ROWS - 1) * gap;
  const hotbarTop = padding + mainGridHeight + hotbarGap;
  const panelW = 176 * scale;
  const panelH = 90 * scale;

  // 补齐到固定格数，缺省填空槽
  const mainCells = Array.from(
    { length: COLUMNS * MAIN_ROWS },
    (_, i) => main[i] ?? null,
  );
  const hotbarCells = Array.from({ length: COLUMNS }, (_, i) => hotbar[i] ?? null);

  return (
    <div
      style={{
        position: 'relative',
        width: panelW,
        height: panelH,
        boxSizing: 'border-box',
        background:
          'linear-gradient(180deg, rgb(var(--mc-surface)) 0%, rgb(var(--mc-surface-2)) 100%)',
        boxShadow:
          'inset 2px 2px 0 rgb(255 255 255 / 0.07), inset -2px -2px 0 rgb(0 0 0 / 0.5), var(--mc-sheen)',
        border: '1px solid rgb(var(--mc-border-strong))',
        borderRadius: 'var(--mc-radius-lg)',
        imageRendering: 'pixelated',
      }}
    >
      {/* 主物品栏 3×9 */}
      <div
        style={{
          position: 'absolute',
          top: padding,
          left: padding,
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS}, ${slotSize}px)`,
          gridTemplateRows: `repeat(${MAIN_ROWS}, ${slotSize}px)`,
          gap: gap,
        }}
      >
        {mainCells.map((item, i) => renderSlot(item, `m-${i}`))}
      </div>

      {/* 快捷栏 1×9 */}
      <div
        style={{
          position: 'absolute',
          top: hotbarTop,
          left: padding,
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS}, ${slotSize}px)`,
          gridTemplateRows: `${slotSize}px`,
          gap: gap,
        }}
      >
        {hotbarCells.map((item, i) => renderSlot(item, `h-${i}`))}
      </div>
    </div>
  );
}
