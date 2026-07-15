import { useState, useEffect } from 'react';
import { useModelConfigStore } from '../store/model-config-store.js';
import { ipcClient } from '../lib/ipc-client.js';

interface Props {
  onClose: () => void;
}

/** 模型预设（P18：一键填充 Base URL + Model ID） */
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

  // P29：CurseForge API key（独立配置，不与 AI config 混）
  const [cfApiKey, setCfApiKey] = useState('');
  const [cfSaving, setCfSaving] = useState(false);
  const [cfSaved, setCfSaved] = useState(false);

  useEffect(() => {
    ipcClient.loadModelConfig().then((c: any) => {
      setConfig(c);
      setForm(c);
    });
    // P29：加载 CurseForge 配置
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

  /** 应用预设：填充 name/baseURL/modelId，apiKey 留空让用户填 */
  const applyPreset = (p: Preset) => {
    setForm((prev) => ({ ...prev, name: p.name, baseURL: p.baseURL, modelId: p.modelId }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">模型配置</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>

        {/* P18：预设按钮 */}
        <div className="mb-4">
          <div className="mb-2 text-xs text-zinc-400">快速预设（点击填充）：</div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:border-blue-500 hover:text-white"
                title={p.local ? `本地模型，需先安装 ${p.name.split(' ')[0]}` : `云端：${p.baseURL}`}
              >
                {p.local && <span className="mr-1 text-green-400">●</span>}
                {p.name}
              </button>
            ))}
          </div>
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

        {/* P29：CurseForge API key（独立保存，不与 AI config 混） */}
        <div className="mt-6 border-t border-zinc-800 pt-4">
          <h3 className="mb-2 text-sm font-bold text-zinc-100">CurseForge 配置</h3>
          <div>
            <label className="text-xs text-zinc-400">
              CurseForge API Key（去{' '}
              <a
                href="https://console.curseforge.com/"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline"
              >
                console.curseforge.com
              </a>{' '}
              免费申请）
            </label>
            <input
              type="password"
              value={cfApiKey}
              onChange={(e) => setCfApiKey(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="$2a$10$..."
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveCfConfig}
              disabled={cfSaving}
              className="rounded bg-orange-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {cfSaving ? '保存中…' : '保存 CurseForge 配置'}
            </button>
            {cfSaved && <span className="text-sm text-green-400">已保存</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
