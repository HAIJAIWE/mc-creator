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
import { LOADER_VERSIONS, MC_VERSIONS, type McVersion } from '@mc-creator/shared';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../store/mod-store.js';
import {
  GENERATOR_TYPES,
  GENERATOR_DESCRIPTORS,
  pickLocalized,
} from '../../../shared/generator-descriptors.js';

/** 可预热的版本：只取 LOADER_VERSIONS 里有 forgeVersion 条目的（表即真相，不硬编码列表）。 */
const WARMABLE_VERSIONS = (Object.keys(LOADER_VERSIONS) as McVersion[]).filter(
  (v) =>
    typeof LOADER_VERSIONS[v].forgeVersion === 'string' && LOADER_VERSIONS[v].forgeVersion !== '',
);
import { getLocale, setLocale, getAvailableLocales, getLocaleDisplayName } from '../i18n';
import { useTranslation } from '../hooks/useTranslation.js';
import {
  useLayoutStore,
  selectLeftWidth,
  selectRightWidth,
  selectSetLeftWidth,
  selectSetRightWidth,
} from '../shell/layout-store.js';
import { generatorLoaderOptions } from '../../../shared/generator-descriptors.js';

interface Preset {
  name: string;
  baseURL: string;
  modelId: string;
  apiKeyPlaceholder?: string;
  local?: boolean;
  /** 该 provider 的常用模型（用于 modelId 下拉提示） */
  models?: string[];
}

