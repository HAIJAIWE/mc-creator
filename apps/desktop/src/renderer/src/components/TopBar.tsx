import { useState } from 'react';
import { useModStore } from '../store/mod-store.js';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';
import { SettingsPanel } from './SettingsPanel.js';

export function TopBar() {
  const { loader, mcVersion, setLoader, setMcVersion, loading, generatorType, setGeneratorType } = useModStore();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <header className="flex items-center gap-4 border-b border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-100">
      <span className="text-lg font-bold">MC Creator</span>
      <div className="flex items-center gap-2">
        <label className="text-sm">类型:</label>
        <select
          value={generatorType}
          onChange={(e) => setGeneratorType(e.target.value as 'mod' | 'datapack' | 'modpack')}
          disabled={loading}
          className="rounded bg-zinc-800 px-2 py-1 text-sm"
        >
          <option value="mod">Mod</option>
          <option value="datapack">数据包</option>
          <option value="modpack">整合包</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm">Loader:</label>
        <select
          value={loader}
          onChange={(e) => setLoader(e.target.value as Loader)}
          disabled={loading}
          className="rounded bg-zinc-800 px-2 py-1 text-sm"
        >
          <option value="fabric">Fabric</option>
          <option value="neoforge">NeoForge</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm">MC 版本:</label>
        <select
          value={mcVersion}
          onChange={(e) => setMcVersion(e.target.value as McVersion)}
          disabled={loading}
          className="rounded bg-zinc-800 px-2 py-1 text-sm"
        >
          {MC_VERSIONS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
      <button onClick={() => setShowSettings(true)} className="ml-auto text-sm text-zinc-400 hover:text-white">
        设置
      </button>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </header>
  );
}
