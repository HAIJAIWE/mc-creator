import { useMemo, useState, type CSSProperties } from 'react';
import { McInventory, type McInventoryItem } from './McInventory';
import { McIcon } from '../assets/mc-ui/McIcon';
import { listAssets, type McAssetScope } from '../assets/mc-ui/mc-ui';

type Tab = 'inventory' | 'recipe';
type GridId = 'main' | 'hotbar' | 'recipe' | 'result';

const SCOPES: { scope: McAssetScope; title: string }[] = [
  { scope: 'mob', title: '生物素材' },
  { scope: 'game', title: '游戏素材' },
  { scope: 'pixel', title: '通用像素' },
];

const MAIN_ROWS = 3;
const COLUMNS = 9;
const MAIN_LEN = MAIN_ROWS * COLUMNS; // 27
const HOTBAR_LEN = COLUMNS; // 9
const RECIPE_LEN = 9;

/** 复刻 McInventory 的槽位内联样式（保持与显示组件一致的视觉） */
function slotStyle(scale: number, selected: boolean): CSSProperties {
  const slotSize = 16 * scale;
  return {
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
    cursor: 'pointer',
    outline: selected ? '2px solid rgb(var(--mc-accent))' : 'none',
    outlineOffset: selected ? -2 : 0,
  };
}

