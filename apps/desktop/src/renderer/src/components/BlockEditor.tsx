import { useState } from 'react';
import { listAssets, type McAssetScope } from '../assets/mc-ui/mc-ui';
import { McIcon } from '../assets/mc-ui/McIcon';

const SCOPES: McAssetScope[] = ['mob', 'game', 'pixel'];
const STACKS = [1, 16, 64];
const RARITIES = ['common', 'uncommon', 'rare', 'epic'];
const TOOLS = ['pickaxe', 'axe', 'shovel', 'sword', 'hand'];

/** 方块 / 物品属性编辑器：选素材 → 配属性 → 导出 MC 风格 JSON。 */
export function BlockEditor() {
  const [scope, setScope] = useState<McAssetScope>('game');
  const [selected, setSelected] = useState('stone-block');
  const [displayName, setDisplayName] = useState('');
  const [maxStack, setMaxStack] = useState(64);
  const [rarity, setRarity] = useState('common');
  const [tool, setTool] = useState('pickaxe');

  const names = listAssets(scope);
  const json = JSON.stringify(
    {
      id: `${scope}:${selected}`,
      displayName: displayName || selected,
      maxStackSize: maxStack,
      rarity,
      requiredTool: tool,
    },
    null,
    2,
  );

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
                onChange={(e) => setRarity(e.target.value)}
              >
                {RARITIES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-mc-dim">所需工具</label>
            <select className="mc-select w-full" value={tool} onChange={(e) => setTool(e.target.value)}>
              {TOOLS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 导出 */}
        <div>
          <div className="mb-1 text-xs text-mc-dim">生成 JSON</div>
          <pre className="mc-card max-h-48 overflow-auto p-2 text-xs text-mc-text">{json}</pre>
          <button
            className="mc-btn-ghost mt-1"
            onClick={() => navigator.clipboard?.writeText(json)}
          >
            <McIcon scope="pixel" name="copy" size={14} /> 复制
          </button>
        </div>
      </div>
    </div>
  );
}
