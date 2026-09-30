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
  Globe,
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
import type { ModelProfile } from '../../../shared/ipc-channels.js';
import { getLocale, setLocale, getAvailableLocales, getLocaleDisplayName } from '../i18n.js';
import { useTranslation } from '../hooks/useTranslation.js';

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
  /** 该 provider 的常用模型（用于 modelId 下拉提示） */
  models?: string[];
}

const MODEL_PRESETS: Preset[] = [
  {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-flash',
    apiKeyPlaceholder: 'sk-...',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  {
    name: 'Kimi（月之暗面）',
    baseURL: 'https://api.moonshot.cn/v1',
    modelId: 'kimi-k2.5',
    apiKeyPlaceholder: 'sk-...',
    models: ['kimi-k2.5', 'kimi-k3', 'kimi-k3-max', 'kimi-k2.7-code'],
  },
  {
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen3.5-plus',
    apiKeyPlaceholder: 'sk-...',
    models: ['qwen3.5-plus', 'qwen3.8-max', 'qwen3.7-max-preview'],
  },
  {
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    modelId: 'glm-5.3-flash',
    apiKeyPlaceholder: '...',
    models: ['glm-5.3-flash', 'glm-5.3-max', 'glm-5.2', 'glm-5'],
  },
  {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    modelId: 'gpt-5.6-luna',
    apiKeyPlaceholder: 'sk-...',
    models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  },
  {
    name: 'Ollama (本地)',
    baseURL: 'http://localhost:11434/v1',
    modelId: 'qwen3:8b',
    local: true,
    models: ['qwen3:8b', 'qwen2.5:7b', 'deepseek-r1:8b', 'llama3.1:8b'],
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
  const { t, tCommon } = useTranslation();

  // === 模型配置（多套并存，可切换/测试） ===
  const { setConfig, setProfiles, profiles, activeId } = useModelConfigStore();
  // 正在编辑的配置 id（null = 新建）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', modelId: '', baseURL: '', apiKey: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    ipcClient
      .listModelProfiles<{ profiles: ModelProfile[]; activeId: string | null }>()
      .then((r) => {
        setProfiles(r.profiles, r.activeId);
        const first = r.profiles[0] ?? null;
        setEditingId(first?.id ?? null);
        setForm(
          first
            ? {
                name: first.name,
                modelId: first.modelId,
                baseURL: first.baseURL,
                apiKey: first.apiKey,
              }
            : { name: '', modelId: '', baseURL: '', apiKey: '' },
        );
      });
    ipcClient.loadCurseForgeConfig().then((c) => setCfApiKey(c.apiKey));
  }, [setConfig, setProfiles]);

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
    setTestResult(null);
    const existing = profiles.find((p) => p.id === editingId) ?? null;
    const id = editingId ?? `p_${Date.now().toString(36)}`;
    const next: ModelProfile = {
      id,
      name: form.name.trim() || existing?.name || '未命名配置',
      modelId: form.modelId.trim(),
      baseURL: form.baseURL.trim(),
      // 留空 = 保留已存 Key（避免误清空）
      apiKey: form.apiKey || existing?.apiKey || '',
    };
    if (!next.modelId || !next.baseURL) {
      setTestResult({ ok: false, message: '请填写模型 ID 与 Base URL' });
      setSaving(false);
      return;
    }
    const list = existing ? profiles.map((p) => (p.id === id ? next : p)) : [...profiles, next];
    const active = activeId ?? id;
    await ipcClient.saveModelProfiles({ profiles: list, activeId: active });
    setProfiles(list, active);
    setEditingId(id);
    setForm(next);
    // 同步给运行时（顶部 API 状态/模型对比/生成均读取当前配置）
    setConfig({
      name: next.name,
      modelId: next.modelId,
      baseURL: next.baseURL,
      apiKey: next.apiKey,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  /** 切换生效配置（不弹窗，直接落盘 + 刷新运行时） */
  const activateProfile = async (id: string) => {
    const target = profiles.find((p) => p.id === id);
    if (!target) return;
    await ipcClient.saveModelProfiles({ profiles, activeId: id });
    setProfiles(profiles, id);
    setEditingId(id);
    setForm({
      name: target.name,
      modelId: target.modelId,
      baseURL: target.baseURL,
      apiKey: target.apiKey,
    });
    setTestResult(null);
  };

  const removeProfile = async (id: string) => {
    const list = profiles.filter((p) => p.id !== id);
    if (list.length === 0) {
      setProfiles([], null);
      setEditingId(null);
      setForm({ name: '', modelId: '', baseURL: '', apiKey: '' });
      return;
    }
    const active = activeId === id ? list[0].id : activeId;
    const nextActive = active ?? list[0].id;
    await ipcClient.saveModelProfiles({ profiles: list, activeId: nextActive });
    if (editingId === id) {
      setEditingId(list[0].id);
      setForm({
        name: list[0].name,
        modelId: list[0].modelId,
        baseURL: list[0].baseURL,
        apiKey: list[0].apiKey,
      });
    }
    setProfiles(list, nextActive);
    setTestResult(null);
  };

  const newProfile = () => {
    setEditingId(null);
    setForm({ name: '', modelId: '', baseURL: '', apiKey: '' });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const existing = profiles.find((p) => p.id === editingId);
    const key = form.apiKey || existing?.apiKey || '';
    try {
      const r = await ipcClient.testModelConnection({
        baseURL: form.baseURL,
        modelId: form.modelId,
        apiKey: key,
      });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const applyModelPreset = (p: Preset) => {
    // 仅当正在新建或表单仍为空时自动填 name；已有名字保留（允许同名多套）
    setForm((prev) => ({
      ...prev,
      name: prev.name || p.name,
      baseURL: p.baseURL,
      modelId: p.modelId,
    }));
    setTestResult(null);
  };

  const saveCf = async () => {
    setCfSaving(true);
    await ipcClient.saveCurseForgeConfig({ apiKey: cfApiKey });
    setCfSaving(false);
    setCfSaved(true);
    setTimeout(() => setCfSaved(false), 2000);
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
        <span className="text-xs font-semibold text-mc-text">{tCommon('settings')}</span>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-mc-border">
        {(
          [
            { id: 'model', label: tCommon('model') },
            { id: 'curseforge', label: 'CurseForge' },
            { id: 'appearance', label: tCommon('appearance') },
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
        {/* Tab 1: 模型配置（多套并存 + 切换 + 测试） */}
        {activeTab === 'model' && (
          <div className="space-y-3">
            {/* 配置列表 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-mc-mute">已保存配置（点击即切换为生效项）：</span>
                <button
                  type="button"
                  onClick={newProfile}
                  className="mc-btn-ghost !py-0.5 !text-xs"
                >
                  + 新建配置
                </button>
              </div>
              {profiles.length === 0 ? (
                <div className="rounded-mc border border-dashed border-mc-border p-2 text-xs text-mc-mute">
                  {t('settings.noProfiles')}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void activateProfile(p.id)}
                      className={`inline-flex items-center gap-1 rounded-mc px-2 py-1 text-xs transition-colors ${
                        activeId === p.id
                          ? 'bg-mc-accent text-white'
                          : 'bg-mc-surface-2 text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                      }`}
                      title={t('settings.switchToActive', { baseURL: p.baseURL })}
                    >
                      {p.name}
                      {activeId === p.id && <span aria-hidden="true">✓</span>}
                      <span
                        role="button"
                        aria-label={t('settings.deleteProfile', { name: p.name })}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeProfile(p.id);
                        }}
                        className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
                      >
                        ✕
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {testResult && (
                <div
                  role="status"
                  className={`mt-2 rounded-mc px-2 py-1 text-xs ${
                    testResult.ok
                      ? 'bg-mc-accent/15 text-mc-accent-bright'
                      : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {testResult.ok ? '✓' : '✗'} {testResult.message}
                </div>
              )}
            </div>

            {/* 服务商快速预设 */}
            <div>
              <div className="mb-2 text-xs text-mc-mute">{t('settings.providerPresets')}</div>
              <div className="flex flex-wrap gap-1.5">
                {MODEL_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => applyModelPreset(p)}
                    className="mc-btn-ghost !py-1 !text-xs"
                    title={
                      p.local
                        ? t('settings.localModel', { name: p.name.split(' ')[0] })
                        : t('settings.cloudProvider', { baseURL: p.baseURL })
                    }
                  >
                    {p.local && <Circle className="mr-1 h-3 w-3 fill-current text-mc-accent" />}
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-mc-dim">{t('settings.configName')}</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mc-input"
                placeholder={t('settings.configNamePlaceholder')}
                aria-label={t('settings.configName')}
              />
            </div>
            <div>
              <label className="text-xs text-mc-dim">{t('settings.modelId')}</label>
              <input
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                className="mc-input"
                placeholder={t('settings.modelIdPlaceholder')}
                list="model-options"
                aria-label={t('settings.modelId')}
              />
              <datalist id="model-options">
                {MODEL_PRESETS.flatMap((p) => p.models ?? [p.modelId]).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-mc-dim">{t('settings.baseUrl')}</label>
              <input
                value={form.baseURL}
                onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                className="mc-input"
                placeholder="https://api.openai.com/v1"
                aria-label={t('settings.baseUrl')}
              />
            </div>
            <div>
              <label className="text-xs text-mc-dim">{t('settings.apiKey')}</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className="mc-input"
                placeholder={t('settings.apiKeyPlaceholder')}
                aria-label={t('settings.apiKey')}
              />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={saveModel} disabled={saving} className="mc-btn-primary">
                {saving ? tCommon('saving') : tCommon('save')}
              </button>
              <button
                onClick={handleTestConnection}
                disabled={testing || !form.baseURL || !form.modelId}
                className="mc-btn-ghost"
              >
                {testing ? tCommon('testing') : t('settings.testConnection')}
              </button>
              {saved && <span className="text-xs text-mc-accent">{tCommon('saved')}</span>}
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
                {t('settings.curseforgeFreeApply')}）
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
                {cfSaving ? tCommon('saving') : tCommon('save')}
              </button>
              {cfSaved && <span className="text-xs text-mc-accent">{tCommon('saved')}</span>}
            </div>
          </div>
        )}

        {/* Tab 3: 外观 */}
        {activeTab === 'appearance' && (
          <div className="space-y-4">
            {/* 布局预设 */}
            <div>
              <div className="mb-2 text-xs font-medium text-mc-text">
                {t('settings.layoutPresets')}
              </div>
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
              <div className="mb-2 text-xs font-medium text-mc-text">{t('settings.panelSize')}</div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-mc-dim">{t('settings.leftPanel')}</span>
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
                    <span className="text-xs text-mc-dim">{t('settings.rightPanel')}</span>
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
              <div className="mb-2 text-xs font-medium text-mc-text">{t('settings.colorMode')}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'light', label: t('settings.lightMode'), icon: Sun },
                    { id: 'dark', label: t('settings.darkMode'), icon: Moon },
                    { id: 'system', label: t('settings.systemMode'), icon: Monitor },
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
              <div className="mb-2 text-xs font-medium text-mc-text">
                {t('settings.themeColor')}
              </div>
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

            {/* 语言设置 */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-mc-text">
                <Globe className="h-3.5 w-3.5 text-mc-accent" />
                {tCommon('language')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {getAvailableLocales().map((loc) => {
                  const isActive = getLocale() === loc;
                  return (
                    <button
                      key={loc}
                      onClick={() => setLocale(loc)}
                      className={`flex items-center gap-1.5 rounded-mc px-2 py-1.5 text-xs transition-all border ${
                        isActive
                          ? 'bg-mc-accent/15 border-mc-accent/50 text-mc-accent-bright'
                          : 'bg-mc-surface-2/50 border-transparent text-mc-text-dim hover:bg-mc-surface-2 hover:text-mc-text'
                      }`}
                    >
                      {getLocaleDisplayName(loc)}
                      {isActive && (
                        <McIcon scope="pixel" name="check" size={12} className="text-mc-accent" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-mc-border pt-2">
              <div className="text-xs text-mc-text-dim text-center">
                {t('settings.dragToResizeHint')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
