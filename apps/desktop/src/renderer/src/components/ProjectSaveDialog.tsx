import { useState, useEffect } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useProjectStore } from '../store/project-store.js';
import { useModStore } from '../store/mod-store.js';
import type { GeneratorType } from '../../../shared/ipc-channels.js';


interface Props {
  onClose: () => void;
}

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
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setErrMsg(null);
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
    } catch (e) {
      setErrMsg((e as Error).message);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-[420px] max-w-full rounded-mc-lg border border-mc-border-strong bg-mc-surface p-6 text-mc-text shadow-mc-pop animate-mc-dialog-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">保存项目</h2>
          <button onClick={onClose} className="text-mc-mute transition-colors hover:text-mc-text" aria-label="关闭"><McIcon scope="pixel" name="close" size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-mc-dim">项目名称</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              className="mc-input"
              placeholder="输入项目名称"
            />
          </div>
          {errMsg && (
            <div className="rounded-mc-lg border border-mc-redstone bg-mc-redstone/15 px-3 py-2 text-sm text-mc-redstone">
              保存失败：{errMsg}
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={handleSave} disabled={saving || !name.trim()} className="mc-btn-primary">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
