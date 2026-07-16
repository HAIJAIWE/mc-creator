
import { McInventory, type McInventoryItem } from './McInventory';
import { McIcon } from '../assets/mc-ui/McIcon';
import { listAssets } from '../assets/mc-ui/mc-ui';
import type { McAssetScope } from '../assets/mc-ui/mc-ui';

const SAMPLE_MAIN: (McInventoryItem | null)[] = [
  { scope: 'mob', name: 'creeper', amount: 3 },
  { scope: 'mob', name: 'zombie' },
  { scope: 'mob', name: 'skeleton' },
  { scope: 'mob', name: 'enderman' },
  { scope: 'mob', name: 'spider' },
  { scope: 'game', name: 'chest' },
  { scope: 'game', name: 'anvil' },
  { scope: 'game', name: 'coins' },
  { scope: 'game', name: 'crown' },
  { scope: 'mob', name: 'slime' },
  { scope: 'mob', name: 'blaze' },
  { scope: 'mob', name: 'ghast' },
  { scope: 'mob', name: 'warden' },
  { scope: 'mob', name: 'witch' },
  { scope: 'mob', name: 'guardian' },
  { scope: 'game', name: 'shield' },
  { scope: 'game', name: 'book-cover' },
  { scope: 'game', name: 'compass' },
  { scope: 'game', name: 'diamond-hard' },
  { scope: 'mob', name: 'bee' },
  { scope: 'mob', name: 'fox' },
  { scope: 'mob', name: 'allay' },
  { scope: 'mob', name: 'wither' },
  { scope: 'mob', name: 'iron_golem' },
  { scope: 'mob', name: 'villager' },
  { scope: 'mob', name: 'phantom' },
  { scope: 'mob', name: 'horse' },
];

const SAMPLE_HOTBAR: (McInventoryItem | null)[] = [
  { scope: 'mob', name: 'creeper' },
  { scope: 'mob', name: 'piglin' },
  { scope: 'game', name: 'axe-swing' },
  { scope: 'game', name: 'fire' },
  { scope: 'game', name: 'key' },
  null,
  { scope: 'pixel', name: 'home' },
  { scope: 'pixel', name: 'heart' },
  { scope: 'pixel', name: 'lock' },
];

const GALLERY_SCOPES: { scope: McAssetScope; label: string; limit: number }[] = [
  { scope: 'mob', label: '生物（CC0 · Entity-Icons）', limit: 12 },
  { scope: 'game', label: '游戏（CC BY 3.0 · Game-icons）', limit: 12 },
  { scope: 'pixel', label: '通用像素（Pixelarticons）', limit: 12 },
];

function IconCell({ scope, name }: { scope: McAssetScope; name: string }) {
  return (
    <div className="flex w-[72px] flex-col items-center gap-1 rounded-mc-lg border border-mc-border bg-mc-surface-2 p-2">
      <McIcon scope={scope} name={name} size={28} />
      <span className="max-w-full truncate text-[10px] text-mc-mute">{name}</span>
    </div>
  );
}

export function McUiShowcase() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mc-section-title flex items-center gap-2">
        <McIcon scope="pixel" name="box" size={16} />
        MC UI 素材库
      </div>

      <div className="space-y-4 p-4">
        <p className="text-xs leading-relaxed text-mc-dim">
          全部图标均为<strong className="text-mc-text">开源 / 开放协议</strong>素材（CC0 / CC BY 3.0 /
          Pixelarticons 免费商用），<strong className="text-mc-text">不含任何 Mojang 原版贴图</strong>。
          物品栏面板 vendor 自 burigg/minecraft-inventory-ui（MIT），已剥离原版背景图与物品贴图。
        </p>

        {/* 物品栏面板演示 */}
        <section className="mc-card p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-mc-dim">
            物品栏面板 · &lt;McInventory /&gt;
          </h3>
          <div className="overflow-x-auto">
            <McInventory main={SAMPLE_MAIN} hotbar={SAMPLE_HOTBAR} scale={2} />
          </div>
        </section>

        {/* 图标画廊 */}
        <section className="mc-card p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-mc-dim">
            图标画廊 · &lt;McIcon /&gt;
          </h3>
          <div className="space-y-4">
            {GALLERY_SCOPES.map(({ scope, label, limit }) => {
              const names = listAssets(scope).slice(0, limit);
              return (
                <div key={scope}>
                  <div className="mb-2 text-[11px] text-mc-mute">{label}</div>
                  <div className="flex flex-wrap gap-2">
                    {names.map((name) => (
                      <IconCell key={name} scope={scope} name={name} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 像素字体演示 */}
        <section className="mc-card p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-mc-dim">
            像素字体 · Monocraft（OFL-1.1）
          </h3>
          <p
            className="text-lg leading-tight text-mc-text"
            style={{ fontFamily: 'var(--mc-font-mono)' }}
          >
            MineCraft Creator — 创造你的方块世界 // 1234567890
          </p>
          <p className="mt-1 text-[11px] text-mc-mute">
            缺失 Monocraft.ttf 时自动回退到 VT323 像素等宽字体。
          </p>
        </section>
      </div>
    </div>
  );
}
