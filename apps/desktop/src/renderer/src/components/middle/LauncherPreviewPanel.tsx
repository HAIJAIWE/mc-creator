import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import {
  EmptyState,
  FieldGroup,
  TextField,
  NumberField,
  SelectField,
  ToggleField,
  IconTabBar,
} from './shared/index.js';
import type { LauncherSpec } from '@mc-creator/shared';
import type { TabItem } from './shared/index.js';
import { Copy, Terminal, FileText, ChevronDown, ChevronRight } from 'lucide-react';

type SubTab = 'basic' | 'jvm' | 'account' | 'launch' | 'command';

const LAUNCHER_TABS: TabItem<SubTab>[] = [
  { key: 'basic', label: '基本' },
  { key: 'jvm', label: 'JVM' },
  { key: 'account', label: '账号' },
  { key: 'launch', label: '启动后' },
  { key: 'command', label: '启动命令' },
];

const LAUNCHER_TYPE_LABELS: Record<LauncherSpec['launcherType'], string> = {
  official: '官方启动器',
  pcl2: 'PCL2',
  hmcl: 'HMCL',
};

const LOADER_LABELS: Record<LauncherSpec['loader'], string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  legacy_fabric: 'Legacy Fabric',
};

/**
 * Launcher 预览面板：以分组表单展示 LauncherSpec 字段。
 * 增强：5 Tab 分类 + 启动命令生成 + 配置预览
 */
