import { useState } from 'react';
import { Plus, X, Copy } from 'lucide-react';
import { listAssets, type McAssetScope } from '../assets/mc-ui/mc-ui';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import type { ItemSpec } from '@mc-creator/shared';

const SCOPES: McAssetScope[] = ['mob', 'game', 'pixel'];
const STACKS = [1, 16, 64];
const RARITIES = ['common', 'uncommon', 'rare', 'epic'] as const;

/** 由素材名生成合法的 ItemSpec.id（小写下划线，匹配 ^[a-z0-9_]+$） */
function toItemId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'item'
  );
}

/** 方块 / 物品属性编辑器：选素材 → 配属性 → 写入 mod-store.spec.items。 */
export function BlockEditor() {
  const [scope, setScope] = useState<McAssetScope>('game');
  const [selected, setSelected] = useState('stone-block');
  const [displayName, setDisplayName] = useState('');
  const [maxStack, setMaxStack] = useState(64);
  const [rarity, setRarity] = useState<(typeof RARITIES)[number]>('common');

  const addItem = useModStore((s) => s.addItem);
  const removeItem = useModStore((s) => s.removeItem);
  const items = useModStore((s) => s.spec?.items ?? []);

  const names = listAssets(scope);

  const buildItem = (): ItemSpec => ({
    id: toItemId(selected),
    name: displayName || selected,
    maxStackSize: maxStack,
    rarity,
    maxDamage: 0,
    fuelTick: 0,
    lore: '',
  });

  const json = JSON.stringify(buildItem(), null, 2);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mc-section-title border-b border-mc-border">方块 / 物品属性</div>
      <div className="space-y-3 p-3">
        {/* 素材选择 */}
        <div>
          <div className="mb-1 flex gap-1">
            {SCOPES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setScope(s);
                  setSelected(listAssets(s)[0] ?? '');
                }}
                className={`mc-btn-ghost !px-2 ${scope === s ? '!bg-mc-surface-2 text-mc-text' : ''}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-mc border border-mc-border bg-mc-surface-2 p-1">
            {names.map((n) => (
              <button
                key={n}
                onClick={() => setSelected(n)}
                className={`flex items-center justify-center rounded p-1 transition-colors ${
                  selected === n ? 'bg-mc-accent/30' : 'hover:bg-mc-surface-3'
                }`}
                title={n}
              >
                <McIcon scope={scope} name={n} size={18} />
              </button>
            ))}
          </div>
        </div>

        {/* 属性 */}
        <div className="space-y-2">
          <div>
            <label className="mb-0.5 block text-xs text-mc-dim">显示名称</label>
            <input
              className="mc-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={selected}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-0.5 block text-xs text-mc-dim">最大堆叠</label>
              <select
                className="mc-select w-full"
                value={maxStack}
                onChange={(e) => setMaxStack(Number(e.target.value))}
              >
                {STACKS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-0.5 block text-xs text-mc-dim">稀有度</label>
              <select
                className="mc-select w-full"
                value={rarity}
                onChange={(e) => setRarity(e.target.value as (typeof RARITIES)[number])}
              >
                {RARITIES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 写入 mod-store */}
        <div className="flex items-center gap-2">
          <button className="mc-btn" onClick={() => addItem(buildItem())}>
            <Plus size={14} /> 添加到 Mod
          </button>
          <span className="text-xs text-mc-dim">已加入 {items.length} 个物品</span>
        </div>

        {/* 已加入列表 */}
        {items.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-mc-dim">已加入物品</div>
            <ul className="mc-card max-h-32 space-y-1 overflow-auto p-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-mc-text">
                    {it.name} <span className="text-mc-mute">({it.id})</span>
                  </span>
                  <button
                    className="mc-btn-ghost !px-1.5 !py-0.5"
                    onClick={() => removeItem(it.id)}
                    title="移除"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 预览 */}
        <div>
          <div className="mb-1 text-xs text-mc-dim">生成 ItemSpec JSON</div>
          <pre className="mc-card max-h-48 overflow-auto p-2 text-xs text-mc-text">{json}</pre>
          <button
            className="mc-btn-ghost mt-1"
            onClick={() => navigator.clipboard?.writeText(json)}
          >
            <Copy size={14} /> 复制
          </button>
        </div>
      </div>
    </div>
  );
}
