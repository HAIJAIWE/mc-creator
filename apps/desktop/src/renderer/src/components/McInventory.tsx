import { useState, useCallback } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import type { McAssetScope } from '../assets/mc-ui/mc-ui';

// ===== 类型定义 =====

export interface McInventoryItem {
  /** 图标所在素材库：mob（生物）/ game（游戏）/ pixel（通用像素）。默认 mob */
  scope?: McAssetScope;
  /** 素材文件名（去扩展名），如 'creeper' / 'chest' / 'home' */
  name: string;
  /** 堆叠数量，>1 时在右下角显示 MC 风数字角标 */
  amount?: number;
  /** 物品显示名（悬浮提示用） */
  displayName?: string;
  /** 物品 ID（如 minecraft:diamond_sword） */
  itemId?: string;
  /** 物品稀有度：common / uncommon / rare / epic */
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic';
  /** 附魔光辉（附魔物品紫色闪烁） */
  enchanted?: boolean;
  /** 损伤值 / 最大损伤（如 [50/100]） */
  damage?: { current: number; max: number };
  /** 自定义描述行（Lore） */
  lore?: string[];
}

export interface McInventoryProps {
  /** 像素缩放，默认 1（每格 16px）；演示用 2 更清晰 */
  scale?: number;
  /** 主物品栏：3 行 × 9 列（共 27 格），行优先排布 */
  main?: (McInventoryItem | null)[];
  /** 快捷栏：1 行 × 9 列（共 9 格） */
  hotbar?: (McInventoryItem | null)[];
  /** 盔甲槽：[头盔, 胸甲, 护腿, 靴子]（从上到下） */
  armor?: (McInventoryItem | null)[];
  /** 副手槽 */
  offhand?: McInventoryItem | null;
  /** 合成网格：3×3（用于工作台/合成台预览） */
  craftingGrid?: (McInventoryItem | null)[];
  /** 合成结果槽 */
  craftingResult?: McInventoryItem | null;
  /** 是否显示合成区域 */
  showCrafting?: boolean;
  /** 选中槽位变更回调 */
  onSlotSelect?: (slot: SlotInfo) => void;
  /** 快捷栏选中索引（0-8） */
  hotbarActive?: number;
}

/** 槽位信息 */
export interface SlotInfo {
  area: 'main' | 'hotbar' | 'armor' | 'offhand' | 'crafting' | 'craftingResult';
  index: number;
  item: McInventoryItem | null;
}

const COLUMNS = 9;
const MAIN_ROWS = 3;
const CRAFT_ROWS = 3;
const CRAFT_COLS = 3;

const RARITY_COLORS: Record<string, string> = {
  common: '#fff',
  uncommon: '#55ff55',
  rare: '#5555ff',
  epic: '#ff55ff',
};

// ===== 组件 =====

/**
 * MC 风物品栏面板（物品栏 + 快捷栏 + 盔甲槽 + 副手 + 合成网格）。
 *
 * 布局几何沿袭 burigg/minecraft-inventory-ui（MIT, © 2025 kabaodao），
 * 在此基础上做了版权安全替换：
 *   1) Mojang 原版背景图 → CSS 绘制方块面板
 *   2) getItemIconUrl → 本项目自有 CC0/CC-BY 图标
 */
