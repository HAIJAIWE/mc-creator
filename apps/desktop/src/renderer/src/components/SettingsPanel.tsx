import { useState, useEffect } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModelConfigStore } from '../store/model-config-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { Circle } from 'lucide-react';

interface Props {
  onClose: () => void;
}

interface Preset {
  name: string;
  baseURL: string;
  modelId: string;
  apiKeyPlaceholder?: string;
  local?: boolean;
}

const PRESETS: Preset[] = [
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini', apiKeyPlaceholder: 'sk-...' },
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', modelId: 'deepseek-chat', apiKeyPlaceholder: 'sk-...' },
  { name: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-plus', apiKeyPlaceholder: 'sk-...' },
  { name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', modelId: 'glm-4-flash', apiKeyPlaceholder: '...' },
  { name: 'Ollama (本地)', baseURL: 'http://localhost:11434/v1', modelId: 'qwen2.5:7b', local: true },
  { name: 'LM Studio (本地)', baseURL: 'http://localhost:1234/v1', modelId: 'local-model', local: true },
];

export function SettingsPanel({ onClose }: Props) {
  const { name, modelId, baseURL, apiKey, setConfig } = useModelConfigStore();
  const [form, setForm] = useState({ name, modelId, baseURL, apiKey });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [cfApiKey, setCfApiKey] = useState('');
  const [cfSaving, setCfSaving] = useState(false);
  const [cfSaved, setCfSaved] = useState(false);

  useEffect(() => {
    ipcClient.loadModelConfig().then((c: any) => {
      setConfig(c);
      setForm(c);
    });
    ipcClient.loadCurseForgeConfig().then((c) => setCfApiKey(c.apiKey));
  }, [setConfig]);

  const save = async () => {
    setSaving(true);
    await ipcClient.saveModelConfig(form);
    setConfig(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveCfConfig = async () => {
    setCfSaving(true);
    await ipcClient.saveCurseForgeConfig({ apiKey: cfApiKey });
    setCfSaving(false);
    setCfSaved(true);
    setTimeout(() => setCfSaved(false), 2000);
  };

  const applyPreset = (p: Preset) => {
    setForm((prev) => ({ ...prev, name: p.name, baseURL: p.baseURL, modelId: p.modelId }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-[480px] max-w-full rounded-mc-lg border border-mc-border-strong bg-mc-surface p-6 text-mc-text shadow-mc-pop animate-mc-dialog-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">模型配置</h2>
          <button onClick={onClose} className="text-mc-mute transition-colors hover:text-mc-text" aria-label="关闭"><McIcon scope="pixel" name="close" size={16} /></button>
        </div>

        <div className="mb-4">
          <div className="mb-2 text-xs text-mc-mute">快速预设（点击填充）：</div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="mc-btn-ghost !py-1 !text-xs"
                title={p.local ? `本地模型，需先安装 ${p.name.split(' ')[0]}` : `云端：${p.baseURL}`}
              >
                {p.local && <span className="mr-1 text-mc-accent"><Circle className="h-3 w-3 fill-current" /></span>}
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-mc-dim">配置名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mc-input"
              placeholder="如 DeepSeek"
            />
          </div>
          <div>
            <label className="text-sm text-mc-dim">模型 ID</label>
            <input
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              className="mc-input"
              placeholder="如 gpt-4o-mini, deepseek-chat"
            />
          </div>
          <div>
            <label className="text-sm text-mc-dim">Base URL</label>
            <input
              value={form.baseURL}
              onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
              className="mc-input"
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="text-sm text-mc-dim">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="mc-input"
              placeholder="sk-..."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="mc-btn-primary">
            {saving ? '保存中…' : '保存'}
          </button>
          {saved && <span className="text-sm text-mc-accent">已保存</span>}
        </div>

        <div className="mt-6 border-t border-mc-border pt-4">
          <h3 className="mb-2 text-sm font-bold text-mc-text">CurseForge 配置</h3>
          <div>
            <label className="text-xs text-mc-dim">
              CurseForge API Key（去{' '}
              <a href="https://console.curseforge.com/" target="_blank" rel="noreferrer" className="text-mc-accent hover:underline">
                console.curseforge.com
              </a>{' '}
              免费申请）
            </label>
            <input
              type="password"
              value={cfApiKey}
              onChange={(e) => setCfApiKey(e.target.value)}
              className="mc-input"
              placeholder="$2a$10$..."
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={saveCfConfig} disabled={cfSaving} className="mc-btn-primary">
              {cfSaving ? '保存中…' : '保存 CurseForge 配置'}
            </button>
            {cfSaved && <span className="text-sm text-mc-accent">已保存</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
