import { useState, useEffect } from 'react';
import {
  LayoutGrid,
  LayoutPanelTop,
  PanelRight,
  LayoutList,
  Circle,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModelConfigStore } from '../store/model-config-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import {
  MC_THEMES,
  applyTheme,
  applyColorMode,
  getCurrentMode,
  getCurrentThemeId,
  getEffectiveMode,
  getSystemMode,
  type ColorMode,
} from '../lib/themes.js';
import type { ModelConfigRes } from '../../../shared/ipc-channels.js';

interface SettingsPanelProps {
  leftWidth: number;
  rightWidth: number;
  onLeftWidthChange: (width: number) => void;
  onRightWidthChange: (width: number) => void;
}

interface Preset {
  name: string;
  baseURL: string;
  modelId: string;
  apiKeyPlaceholder?: string;
  local?: boolean;
}

const MODEL_PRESETS: Preset[] = [
  {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen-plus',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    modelId: 'glm-4-flash',
    apiKeyPlaceholder: '...',
  },
  {
    name: 'Ollama (本地)',
    baseURL: 'http://localhost:11434/v1',
    modelId: 'qwen2.5:7b',
    local: true,
  },
  {
    name: 'LM Studio (本地)',
    baseURL: 'http://localhost:1234/v1',
    modelId: 'local-model',
    local: true,
  },
];

const LAYOUT_PRESETS = [
  {
    id: 'full',
    name: '全屏',
    icon: LayoutList,
    description: '只显示中间编辑器',
    left: 0,
    right: 0,
  },
  {
    id: 'left',
    name: '左侧',
    icon: LayoutPanelTop,
    description: '左侧文件树 + 中间编辑器',
    left: 200,
    right: 0,
  },
  {
    id: 'right',
    name: '右侧',
    icon: PanelRight,
    description: '中间编辑器 + 右侧面板',
    left: 0,
    right: 360,
  },
  {
    id: 'both',
    name: '三栏',
    icon: LayoutGrid,
    description: '左侧文件树 + 中间编辑器 + 右侧面板',
    left: 200,
    right: 360,
  },
];

type Tab = 'model' | 'curseforge' | 'appearance';