export const MODEL_PRESETS: Preset[] = [
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
  {
    // 本地免费模型（dsh 转发，Ebony-Vinyl/dsh-our-free-model，MIT）：
    // 本机转发默认 http://127.0.0.1:18899/v1，端口被占用时 dsh 会顺延（以其控制台实际输出为准）；
    // Key 由用户从对方设置页生成后粘贴进 apiKey（走既有 safeStorage 加密落盘）；
    // 合规：提示词经本机转发最终发往 opencode.ai Zen 网关（对方 README 原话唯一上游）。
    // modelId / models[] 未经对方 /v1/models 实测 [待实测]，models[] 只是下拉提示，用户可手填。
    name: '本地免费模型（dsh 转发）',
    baseURL: 'http://127.0.0.1:18899/v1',
    modelId: 'deepseek-v4.1-flash', // [待实测] 以对方 /v1/models 实测为准
    apiKeyPlaceholder: '对方设置页生成的本地 Key',
    local: true,
    models: ['deepseek-v4.1-flash', 'kimi-k3'], // [待实测] 对方 README 点名款，仅下拉提示
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

/**
 * 设置分组。
 *
 * `warmup`（依赖预热）刻意**不放在 BuildPanel**：预热需要「MC 版本 + Forge 版本」，
 * 而 BuildPanel 不持有这个 —— 它的工程是生成出来的，版本只存在于 build.gradle 文本里。
 * 去解析用户工程的构建脚本来反推预热目标，等于让预热对象变成「用户工程」，
 * 而预热绝不能落在用户工程里（会写他的 build/、还可能被算进 lastBuildHash）。
 * 这里直接用 `LOADER_VERSIONS` 表做下拉 —— 数据来源唯一，不解析文本。
 */
type Tab = 'project' | 'model' | 'curseforge' | 'downloadSource' | 'appearance' | 'warmup';

export function SettingsPanel() {
  const leftWidth = useLayoutStore(selectLeftWidth);
  const rightWidth = useLayoutStore(selectRightWidth);
  const setLeftWidth = useLayoutStore(selectSetLeftWidth);
  const setRightWidth = useLayoutStore(selectSetRightWidth);
  // 默认落在「项目」—— 内容类型/加载器/版本原在 TopToolbar 的三个下拉框，
  // 按 IDE 惯例（VS Code / IntelliJ 顶部都不放项目配置）迁到这里，
  // 这里是它们**唯一**的编辑入口。
  const [activeTab, setActiveTab] = useState<Tab>('project');

  // === 项目配置（内容类型 / 加载器 / MC 版本）===
  // 这三个字段原先是 TopToolbar 中间的三个下拉框。按 IDE 惯例迁到这里：
  // VS Code 与 IntelliJ 的顶部都不放项目配置，且本组件此前**只读**这三个字段
  // （里面的 mcVersion 是「依赖预热」的局部 state，与项目版本无关），
  // 所以这里是它们唯一的编辑入口。底部 StatusBar 只做只读展示。
  const project = useModStore(
    (s) => ({
      generatorType: s.generatorType,
      loader: s.loader,
      mcVersion: s.mcVersion,
      loading: s.loading,
      setGeneratorType: s.setGeneratorType,
      setLoader: s.setLoader,
      setMcVersion: s.setMcVersion,
    }),
    shallow,
  );
  const needsLoader = GENERATOR_DESCRIPTORS[project.generatorType]?.needsLoader ?? false;

  // === 依赖预热（W3） ===
  // 只列 Forge 组合：devkit 的 warmForgeGradleCache 覆盖 ForgeGradle 6，
  // NeoForge（neoformruntime）与 Loom（工程内缓存）布局不同，**尚未支持**。
  // 下面文案必须如实说这一点，不能让用户以为「选哪个都能预热」。
  const [warmMcVersion, setWarmMcVersion] = useState<string>('1.20.1');
  const [warmRunning, setWarmRunning] = useState(false);
  const [warmMsg, setWarmMsg] = useState<string | null>(null);
  const [warmErr, setWarmErr] = useState<string | null>(null);
  const [warmDone, setWarmDone] = useState<boolean | null>(null);
  const { t, tCommon, locale } = useTranslation();

  // === 模型配置（多套并存，可切换/测试） ===
  const { setConfig, setProfiles, profiles, activeId } = useModelConfigStore();
  // 正在编辑的配置 id（null = 新建）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', modelId: '', baseURL: '', apiKey: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 预热进度订阅：卸载时必须退订，否则 setState 打到已卸载组件上。
  useEffect(() => {
    const requestId = `${warmMcVersion}-forge`;
    return ipcClient.onWarmDepsProgress((p) => {
      if (p.requestId !== requestId) return;
      setWarmMsg(p.text);
    });
  }, [warmMcVersion]);

  const startWarm = async () => {
    setWarmRunning(true);
    setWarmErr(null);
    setWarmDone(null);
    setWarmMsg('正在准备…');
    try {
      const r = await ipcClient.warmDeps(warmMcVersion, 'forge');
      if (r.aborted) {
        setWarmMsg('已取消');
      } else if (!r.ok) {
        setWarmErr(r.error ?? '未知原因');
      } else {
        setWarmDone(r.warmed);
        setWarmMsg(
          r.warmed
            ? `预热完成（${Math.round(r.elapsedMs / 1000)} 秒）`
            : '该版本已在缓存中，无需预热',
        );
      }
    } catch (e) {
      setWarmErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWarmRunning(false);
    }
  };

  // === CurseForge 配置 ===
  const [cfApiKey, setCfApiKey] = useState('');
  const [cfSaving, setCfSaving] = useState(false);
  const [cfSaved, setCfSaved] = useState(false);
  const [cfTesting, setCfTesting] = useState(false);
  const [cfTest, setCfTest] = useState<{ ok: boolean; error?: string | null } | null>(null);
  /**
   * 下载源偏好。默认 false = 国内镜像优先（与主进程 `DEFAULT_SOURCE_PREFERENCE`
   * 一致；这里只是**首帧**的占位值，挂载后会从主进程读回真实值）。
   */
  const [preferOfficial, setPreferOfficial] = useState(false);
  const [srcSaving, setSrcSaving] = useState(false);
  const [srcSaved, setSrcSaved] = useState(false);

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
    ipcClient.loadSourcePreference().then((p) => setPreferOfficial(p.preferOfficial));
  }, [setConfig, setProfiles]);

  // 系统模式变化时（仅 system 模式下）同步 UI 状态：effectiveMode + activeTheme
  useEffect(() => {
    if (activeMode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (_e?: MediaQueryListEvent) => {
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
    setCfTest(null);
    try {
      const apiKey = cfApiKey.trim();
      await ipcClient.saveCurseForgeConfig({ apiKey });
      // 把 trim 后的值回填，避免界面上留着一段「看起来有、实际没存」的空白
      setCfApiKey(apiKey);
      setCfSaved(true);
      setTimeout(() => setCfSaved(false), 2000);
    } finally {
      setCfSaving(false);
    }
  };

  /**
   * 测试 key。**强制走官方根**（主进程实现），所以镜像优先时也能测出这把
   * key 本身有没有效；测试不会保存，失败原因原样显示。
   */
  const testCf = async () => {
    const apiKey = cfApiKey.trim();
    if (apiKey === '') {
      setCfTest({ ok: false, error: '先填 API Key 再测试' });
      return;
    }
    setCfTesting(true);
    setCfTest(null);
    try {
      setCfTest(await ipcClient.curseforgeTestKey({ apiKey }));
    } catch (e) {
      setCfTest({ ok: false, error: (e as Error).message });
    } finally {
      setCfTesting(false);
    }
  };

  /**
   * 切换下载源。**立刻落盘**（没有「保存」按钮）：这是个即时生效的开关，
   * 让用户点完还要再点一次保存，只会让人怀疑到底切没切。
   */
  const chooseSourceOfficial = async (official: boolean) => {
    if (official === preferOfficial) return;
    setPreferOfficial(official);
    setSrcSaving(true);
    try {
      await ipcClient.saveSourcePreference({ preferOfficial: official });
      setSrcSaved(true);
      setTimeout(() => setSrcSaved(false), 2000);
    } finally {
      setSrcSaving(false);
    }
  };

  const applyLayoutPreset = (preset: (typeof LAYOUT_PRESETS)[0]) => {
    setLeftWidth(preset.left);
    setRightWidth(preset.right);
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
            { id: 'project', label: t('settings.projectSection') },
            { id: 'model', label: tCommon('model') },
            { id: 'curseforge', label: 'CurseForge' },
            { id: 'downloadSource', label: t('settings.downloadSource') },
            { id: 'appearance', label: tCommon('appearance') },
            { id: 'warmup', label: '依赖预热' },
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
        {/* Tab 0: 项目（内容类型 / 加载器 / MC 版本） */}
        {activeTab === 'project' && (
          <div className="space-y-4">
            <div className="rounded-mc border border-mc-border bg-mc-surface-2/40 p-2.5 text-[11px] leading-relaxed text-mc-mute">
              {t('settings.projectSectionHint')}
            </div>

            <div>
              <label htmlFor="settings-generator-type" className="mb-1 block text-xs text-mc-dim">
                {t('settings.contentType')}
              </label>
              <select
                id="settings-generator-type"
                value={project.generatorType}
                onChange={(e) =>
                  project.setGeneratorType(e.target.value as typeof project.generatorType)
                }
                disabled={project.loading}
                className="mc-select w-full"
              >
                {GENERATOR_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {pickLocalized(GENERATOR_DESCRIPTORS[value].label, locale)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="settings-loader" className="mb-1 block text-xs text-mc-dim">
                {t('settings.loader')}
              </label>
              <select
                id="settings-loader"
                value={project.loader}
                onChange={(e) => project.setLoader(e.target.value as typeof project.loader)}
                disabled={project.loading || !needsLoader}
                title={needsLoader ? undefined : t('settings.loaderNotApplicable')}
                className="mc-select w-full"
              >
                {generatorLoaderOptions(project.loader).map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="settings-mc-version" className="mb-1 block text-xs text-mc-dim">
                {t('settings.mcVersion')}
              </label>
              <select
                id="settings-mc-version"
                value={project.mcVersion}
                onChange={(e) => project.setMcVersion(e.target.value as typeof project.mcVersion)}
                disabled={project.loading}
                className="mc-select w-full"
              >
                {MC_VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

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
                CurseForge API Key（{t('settings.optional')} —— 去{' '}
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
                onChange={(e) => {
                  setCfApiKey(e.target.value);
                  // 输入变了，上一次的测试结论就不再对应当前内容
                  setCfTest(null);
                }}
                className="mc-input"
                placeholder="$2a$10$..."
              />
            </div>
            <p className="text-[10px] text-mc-text-dim">
              不填也能用 CurseForge：走国内镜像时用的是镜像自己的 key（PCL 同款做法）。
              填了不会自动切换下载源 —— 还挂在国内镜像上时，用的仍是镜像的 key；
              到「下载源」切到官方源，CurseForge 请求才会带上你填的这个 key。
              它只会发给官方地址，绝不转发给镜像。
            </p>
            <div className="flex items-center gap-2">
              <button onClick={saveCf} disabled={cfSaving} className="mc-btn-primary">
                {cfSaving ? tCommon('saving') : tCommon('save')}
              </button>
              <button
                onClick={() => void testCf()}
                disabled={cfTesting || cfApiKey.trim() === ''}
                className="mc-btn-ghost"
                title="用官方地址验证这把 key；不会保存，也不受「下载源」偏好影响"
              >
                {cfTesting ? '测试中…' : '测试'}
              </button>
              {cfSaved && <span className="text-xs text-mc-accent">{tCommon('saved')}</span>}
              {cfTest?.ok === true && (
                <span className="text-xs text-mc-green">key 可用（官方源）</span>
              )}
              {cfTest?.ok === false && (
                <span className="min-w-0 flex-1 break-all text-xs text-mc-redstone">
                  {cfTest.error ?? 'key 不可用'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: 下载源（官方 / 国内镜像）
            这里只放一个开关，理由见主进程 `download-sources.ts` 的 SourcePreference：
            两家镜像（BMCLAPI / MCIM）是同一件事，让用户跑两个地方各切一次是糟糕的 UI。 */}
        {activeTab === 'downloadSource' && (
          <div className="space-y-3">
            <div className="text-xs text-mc-text-dim">{t('settings.downloadSourceHint')}</div>
            <div className="space-y-1.5">
              {(
                [
                  {
                    official: false,
                    name: t('settings.downloadSourceMirror'),
                    desc: t('settings.downloadSourceMirrorDesc'),
                  },
                  {
                    official: true,
                    name: t('settings.downloadSourceOfficial'),
                    desc: t('settings.downloadSourceOfficialDesc'),
                  },
                ] as { official: boolean; name: string; desc: string }[]
              ).map((opt) => {
                const isActive = preferOfficial === opt.official;
                return (
                  <button
                    key={String(opt.official)}
                    onClick={() => void chooseSourceOfficial(opt.official)}
                    aria-pressed={isActive}
                    className={`w-full rounded-mc p-2 text-left transition-all ${
                      isActive
                        ? 'bg-mc-accent/20 border border-mc-accent/50'
                        : 'bg-mc-surface-2/50 border border-transparent hover:bg-mc-surface-2'
                    }`}
                  >
                    <div
                      className={`text-xs font-medium ${isActive ? 'text-mc-accent-bright' : 'text-mc-text'}`}
                    >
                      {opt.name}
                    </div>
                    <div className="text-xs text-mc-text-dim">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-mc-text-dim">{t('settings.downloadSourceTrust')}</p>
            {srcSaved && !srcSaving && (
              <span className="text-xs text-mc-accent" role="status">
                {tCommon('saved')}
              </span>
            )}
          </div>
        )}

        {/* Tab 4: 依赖预热（W3）
            文案要求：① 写清代价（385MB / 数分钟），否则用户被磁盘占用惊到；
            ② 说清只支持 Forge，NeoForge/Loom 尚未支持 —— 不给「选哪个都行」的错觉。 */}
        {activeTab === 'warmup' && (
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-medium text-mc-text">
                Gradle / ForgeGradle 依赖预热
              </div>
              <p className="mb-2 text-[10px] text-mc-mute">
                首次构建某个 MC 版本时，ForgeGradle 需要下载并反编译 Minecraft （实测冷启动 3 分 14
                秒）。预热会提前做完这一步，之后构建约 17 秒。
                <strong className="text-mc-text">代价：每个版本约占 385 MB 磁盘、需数分钟。</strong>
              </p>
              <label className="mb-1 block text-[10px] text-mc-dim" htmlFor="warm-mc-version">
                MC 版本（仅 Forge 支持预热）
              </label>
              <select
                id="warm-mc-version"
                value={warmMcVersion}
                onChange={(e) => setWarmMcVersion(e.target.value)}
                disabled={warmRunning}
                className="mc-input"
              >
                {WARMABLE_VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}（Forge {LOADER_VERSIONS[v as McVersion].forgeVersion}）
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-mc-mute">
                NeoForge 与 Fabric/Loom 的缓存布局不同，暂不支持预热；它们的首次构建仍需等待。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={startWarm} disabled={warmRunning} className="mc-btn-primary">
                {warmRunning ? '预热中…' : '预热该版本'}
              </button>
              {warmRunning && (
                <button
                  onClick={() => void ipcClient.cancelWarmDeps(`${warmMcVersion}-forge`)}
                  className="mc-btn-ghost"
                >
                  取消
                </button>
              )}
              {warmDone === true && (
                <span className="text-xs text-mc-accent" role="status">
                  已预热
                </span>
              )}
              {warmDone === false && (
                <span className="text-xs text-mc-mute" role="status">
                  已在缓存中
                </span>
              )}
            </div>
            {/* role=status 让屏幕阅读器也能听到阶段变化；反编译阶段几分钟无输出，
                文案已明确提示「请勿关闭窗口」，否则用户会以为卡死。 */}
            {warmMsg && (
              <p className="text-[10px] text-mc-dim" role="status">
                {warmMsg}
              </p>
            )}
            {warmErr && (
              <p className="text-[10px] text-red-400" role="alert">
                预热失败：{warmErr}
              </p>
            )}
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
                    onChange={(e) => setLeftWidth(parseInt(e.target.value))}
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
                    onChange={(e) => setRightWidth(parseInt(e.target.value))}
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
