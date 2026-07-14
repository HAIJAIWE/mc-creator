import { useState, useEffect } from 'react';
import { useProjectStore } from '../store/project-store.js';
import { useModStore } from '../store/mod-store.js';
import type { GeneratorType } from '../../../shared/ipc-channels.js';

interface Props {
  onClose: () => void;
}

/** 计算预填名：<generatorType>-<modId 或 serverName 或 packName> */
function computeDefaultName(generatorType: GeneratorType, spec: unknown): string {
  const s = (spec ?? {}) as Record<string, unknown>;
  let suffix = '';
  if (generatorType === 'mod' || generatorType === 'server') {
    suffix = (s.modId as string) ?? (s.serverName as string) ?? '';
  } else {
    suffix = (s.packName as string) ?? (s.playerName as string) ?? '';
  }
  return suffix ? `${generatorType}-${suffix}` : generatorType;
}

export function ProjectSaveDialog({ onClose }: Props) {
  const generatorType = useModStore((s) => s.generatorType);
  const spec = useModStore((s) => s.spec);
  const loader = useModStore((s) => s.loader);
  const mcVersion = useModStore((s) => s.mcVersion);
  const description = useModStore((s) => s.description);
  const files = useModStore((s) => s.files);
  const saveCurrentAsProject = useProjectStore((s) => s.saveCurrentAsProject);

  const [name, setName] = useState(() => computeDefaultName(generatorType, spec));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await saveCurrentAsProject(name.trim(), {
        generatorType,
        loader,
        mcVersion,
        description,
        spec,
        files,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">保存项目</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-zinc-400">项目名称</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="输入项目名称"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
