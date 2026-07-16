import { useModStore } from '../store/mod-store.js';
import { McIcon } from '../assets/mc-ui/McIcon';

interface ModEntryLite {
  name: string;
  fileName?: string;
}
interface DepLite {
  id?: string;
  version?: string;
}

/** 包管理：展示当前 Mod 的环境依赖与（整合包）已添加模组 / 显式依赖。只读概览。 */
export function PackagesPanel() {
  const generatorType = useModStore((s) => s.generatorType);
  const loader = useModStore((s) => s.loader);
  const mcVersion = useModStore((s) => s.mcVersion);
  const spec = useModStore((s) => s.spec);

  const mods: ModEntryLite[] =
    spec && Array.isArray((spec as unknown as { mods?: ModEntryLite[] }).mods)
      ? (spec as unknown as { mods: ModEntryLite[] }).mods
      : [];
  const deps: DepLite[] =
    spec && Array.isArray((spec as unknown as { dependencies?: DepLite[] }).dependencies)
      ? (spec as unknown as { dependencies: DepLite[] }).dependencies
      : [];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mc-section-title border-b border-mc-border">环境依赖</div>
      <div className="space-y-1.5 p-3 text-xs">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="box" size={14} className="text-mc-mute" />
          <span className="text-mc-dim">加载器</span>
          <span className="ml-auto text-mc-text">{loader}</span>
        </div>
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="server" size={14} className="text-mc-mute" />
          <span className="text-mc-dim">游戏版本</span>
          <span className="ml-auto text-mc-text">{mcVersion}</span>
        </div>
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="package" size={14} className="text-mc-mute" />
          <span className="text-mc-dim">类型</span>
          <span className="ml-auto text-mc-text">{generatorType}</span>
        </div>
      </div>

      {generatorType === 'modpack' && (
        <>
          <div className="mc-section-title border-b border-mc-border">整合包模组（{mods.length}）</div>
          <div className="space-y-1 p-2">
            {mods.length === 0 ? (
              <div className="py-4 text-center text-xs text-mc-mute">尚未添加模组</div>
            ) : (
              mods.map((m, i) => (
                <div key={i} className="mc-card flex items-center gap-2 p-2 text-xs">
                  <McIcon scope="pixel" name="box" size={14} className="text-mc-mute" />
                  <span className="truncate text-mc-text">{m.name}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <div className="mc-section-title border-b border-mc-border">依赖（{deps.length}）</div>
      <div className="space-y-1 p-2">
        {deps.length === 0 ? (
          <div className="py-4 text-center text-xs text-mc-mute">无显式依赖</div>
        ) : (
          deps.map((d, i) => (
            <div key={i} className="mc-card flex items-center gap-2 p-2 text-xs">
              <McIcon scope="pixel" name="link" size={14} className="text-mc-mute" />
              <span className="truncate text-mc-text">{d.id ?? 'unknown'}</span>
              {d.version && <span className="ml-auto text-mc-dim">{d.version}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