export function SettingsPanel({
  leftWidth,
  rightWidth,
  onLeftWidthChange,
  onRightWidthChange,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('model');

  // === 模型配置 ===
  const { name, modelId, baseURL, apiKey, setConfig } = useModelConfigStore();
  const [form, setForm] = useState({ name, modelId, baseURL, apiKey });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // === CurseForge 配置 ===
  const [cfApiKey, setCfApiKey] = useState('');
  const [cfSaving, setCfSaving] = useState(false);
  const [cfSaved, setCfSaved] = useState(false);

  // === 外观：颜色模式 + 主题 ===
  const [activeMode, setActiveMode] = useState<ColorMode>(() => getCurrentMode());
  const [effectiveMode, setEffectiveMode] = useState<'light' | 'dark'>(() =>
    getEffectiveMode(getCurrentMode()),
  );
  const [activeTheme, setActiveTheme] = useState<string>(() =>
    getCurrentThemeId(getEffectiveMode(getCurrentMode())),
  );

  useEffect(() => {
    ipcClient.loadModelConfig().then((c: ModelConfigRes) => {
      setConfig(c);
      setForm(c);
    });
    ipcClient.loadCurseForgeConfig().then((c) => setCfApiKey(c.apiKey));
  }, [setConfig]);

  // 系统模式变化时（仅 system 模式下）同步 UI 状态：effectiveMode + activeTheme
  useEffect(() => {
    if (activeMode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const newEffective = getSystemMode();
      setEffectiveMode(newEffective);
      setActiveTheme(getCurrentThemeId(newEffective));
    };
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
    else if (typeof mql.addListener === 'function') mql.addListener(handler);
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', handler);
      else if (typeof mql.removeListener === 'function') mql.removeListener(handler);
    };
  }, [activeMode]);

  const saveModel = async () => {
    setSaving(true);
    await ipcClient.saveModelConfig(form);
    setConfig(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveCf = async () => {
    setCfSaving(true);
    await ipcClient.saveCurseForgeConfig({ apiKey: cfApiKey });
    setCfSaving(false);
    setCfSaved(true);
    setTimeout(() => setCfSaved(false), 2000);
  };

  const applyModelPreset = (p: Preset) => {
    setForm((prev) => ({ ...prev, name: p.name, baseURL: p.baseURL, modelId: p.modelId }));
  };

  const applyLayoutPreset = (preset: (typeof LAYOUT_PRESETS)[0]) => {
    onLeftWidthChange(preset.left);
    onRightWidthChange(preset.right);
  };

  const setTheme = (id: string) => {
    applyTheme(id);
    setActiveTheme(id);
  };

  const setMode = (mode: ColorMode) => {
    applyColorMode(mode);
    setActiveMode(mode);
    const newEffective = getEffectiveMode(mode);
    setEffectiveMode(newEffective);
    setActiveTheme(getCurrentThemeId(newEffective));
  };

  const getCurrentPreset = () => {
    if (leftWidth === 0 && rightWidth === 0) return 'full';
    if (leftWidth > 0 && rightWidth === 0) return 'left';
    if (leftWidth === 0 && rightWidth > 0) return 'right';
    return 'both';
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="settings-cog" size={16} className="text-mc-accent" />
        <span className="text-xs font-semibold text-mc-text">设置</span>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-mc-border">
        {(
          [
            { id: 'model', label: '模型' },
            { id: 'curseforge', label: 'CurseForge' },
            { id: 'appearance', label: '外观' },
          ] as { id: Tab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-mc-surface-2 text-mc-text'
                : 'text-mc-text-dim hover:text-mc-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Tab 1: 模型配置 */}
        {activeTab === 'model' && (
          <div className="space-y-3">
            <div>
              <div className="mb-2 text-xs text-mc-mute">快速预设（点击填充）：</div>
              <div className="flex flex-wrap gap-1.5">
                {MODEL_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => applyModelPreset(p)}
                    className="mc-btn-ghost !py-1 !text-xs"
                    title={
                      p.local ? `本地模型，需先安装 ${p.name.split(' ')[0]}` : `云端：${p.baseURL}`
                    }
                  >
                    {p.local && <Circle className="mr-1 h-3 w-3 fill-current text-mc-accent" />}
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-mc-dim">配置名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mc-input"
                placeholder="如 DeepSeek"
              />
            </div>
            <div>
              <label className="text-xs text-mc-dim">模型 ID</label>
              <input
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                className="mc-input"
                placeholder="如 gpt-4o-mini, deepseek-chat"
              />
            </div>
            <div>
              <label className="text-xs text-mc-dim">Base URL</label>
              <input
                value={form.baseURL}
                onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                className="mc-input"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="text-xs text-mc-dim">API Key</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className="mc-input"
                placeholder="sk-..."
              />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={saveModel} disabled={saving} className="mc-btn-primary">
                {saving ? '保存中…' : '保存'}
              </button>
              {saved && <span className="text-xs text-mc-accent">已保存</span>}
            </div>
          </div>
        )}

        {/* Tab 2: CurseForge */}
        {activeTab === 'curseforge' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-mc-dim">
                CurseForge API Key（去{' '}
                <a
                  href="https://console.curseforge.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-mc-accent hover:underline"
                >
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
            <div className="flex items-center gap-2">
              <button onClick={saveCf} disabled={cfSaving} className="mc-btn-primary">
                {cfSaving ? '保存中…' : '保存'}
              </button>
              {cfSaved && <span className="text-xs text-mc-accent">已保存</span>}
            </div>
          </div>
        )}

        {/* Tab 3: 外观 */}
        {activeTab === 'appearance' && (
          <div className="space-y-4">
            {/* 布局预设 */}
            <div>
              <div className="mb-2 text-xs font-medium text-mc-text">布局预设</div>
              <div className="space-y-1.5">
                {LAYOUT_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  const isActive = getCurrentPreset() === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => applyLayoutPreset(preset)}
                      className={`flex items-center gap-2 rounded-mc p-2 transition-all ${
                        isActive
                          ? 'bg-mc-accent/20 border border-mc-accent/50'
                          : 'bg-mc-surface-2/50 border border-transparent hover:bg-mc-surface-2'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${isActive ? 'text-mc-accent' : 'text-mc-text-dim'}`}
                      />
                      <div className="flex-1 text-left">
                        <div
                          className={`text-xs font-medium ${isActive ? 'text-mc-accent-bright' : 'text-mc-text'}`}
                        >
                          {preset.name}
                        </div>
                        <div className="text-xs text-mc-text-dim">{preset.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 面板尺寸 */}
            <div>
              <div className="mb-2 text-xs font-medium text-mc-text">面板尺寸</div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-mc-dim">左侧</span>
                    <span className="text-xs text-mc-text-dim">{leftWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="400"
                    value={leftWidth}
                    onChange={(e) => onLeftWidthChange(parseInt(e.target.value))}
                    className="w-full h-2 rounded-full bg-mc-surface-3 appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-mc-dim">右侧</span>
                    <span className="text-xs text-mc-text-dim">{rightWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="560"
                    value={rightWidth}
                    onChange={(e) => onRightWidthChange(parseInt(e.target.value))}
                    className="w-full h-2 rounded-full bg-mc-surface-3 appearance-none cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* 颜色模式 */}
            <div>
              <div className="mb-2 text-xs font-medium text-mc-text">颜色模式</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'light', label: '亮色', icon: Sun },
                    { id: 'dark', label: '暗色', icon: Moon },
                    { id: 'system', label: '跟随系统', icon: Monitor },
                  ] as { id: ColorMode; label: string; icon: typeof Sun }[]
                ).map((m) => {
                  const Icon = m.icon;
                  const isActive = activeMode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-mc p-2 text-xs font-medium transition-all border ${
                        isActive
                          ? 'bg-mc-accent/15 border-mc-accent/50 text-mc-accent-bright'
                          : 'bg-mc-surface-2/50 border-transparent text-mc-text-dim hover:bg-mc-surface-2 hover:text-mc-text'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 主题颜色 */}
            <div>
              <div className="mb-2 text-xs font-medium text-mc-text">主题颜色</div>
              <div className="space-y-1.5">
                {MC_THEMES.filter((t) => t.mode === effectiveMode).map((theme) => {
                  const isActive = activeTheme === theme.id;
                  const a = theme.vars['--mc-accent'];
                  const d = theme.vars['--mc-accent-deep'];
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setTheme(theme.id)}
                      className={`flex items-center gap-2 rounded-mc p-2 text-left transition-all border ${
                        isActive
                          ? 'bg-mc-accent/15 border-mc-accent/50'
                          : 'bg-mc-surface-2/50 border-transparent hover:bg-mc-surface-2'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-2.5 w-5 rounded-sm"
                          style={{ backgroundColor: `rgb(${a})` }}
                        />
                        <div
                          className="h-2.5 w-5 rounded-sm"
                          style={{ backgroundColor: `rgb(${d})` }}
                        />
                      </div>
                      <div className="flex-1">
                        <div
                          className={`text-xs font-medium ${isActive ? 'text-mc-accent-bright' : 'text-mc-text'}`}
                        >
                          {theme.name}
                        </div>
                      </div>
                      {isActive && (
                        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-mc-accent">
                          <svg
                            className="h-2.5 w-2.5 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-mc-border pt-2">
              <div className="text-xs text-mc-text-dim text-center">
                提示：拖动面板边缘也可以调整宽度
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