export function McInventory({
  scale = 1,
  main = [],
  hotbar = [],
  armor = [],
  offhand = null,
  craftingGrid = [],
  craftingResult = null,
  showCrafting = false,
  onSlotSelect,
  hotbarActive = -1,
}: McInventoryProps) {
  const [selectedSlot, setSelectedSlot] = useState<SlotInfo | null>(null);
  const [hoverSlot, setHoverSlot] = useState<SlotInfo | null>(null);

  const slotSize = 16 * scale;
  const gap = 2 * scale;
  const labelH = 10 * scale;

  const handleSlotClick = useCallback(
    (slot: SlotInfo) => {
      setSelectedSlot(slot);
      onSlotSelect?.(slot);
    },
    [onSlotSelect],
  );

  const isSelected = (area: SlotInfo['area'], index: number) =>
    selectedSlot?.area === area && selectedSlot?.index === index;

  const isHovered = (area: SlotInfo['area'], index: number) =>
    hoverSlot?.area === area && hoverSlot?.index === index;

  // ===== 槽位渲染 =====
  const renderSlot = (
    item: McInventoryItem | null,
    area: SlotInfo['area'],
    index: number,
    extraClass?: string,
  ) => {
    const slot: SlotInfo = { area, index, item };
    const sel = isSelected(area, index);
    const hov = isHovered(area, index);
    const isHotbarActive = area === 'hotbar' && index === hotbarActive;

    return (
      <div
        key={`${area}-${index}`}
        onClick={() => handleSlotClick(slot)}
        onMouseEnter={() => setHoverSlot(slot)}
        onMouseLeave={() => setHoverSlot(null)}
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          width: slotSize,
          height: slotSize,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          imageRendering: 'pixelated',
          cursor: 'pointer',
        }}
        className={`
          rounded-sm
          ${sel ? 'ring-1 ring-mc-accent ring-offset-1 ring-offset-mc-surface' : ''}
          ${isHotbarActive ? 'ring-1 ring-white/60' : ''}
          ${extraClass ?? ''}
        `}
        title={item ? (item.displayName ?? item.itemId ?? item.name) : ''}
      >
        {/* 槽位背景 */}
        <div
          className="absolute inset-0 rounded-sm"
          style={{
            background: hov ? 'rgb(var(--mc-surface-3))' : 'rgb(var(--mc-surface-2))',
            boxShadow:
              'inset 1px 1px 0 rgb(0 0 0 / 0.5), inset -1px -1px 0 rgb(255 255 255 / 0.08)',
          }}
        />

        {/* 物品图标 */}
        {item && (
          <>
            <McIcon
              scope={item.scope ?? 'mob'}
              name={item.name}
              size={slotSize}
              className={item.enchanted ? 'animate-pulse' : ''}
              style={{
                position: 'relative',
                zIndex: 1,
                filter: item.enchanted ? 'hue-rotate(240deg) brightness(1.3)' : undefined,
              }}
            />
            {/* 堆叠数量 */}
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
                  zIndex: 2,
                }}
              >
                {item.amount}
              </span>
            )}
            {/* 损伤条 */}
            {item.damage && (
              <div
                style={{
                  position: 'absolute',
                  left: 1,
                  right: 1,
                  bottom: 0,
                  height: 2 * scale,
                  zIndex: 2,
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${((item.damage.max - item.damage.current) / item.damage.max) * 100}%`,
                    height: '100%',
                    background: damageColor(item.damage.current, item.damage.max),
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // 补齐到固定格数
  const mainCells = Array.from({ length: COLUMNS * MAIN_ROWS }, (_, i) => main[i] ?? null);
  const hotbarCells = Array.from({ length: COLUMNS }, (_, i) => hotbar[i] ?? null);
  const armorCells = Array.from({ length: 4 }, (_, i) => armor[i] ?? null);
  const craftCells = Array.from(
    { length: CRAFT_ROWS * CRAFT_COLS },
    (_, i) => craftingGrid[i] ?? null,
  );

  return (
    <div
      className="relative inline-flex flex-col gap-0 overflow-hidden rounded-mc border border-mc-border bg-mc-surface p-2"
      style={{ imageRendering: 'pixelated' }}
    >
      {/* ===== 合成区域 ===== */}
      {showCrafting && (
        <div className="mb-2">
          <div className="mb-1 text-[10px] font-medium text-mc-dim">合成</div>
          <div className="flex items-start gap-3">
            {/* 3×3 合成网格 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${CRAFT_COLS}, ${slotSize}px)`,
                gridTemplateRows: `repeat(${CRAFT_ROWS}, ${slotSize}px)`,
                gap,
              }}
            >
              {craftCells.map((item, i) => renderSlot(item, 'crafting', i))}
            </div>
            {/* 箭头 → 结果 */}
            <div className="flex items-center" style={{ minHeight: slotSize }}>
              <span className="text-mc-mute" style={{ fontSize: 14 * scale }}>
                →
              </span>
            </div>
            {/* 合成结果槽 */}
            {renderSlot(craftingResult, 'craftingResult', 0, 'border border-mc-accent/30')}
          </div>
        </div>
      )}

      {/* ===== 盔甲 + 主栏 ===== */}
      <div className="flex gap-3">
        {/* 盔甲列（4 盔甲 + 副手） */}
        <div className="flex flex-col items-center gap-0.5">
          <div className="text-[9px] text-mc-mute" style={{ height: labelH }}>
            盔甲
          </div>
          <div className="flex flex-col" style={{ gap }}>
            {armorCells.map((item, i) => renderSlot(item, 'armor', i))}
          </div>
          {/* 副手槽 */}
          <div className="mt-1 text-[9px] text-mc-mute">副手</div>
          {renderSlot(offhand, 'offhand', 0)}
        </div>

        {/* 主物品栏 3×9 */}
        <div className="flex flex-col gap-0.5">
          <div className="text-[9px] text-mc-mute" style={{ height: labelH }}>
            物品栏
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${COLUMNS}, ${slotSize}px)`,
              gridTemplateRows: `repeat(${MAIN_ROWS}, ${slotSize}px)`,
              gap,
            }}
          >
            {mainCells.map((item, i) => renderSlot(item, 'main', i))}
          </div>
        </div>
      </div>

      {/* ===== 快捷栏 1×9 ===== */}
      <div className="mt-2 flex flex-col gap-0.5">
        <div className="text-[9px] text-mc-mute" style={{ height: labelH }}>
          快捷栏
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${COLUMNS}, ${slotSize}px)`,
            gridTemplateRows: `${slotSize}px`,
            gap,
          }}
        >
          {hotbarCells.map((item, i) => renderSlot(item, 'hotbar', i))}
        </div>
      </div>

      {/* ===== 选中信息 ===== */}
      {selectedSlot && (
        <div className="mt-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[10px] text-mc-dim">
          {selectedSlot.item
            ? `${selectedSlot.item.displayName ?? selectedSlot.item.name}${selectedSlot.item.amount ? ` ×${selectedSlot.item.amount}` : ''} [${selectedSlot.area}#${selectedSlot.index}]`
            : `空槽位 [${selectedSlot.area}#${selectedSlot.index}]`}
        </div>
      )}

      {/* 悬浮提示（定位在外层，避免 overflow 裁切） */}
      {hoverSlot?.item && (
        <div
          className="pointer-events-none absolute z-50 max-w-[200px] rounded-mc border border-mc-border bg-mc-surface p-2 shadow-lg"
          style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 }}
        >
          {(() => {
            const item = hoverSlot.item;
            const color = RARITY_COLORS[item.rarity ?? 'common'] ?? '#fff';
            return (
              <>
                <div className="text-xs font-bold" style={{ color }}>
                  {item.displayName ?? item.name}
                </div>
                {item.itemId && (
                  <div className="mt-0.5 font-mono text-[10px] text-mc-mute">{item.itemId}</div>
                )}
                {item.damage && (
                  <div className="mt-0.5 text-[10px] text-mc-dim">
                    耐久 {item.damage.max - item.damage.current} / {item.damage.max}
                  </div>
                )}
                {item.rarity && item.rarity !== 'common' && (
                  <div className="mt-0.5 text-[10px]" style={{ color }}>
                    {item.rarity === 'uncommon' ? '优秀' : item.rarity === 'rare' ? '稀有' : '史诗'}
                  </div>
                )}
                {item.lore && item.lore.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {item.lore.map((line, i) => (
                      <div key={i} className="text-[10px] text-purple-400 italic">
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ===== 工具函数 =====

/** 损伤条颜色：绿 → 黄 → 红 */
function damageColor(current: number, max: number): string {
  const ratio = current / max;
  if (ratio > 0.7) return '#ff0000'; // 接近破碎
  if (ratio > 0.4) return '#ff8800'; // 中等损伤
  return '#55ff55'; // 健康
}