function Slot({
  item,
  selected,
  scale,
  onClick,
}: {
  item: McInventoryItem | null;
  selected: boolean;
  scale: number;
  onClick: () => void;
}) {
  const slotSize = 16 * scale;
  return (
    <div style={slotStyle(scale, selected)} onClick={onClick}>
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
}

function SlotGrid({
  items,
  columns,
  rows,
  selectedIndex,
  scale,
  onSlotClick,
}: {
  items: (McInventoryItem | null)[];
  columns: number;
  rows: number;
  selectedIndex: number | null;
  scale: number;
  onSlotClick: (index: number) => void;
}) {
  const slot = 16 * scale;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, ${slot}px)`,
        gridTemplateRows: `repeat(${rows}, ${slot}px)`,
        gap: 2 * scale,
      }}
    >
      {items.map((it, i) => (
        <Slot
          key={i}
          item={it}
          selected={selectedIndex === i}
          scale={scale}
          onClick={() => onSlotClick(i)}
        />
      ))}
    </div>
  );
}

const EMPTY_MAIN = (): (McInventoryItem | null)[] => Array(MAIN_LEN).fill(null);
const EMPTY_HOTBAR = (): (McInventoryItem | null)[] => Array(HOTBAR_LEN).fill(null);
const EMPTY_RECIPE = (): (McInventoryItem | null)[] => Array(RECIPE_LEN).fill(null);

/** 把 item 解析为 "<scope>:<name>" 资产键 */
function assetKey(item: McInventoryItem): string {
  return `${item.scope ?? 'mob'}:${item.name}`;
}

export function ItemRecipeEditor() {
  const [tab, setTab] = useState<Tab>('inventory');

  // 当前笔刷（调色板选中项）
  const [brush, setBrush] = useState<McInventoryItem | null>(null);

  // 物品栏状态
  const [mainItems, setMainItems] = useState<(McInventoryItem | null)[]>(EMPTY_MAIN);
  const [hotbarItems, setHotbarItems] = useState<(McInventoryItem | null)[]>(EMPTY_HOTBAR);
  const [selected, setSelected] = useState<{ grid: GridId; index: number } | null>(null);

  // 配方状态
  const [recipeGrid, setRecipeGrid] = useState<(McInventoryItem | null)[]>(EMPTY_RECIPE);
  const [recipeResult, setRecipeResult] = useState<McInventoryItem | null>(null);
  const [recipeJson, setRecipeJson] = useState('');

  // 调色板素材（按 scope 分组，memo 避免每次渲染重新扫描）
  const palettes = useMemo(
    () => SCOPES.map((s) => ({ ...s, names: listAssets(s.scope) })),
    [],
  );

  // 在指定网格的 index 上：空格+笔刷→放置；已填→选中编辑
  const handleSlot = (
    grid: GridId,
    index: number,
    current: McInventoryItem | null,
    setter: React.Dispatch<React.SetStateAction<(McInventoryItem | null)[]>>,
  ) => {
    if (current) {
      setSelected({ grid, index });
      return;
    }
    if (brush) {
      setter((prev) => prev.map((it, i) => (i === index ? { ...brush, amount: 1 } : it)));
      setSelected(null);
    }
  };

  const updateAmount = (value: number) => {
    if (!selected) return;
    const v = Math.max(1, Math.min(64, Math.floor(value || 1)));
    if (selected.grid === 'main') {
      setMainItems((prev) =>
        prev.map((it, i) => (i === selected.index && it ? { ...it, amount: v } : it)),
      );
    } else if (selected.grid === 'hotbar') {
      setHotbarItems((prev) =>
        prev.map((it, i) => (i === selected.index && it ? { ...it, amount: v } : it)),
      );
    } else if (selected.grid === 'recipe') {
      setRecipeGrid((prev) =>
        prev.map((it, i) => (i === selected.index && it ? { ...it, amount: v } : it)),
      );
    } else if (selected.grid === 'result') {
      setRecipeResult((prev) => (prev ? { ...prev, amount: v } : prev));
    }
  };

  const clearSelected = () => {
    if (!selected) return;
    if (selected.grid === 'main') {
      setMainItems((prev) => prev.map((_, i) => (i === selected.index ? null : _)));
    } else if (selected.grid === 'hotbar') {
      setHotbarItems((prev) => prev.map((_, i) => (i === selected.index ? null : _)));
    } else if (selected.grid === 'recipe') {
      setRecipeGrid((prev) => prev.map((_, i) => (i === selected.index ? null : _)));
    } else if (selected.grid === 'result') {
      setRecipeResult(null);
    }
    setSelected(null);
  };

  const clearAllInventory = () => {
    setMainItems(EMPTY_MAIN());
    setHotbarItems(EMPTY_HOTBAR());
    setSelected(null);
  };

  // 当前选中的 item（用于编辑面板回显）
  const selectedItem: McInventoryItem | null = selected
    ? selected.grid === 'main'
      ? mainItems[selected.index]
      : selected.grid === 'hotbar'
        ? hotbarItems[selected.index]
        : selected.grid === 'recipe'
          ? recipeGrid[selected.index]
          : recipeResult
    : null;

  const generateRecipe = () => {
    const letters = 'ABCDEFGHI';
    const itemToLetter = new Map<string, string>();
    const key: Record<string, { item: string }> = {};
    const pattern: string[] = [];
    for (let r = 0; r < 3; r++) {
      let row = '';
      for (let c = 0; c < 3; c++) {
        const item = recipeGrid[r * 3 + c];
        if (!item) {
          row += ' ';
          continue;
        }
        const id = assetKey(item);
        let letter = itemToLetter.get(id);
        if (!letter) {
          letter = letters[itemToLetter.size];
          itemToLetter.set(id, letter);
          key[letter] = { item: id };
        }
        row += letter;
      }
      pattern.push(row);
    }
    const result = recipeResult
      ? { item: assetKey(recipeResult), count: recipeResult.amount ?? 1 }
      : { item: '', count: 1 };
    const recipe = {
      type: 'minecraft:crafting_shaped',
      pattern,
      key,
      result,
    };
    setRecipeJson(JSON.stringify(recipe, null, 2));
  };

  const copyJson = async () => {
    if (!recipeJson) return;
    try {
      await navigator.clipboard.writeText(recipeJson);
    } catch {
      /* 剪贴板不可用时静默忽略 */
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部 tab 切换 */}
      <div className="flex gap-2 border-b border-mc-border p-3">
        <button
          className={tab === 'inventory' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          onClick={() => setTab('inventory')}
        >
          物品栏
        </button>
        <button
          className={tab === 'recipe' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          onClick={() => setTab('recipe')}
        >
          配方
        </button>
      </div>

      {/* 内容区（可滚动） */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {tab === 'inventory' && (
          <>
            {/* 当前笔刷 */}
            <div className="mc-card flex items-center gap-2 p-2">
              <span className="text-xs text-mc-dim">当前笔刷</span>
              {brush ? (
                <span className="flex items-center gap-1">
                  <McIcon scope={brush.scope ?? 'mob'} name={brush.name} size={18} />
                  <span className="text-xs text-mc-text">
                    {brush.scope ?? 'mob'}:{brush.name}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-mc-mute">未选择素材（点击下方素材库）</span>
              )}
            </div>

            {/* 素材调色板 */}
            <div>
              <div className="mc-section-title">素材库</div>
              <div className="max-h-56 space-y-2 overflow-auto pr-1">
                {palettes.map((group) => (
                  <div key={group.scope}>
                    <div className="mb-1 text-xs text-mc-dim">
                      {group.title}（{group.names.length}）
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(8, 1fr)',
                        gap: 2,
                      }}
                    >
                      {group.names.map((name) => {
                        const isBrush =
                          brush?.scope === group.scope && brush?.name === name;
                        return (
                          <button
                            key={name}
                            title={`${group.scope}:${name}`}
                            onClick={() =>
                              setBrush({ scope: group.scope, name })
                            }
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 2,
                              background: 'rgb(var(--mc-surface-2))',
                              border:
                                '1px solid ' +
                                (isBrush
                                  ? 'rgb(var(--mc-accent))'
                                  : 'rgb(var(--mc-border))'),
                              borderRadius: 'var(--mc-radius-lg)',
                              cursor: 'pointer',
                              outline: isBrush
                                ? '2px solid rgb(var(--mc-accent))'
                                : 'none',
                              outlineOffset: isBrush ? -2 : 0,
                            }}
                          >
                            <McIcon scope={group.scope} name={name} size={18} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 物品栏编辑 */}
            <div>
              <div className="mc-section-title">物品栏编辑</div>
              <SlotGrid
                items={mainItems}
                columns={COLUMNS}
                rows={MAIN_ROWS}
                selectedIndex={selected?.grid === 'main' ? selected.index : null}
                scale={1}
                onSlotClick={(i) =>
                  handleSlot('main', i, mainItems[i], setMainItems)
                }
              />
              <div style={{ height: 6 }} />
              <SlotGrid
                items={hotbarItems}
                columns={COLUMNS}
                rows={1}
                selectedIndex={selected?.grid === 'hotbar' ? selected.index : null}
                scale={1}
                onSlotClick={(i) =>
                  handleSlot('hotbar', i, hotbarItems[i], setHotbarItems)
                }
              />

              {selected && (selected.grid === 'main' || selected.grid === 'hotbar') && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-mc-dim">数量</span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={selectedItem?.amount ?? 1}
                    onChange={(e) => updateAmount(Number(e.target.value))}
                    className="mc-input w-20"
                  />
                  <button className="mc-btn-ghost" onClick={clearSelected}>
                    清除
                  </button>
                </div>
              )}

              <div className="mt-2">
                <button className="mc-btn-ghost" onClick={clearAllInventory}>
                  全部清空
                </button>
              </div>
            </div>

            {/* 实时预览：把 McInventory 显示组件接进来做实时预览 */}
            <div>
              <div className="mc-section-title">实时预览</div>
              <div className="overflow-auto">
                <McInventory main={mainItems} hotbar={hotbarItems} scale={2} />
              </div>
            </div>
          </>
        )}

        {tab === 'recipe' && (
          <>
            {/* 当前笔刷（沿用同一支笔刷） */}
            <div className="mc-card flex items-center gap-2 p-2">
              <span className="text-xs text-mc-dim">当前笔刷</span>
              {brush ? (
                <span className="flex items-center gap-1">
                  <McIcon scope={brush.scope ?? 'mob'} name={brush.name} size={18} />
                  <span className="text-xs text-mc-text">
                    {brush.scope ?? 'mob'}:{brush.name}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-mc-mute">未选择素材（切到「物品栏」挑选）</span>
              )}
            </div>

            {/* 3×3 合成网格 + 结果格 */}
            <div>
              <div className="mc-section-title">合成网格（3×3）</div>
              <div className="flex items-start gap-3">
                <SlotGrid
                  items={recipeGrid}
                  columns={3}
                  rows={3}
                  selectedIndex={selected?.grid === 'recipe' ? selected.index : null}
                  scale={1}
                  onSlotClick={(i) =>
                    handleSlot('recipe', i, recipeGrid[i], setRecipeGrid)
                  }
                />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs text-mc-dim">结果</span>
                  <Slot
                    item={recipeResult}
                    selected={selected?.grid === 'result'}
                    scale={1}
                    onClick={() => {
                      if (recipeResult) {
                        setSelected({ grid: 'result', index: 0 });
                      } else if (brush) {
                        setRecipeResult({ ...brush, amount: 1 });
                        setSelected(null);
                      }
                    }}
                  />
                </div>
              </div>

              {selected &&
                (selected.grid === 'recipe' || selected.grid === 'result') && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-mc-dim">数量</span>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={selectedItem?.amount ?? 1}
                      onChange={(e) => updateAmount(Number(e.target.value))}
                      className="mc-input w-20"
                    />
                    <button className="mc-btn-ghost" onClick={clearSelected}>
                      清除
                    </button>
                  </div>
                )}
            </div>

            {/* 生成配方 JSON */}
            <div>
              <div className="mc-section-title">配方 JSON</div>
              <div className="flex gap-2">
                <button
                  className="mc-btn-primary"
                  onClick={generateRecipe}
                  disabled={!recipeResult}
                >
                  生成配方 JSON
                </button>
                <button className="mc-btn-ghost" onClick={copyJson} disabled={!recipeJson}>
                  复制
                </button>
              </div>
              {!recipeResult && (
                <div className="mt-1 text-xs text-mc-mute">请先放置结果物品</div>
              )}
              {recipeJson && (
                <pre className="mc-card mt-2 overflow-auto p-2 text-xs text-mc-text">
                  {recipeJson}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
