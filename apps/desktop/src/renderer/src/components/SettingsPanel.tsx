import { useState, useEffect } from 'react';
import { useModelConfigStore } from '../store/model-config-store.js';
import { ipcClient } from '../lib/ipc-client.js';

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { name, modelId, baseURL, apiKey, setConfig } = useModelConfigStore();
  const [form, setForm] = useState({ name, modelId, baseURL, apiKey });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ipcClient.loadModelConfig().then((c: any) => {
      setConfig(c);
      setForm(c);
    });
  }, [setConfig]);

  const save = async () => {
    setSaving(true);
    await ipcClient.saveModelConfig(form);
    setConfig(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">模型配置</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-zinc-400">配置名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="如 DeepSeek"
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">模型 ID</label>
            <input
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="如 gpt-4o-mini, deepseek-chat"
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">Base URL</label>
            <input
              value={form.baseURL}
              onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="sk-..."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {saved && <span className="text-sm text-green-400">已保存</span>}
        </div>
      </div>
    </div>
  );
}