export function LauncherPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<SubTab>('basic');
  const [showCommand, setShowCommand] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [copied, setCopied] = useState(false);

  const launcher = spec as unknown as LauncherSpec | null;

  // 启动命令生成（必须在 early return 之前）
  const launchCommand = useMemo(() => {
    if (!launcher) return '';
    return generateLaunchCommand(launcher);
  }, [launcher]);

  // 启动器配置文件预览
  const configText = useMemo(() => {
    if (!launcher) return '';
    return generateLauncherConfig(launcher);
  }, [launcher]);

  if (!spec || !launcher) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成启动器 Spec"
        hint="在右侧 AgentPanel 描述你想要的启动器，生成 Spec 后即可预览"
      />
    );
  }

  const updateField = <K extends keyof LauncherSpec>(key: K, value: LauncherSpec[K]) => {
    const updated = { ...launcher, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  const copyCommand = () => {
    navigator.clipboard?.writeText(launchCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      {/* Header */}
      <div className="border-b border-mc-border px-4 py-3">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="box" size={16} className="text-mc-accent" />
          <span className="text-sm font-bold text-mc-text">{launcher.launcherName}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">{LAUNCHER_TYPE_LABELS[launcher.launcherType]}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">MC {launcher.mcVersion}</span>
          <span className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 text-[9px] text-mc-accent">
            {LOADER_LABELS[launcher.loader]}
          </span>
        </div>
        <div className="mt-1 text-xs text-mc-mute">配置文件: {launcher.profileName}</div>
      </div>

      {/* Tab 栏 */}
      <IconTabBar tabs={LAUNCHER_TABS} activeTab={activeTab} onSelect={setActiveTab} />

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeTab === 'basic' && (
          <FieldGroup title="基本">
            <TextField
              label="启动器名称"
              value={launcher.launcherName}
              onChange={(v) => updateField('launcherName', v)}
            />
            <SelectField
              label="启动器类型"
              value={launcher.launcherType}
              options={[
                { value: 'official', label: '官方启动器' },
                { value: 'pcl2', label: 'PCL2' },
                { value: 'hmcl', label: 'HMCL' },
              ]}
              onChange={(v) => updateField('launcherType', v as LauncherSpec['launcherType'])}
            />
            <TextField
              label="配置名称"
              value={launcher.profileName}
              onChange={(v) => updateField('profileName', v)}
            />
            <TextField
              label="MC 版本"
              value={launcher.mcVersion}
              onChange={(v) => updateField('mcVersion', v)}
            />
            <SelectField
              label="加载器"
              value={launcher.loader}
              options={[
                { value: 'vanilla', label: '原版' },
                { value: 'fabric', label: 'Fabric' },
                { value: 'neoforge', label: 'NeoForge' },
                { value: 'quilt', label: 'Quilt' },
                { value: 'legacy_fabric', label: 'Legacy Fabric' },
              ]}
              onChange={(v) => updateField('loader', v as LauncherSpec['loader'])}
            />
          </FieldGroup>
        )}

        {activeTab === 'jvm' && (
          <FieldGroup title="JVM">
            <TextField
              label="Java 路径"
              value={launcher.javaPath}
              onChange={(v) => updateField('javaPath', v)}
            />
            <TextField
              label="JVM 参数"
              value={launcher.jvmArgs}
              onChange={(v) => updateField('jvmArgs', v)}
            />
            <NumberField
              label="最小内存(MB)"
              value={launcher.memoryMin}
              min={512}
              max={32768}
              onChange={(v) => updateField('memoryMin', v)}
            />
            <NumberField
              label="最大内存(MB)"
              value={launcher.memoryMax}
              min={1024}
              max={32768}
              onChange={(v) => updateField('memoryMax', v)}
            />

            {/* 快速内存预设 */}
            <div className="mt-2">
              <div className="mb-1 text-[10px] text-mc-mute">快速预设</div>
              <div className="flex flex-wrap gap-1">
                {[
                  { label: '2GB', min: 512, max: 2048 },
                  { label: '4GB', min: 1024, max: 4096 },
                  { label: '8GB', min: 2048, max: 8192 },
                  { label: '16GB', min: 4096, max: 16384 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      updateField('memoryMin', preset.min);
                      updateField('memoryMax', preset.max);
                    }}
                    className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${
                      launcher.memoryMin === preset.min && launcher.memoryMax === preset.max
                        ? 'bg-mc-accent text-white'
                        : 'bg-mc-surface-2 text-mc-dim hover:text-mc-text'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </FieldGroup>
        )}

        {activeTab === 'account' && (
          <FieldGroup title="账号">
            <SelectField
              label="账号类型"
              value={launcher.accountType}
              options={[
                { value: 'offline', label: '离线' },
                { value: 'microsoft', label: '微软账号' },
              ]}
              onChange={(v) => updateField('accountType', v as LauncherSpec['accountType'])}
            />
            <TextField
              label="用户名"
              value={launcher.username}
              onChange={(v) => updateField('username', v)}
            />
            <TextField
              label="UUID"
              value={launcher.uuid}
              onChange={(v) => updateField('uuid', v)}
            />
            {launcher.accountType === 'offline' && (
              <div className="rounded-mc border border-yellow-500/30 bg-yellow-500/10 p-2 text-[10px] text-yellow-400">
                ⚠ 离线模式无法使用正版服务器、皮肤披风等在线功能
              </div>
            )}
          </FieldGroup>
        )}

        {activeTab === 'launch' && (
          <FieldGroup title="启动后">
            <TextField
              label="自动连接服务器"
              value={launcher.serverAutorun}
              onChange={(v) => updateField('serverAutorun', v)}
            />
            <ToggleField
              label="全屏"
              value={launcher.fullscreen}
              onChange={(v) => updateField('fullscreen', v)}
            />
            <NumberField
              label="分辨率宽"
              value={launcher.resolutionWidth}
              min={1}
              max={7680}
              onChange={(v) => updateField('resolutionWidth', v)}
            />
            <NumberField
              label="分辨率高"
              value={launcher.resolutionHeight}
              min={1}
              max={4320}
              onChange={(v) => updateField('resolutionHeight', v)}
            />

            {/* 分辨率预设 */}
            <div className="mt-2">
              <div className="mb-1 text-[10px] text-mc-mute">分辨率预设</div>
              <div className="flex flex-wrap gap-1">
                {[
                  { label: '720p', w: 1280, h: 720 },
                  { label: '1080p', w: 1920, h: 1080 },
                  { label: '1440p', w: 2560, h: 1440 },
                  { label: '4K', w: 3840, h: 2160 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      updateField('resolutionWidth', preset.w);
                      updateField('resolutionHeight', preset.h);
                    }}
                    className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${
                      launcher.resolutionWidth === preset.w &&
                      launcher.resolutionHeight === preset.h
                        ? 'bg-mc-accent text-white'
                        : 'bg-mc-surface-2 text-mc-dim hover:text-mc-text'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </FieldGroup>
        )}

        {/* ===== 启动命令生成 ===== */}
        {activeTab === 'command' && (
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-mc-accent" />
                <h3 className="text-sm font-medium text-mc-text">启动命令预览</h3>
                <span className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 text-[9px] text-mc-mute">
                  {LAUNCHER_TYPE_LABELS[launcher.launcherType]}
                </span>
              </div>
              <p className="mb-3 text-xs text-mc-mute">
                根据 LauncherSpec 生成的 Java 启动命令（仅供参考，实际命令可能因启动器版本而异）
              </p>

              <button
                onClick={() => setShowCommand(!showCommand)}
                className="mb-2 flex items-center gap-1 text-[10px] text-mc-dim hover:text-mc-text"
              >
                {showCommand ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                启动命令
              </button>

              {showCommand && (
                <div className="relative">
                  <pre className="rounded-mc border border-mc-border bg-mc-surface-2 p-3 pr-12 font-mono text-[10px] text-mc-text overflow-auto whitespace-pre-wrap break-all">
                    {launchCommand}
                  </pre>
                  <button
                    onClick={copyCommand}
                    className="absolute right-2 top-2 flex items-center gap-1 rounded-mc bg-mc-surface px-2 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              )}
            </div>

            {/* 命令分解 */}
            <div className="border-t border-mc-border pt-4">
              <h4 className="mb-2 text-xs font-medium text-mc-dim">命令分解</h4>
              <ul className="space-y-1 text-[10px]">
                <li className="flex items-center gap-2">
                  <code className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 font-mono text-mc-accent">
                    {launcher.javaPath}
                  </code>
                  <span className="text-mc-mute">— Java 可执行文件路径</span>
                </li>
                <li className="flex items-center gap-2">
                  <code className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 font-mono text-mc-accent">
                    -Xmx{launcher.memoryMax}M -Xms{launcher.memoryMin}M
                  </code>
                  <span className="text-mc-mute">— 内存配置</span>
                </li>
                {launcher.jvmArgs && (
                  <li className="flex items-center gap-2">
                    <code className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 font-mono text-mc-accent">
                      {launcher.jvmArgs}
                    </code>
                    <span className="text-mc-mute">— 额外 JVM 参数</span>
                  </li>
                )}
                <li className="flex items-center gap-2">
                  <code className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 font-mono text-mc-accent">
                    -jar
                  </code>
                  <span className="text-mc-mute">— 启动 JAR 文件</span>
                </li>
                {launcher.fullscreen && (
                  <li className="flex items-center gap-2">
                    <code className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 font-mono text-mc-accent">
                      --fullscreen
                    </code>
                    <span className="text-mc-mute">— 全屏启动</span>
                  </li>
                )}
                {launcher.resolutionWidth > 0 && launcher.resolutionHeight > 0 && (
                  <li className="flex items-center gap-2">
                    <code className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 font-mono text-mc-accent">
                      --width {launcher.resolutionWidth} --height {launcher.resolutionHeight}
                    </code>
                    <span className="text-mc-mute">— 窗口分辨率</span>
                  </li>
                )}
                {launcher.serverAutorun && (
                  <li className="flex items-center gap-2">
                    <code className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 font-mono text-mc-accent">
                      --server {launcher.serverAutorun}
                    </code>
                    <span className="text-mc-mute">— 自动连接服务器</span>
                  </li>
                )}
              </ul>
            </div>

            {/* 启动器配置文件预览 */}
            <div className="border-t border-mc-border pt-4">
              <button
                onClick={() => setShowConfig(!showConfig)}
                className="mb-2 flex items-center gap-1 text-xs font-medium text-mc-dim hover:text-mc-text"
              >
                {showConfig ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <FileText className="h-3 w-3" />
                启动器配置文件预览（{launcher.launcherType}）
              </button>
              {showConfig && (
                <pre className="rounded-mc border border-mc-border bg-mc-surface-2 p-3 font-mono text-[10px] text-mc-text overflow-auto max-h-72">
                  {configText}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {LAUNCHER_TYPE_LABELS[launcher.launcherType]} · {LOADER_LABELS[launcher.loader]} ·{' '}
        {launcher.accountType === 'microsoft' ? '微软账号' : '离线'} · {launcher.memoryMin}/
        {launcher.memoryMax} MB
      </div>
    </div>
  );
}

/** 生成 Java 启动命令 */
function generateLaunchCommand(l: LauncherSpec): string {
  const parts: string[] = [l.javaPath];

  // 内存参数
  parts.push(`-Xmx${l.memoryMax}M`);
  parts.push(`-Xms${l.memoryMin}M`);

  // 额外 JVM 参数
  if (l.jvmArgs) parts.push(l.jvmArgs);

  // 启动 JAR
  parts.push('-jar');
  parts.push(`minecraft-${l.mcVersion}-${l.loader}.jar`);

  // MC 参数
  const mcArgs: string[] = [];
  if (l.fullscreen) mcArgs.push('--fullscreen');
  if (l.resolutionWidth > 0 && l.resolutionHeight > 0) {
    mcArgs.push(`--width ${l.resolutionWidth}`);
    mcArgs.push(`--height ${l.resolutionHeight}`);
  }
  if (l.serverAutorun) mcArgs.push(`--server ${l.serverAutorun}`);
  if (l.username && l.accountType === 'offline') {
    mcArgs.push(`--username ${l.username}`);
  }
  if (l.uuid) mcArgs.push(`--uuid ${l.uuid}`);

  if (mcArgs.length > 0) parts.push(mcArgs.join(' '));

  return parts.join(' ');
}

/** 生成启动器配置文件（按 launcherType 格式） */
function generateLauncherConfig(l: LauncherSpec): string {
  if (l.launcherType === 'hmcl') {
    // HMCL 配置格式（JSON 子集）
    return [
      '{',
      `  "profiles": {`,
      `    "${l.profileName}": {`,
      `      "name": "${l.profileName}",`,
      `      "gameDir": ".minecraft",`,
      `      "java": "${l.javaPath}",`,
      `      "javaArgs": "-Xmx${l.memoryMax}M -Xms${l.memoryMin}M ${l.jvmArgs}".trim(),`,
      `      "mcVersion": "${l.mcVersion}",`,
      `      "loader": "${l.loader}",`,
      `      "accountType": "${l.accountType}",`,
      `      "username": "${l.username}",`,
      `      "uuid": "${l.uuid}",`,
      `      "fullscreen": ${l.fullscreen},`,
      `      "resolution": ${l.resolutionWidth}x${l.resolutionHeight},`,
      `      "serverAutorun": "${l.serverAutorun}"`,
      `    }`,
      `  }`,
      '}',
    ].join('\n');
  }
  if (l.launcherType === 'pcl2') {
    // PCL2 配置格式（INI）
    return [
      `[${l.profileName}]`,
      `JavaPath=${l.javaPath}`,
      `JavaMemory=${l.memoryMax}`,
      `JavaParameters=${l.jvmArgs}`,
      `Version=${l.mcVersion}`,
      `Loader=${l.loader}`,
      `AccountType=${l.accountType}`,
      `Username=${l.username}`,
      `UUID=${l.uuid}`,
      `Fullscreen=${l.fullscreen}`,
      `Resolution=${l.resolutionWidth}x${l.resolutionHeight}`,
      `ServerAutorun=${l.serverAutorun}`,
    ].join('\n');
  }
  // official：返回 JSON
  return JSON.stringify(
    {
      profileName: l.profileName,
      javaPath: l.javaPath,
      memory: { min: l.memoryMin, max: l.memoryMax },
      jvmArgs: l.jvmArgs,
      mcVersion: l.mcVersion,
      loader: l.loader,
      account: { type: l.accountType, username: l.username, uuid: l.uuid },
      display: { fullscreen: l.fullscreen, width: l.resolutionWidth, height: l.resolutionHeight },
      serverAutorun: l.serverAutorun,
    },
    null,
    2,
  );
}
