import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import {
  EmptySpecState,
  FieldGroup,
  TextField,
  NumberField,
  SelectField,
  ToggleField,
  IconTabBar,
  useTabCounts,
} from './shared/index.js';
import type { ServerSpec, OpEntry, WhitelistEntry, ServerModEntry } from '@mc-creator/shared';
import type { BaseTab } from './shared/index.js';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Shield,
  Users,
  Package,
  FileText,
  Copy,
  Rocket,
  Cloud,
  Monitor,
} from 'lucide-react';

type SubTab =
  | 'basic'
  | 'world'
  | 'players'
  | 'network'
  | 'memory'
  | 'deploy'
  | 'ops'
  | 'whitelist'
  | 'mods'
  | 'properties';

const OP_LEVEL_LABELS: Record<number, string> = {
  1: '1 - 跳过出生点保护',
  2: '2 - 使用命令',
  3: '3 - 使用所有命令',
  4: '4 - 所有权限（满级）',
};

const SERVER_TABS: BaseTab<SubTab>[] = [
  { key: 'basic', label: '基本', icon: FileText },
  { key: 'world', label: '世界', icon: FileText },
  { key: 'players', label: '玩家', icon: Users },
  { key: 'network', label: '网络', icon: FileText },
  { key: 'memory', label: '内存', icon: FileText },
  { key: 'deploy', label: '部署', icon: Rocket },
  { key: 'ops', label: 'OP', icon: Shield },
  { key: 'whitelist', label: '白名单', icon: Users },
  { key: 'mods', label: 'Mod', icon: Package },
  { key: 'properties', label: 'properties', icon: FileText },
];

/**
 * Server 预览面板：以分组表单展示 ServerSpec 字段。
 * 字段修改后写回 useModStore.spec（实时同步）。
 * 包含 OP/白名单/Mod 列表可视化管理 + server.properties 预览。
 */
export function ServerPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<SubTab>('basic');
  const [showPropertiesPreview, setShowPropertiesPreview] = useState(false);
  const [newOpName, setNewOpName] = useState('');
  const [newOpLevel, setNewOpLevel] = useState(4);
  const [newWlName, setNewWlName] = useState('');
  const [newWlUuid, setNewWlUuid] = useState('');

  const server = spec as unknown as ServerSpec | null;

  // server.properties 预览生成（必须在 early return 之前调用以遵守 hooks 规则）
  const propertiesText = useMemo(() => (server ? generateServerProperties(server) : ''), [server]);

  // ===== Tab 配置（预计算 count）=====
  const tabs = useTabCounts(SERVER_TABS, server, (s, key) => {
    if (key === 'ops') return s.ops.length;
    if (key === 'whitelist') return s.whitelistEntries.length;
    if (key === 'mods') return s.mods.length;
    return undefined;
  });

  if (!spec || !server) {
    return <EmptySpecState label="Server" describe="服务器" icon="server" />;
  }

  const updateField = <K extends keyof ServerSpec>(key: K, value: ServerSpec[K]) => {
    const updated = { ...server, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  // ===== OP 管理 =====
  const addOp = () => {
    if (!newOpName.trim()) return;
    const op: OpEntry = { name: newOpName.trim(), level: newOpLevel };
    updateField('ops', [...server.ops, op]);
    setNewOpName('');
  };
  const removeOp = (name: string) => {
    updateField(
      'ops',
      server.ops.filter((o) => o.name !== name),
    );
  };
  const updateOpLevel = (name: string, level: number) => {
    updateField(
      'ops',
      server.ops.map((o) => (o.name === name ? { ...o, level } : o)),
    );
  };

  // ===== 白名单管理 =====
  const addWhitelist = () => {
    if (!newWlName.trim()) return;
    const entry: WhitelistEntry = {
      name: newWlName.trim(),
      ...(newWlUuid.trim() ? { uuid: newWlUuid.trim() } : {}),
    };
    updateField('whitelistEntries', [...server.whitelistEntries, entry]);
    setNewWlName('');
    setNewWlUuid('');
  };
  const removeWhitelist = (name: string) => {
    updateField(
      'whitelistEntries',
      server.whitelistEntries.filter((w) => w.name !== name),
    );
  };

  // ===== Mod 管理 =====
  const removeMod = (id: string) => {
    updateField(
      'mods',
      server.mods.filter((m) => m.id !== id),
    );
  };

  // ===== Tab 栏 =====
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      {/* Header：项目元信息 */}
      <div className="border-b border-mc-border px-4 py-3">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="server" size={16} className="text-mc-accent" />
          <span className="text-sm font-bold text-mc-text">{server.serverName}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">{server.mcVersion}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">端口 {server.port}</span>
          {server.onlineMode && (
            <span className="ml-1 rounded-mc bg-green-500/20 px-1.5 py-0.5 text-[9px] text-green-400">
              正版验证
            </span>
          )}
          {server.eula && (
            <span className="rounded-mc bg-blue-500/20 px-1.5 py-0.5 text-[9px] text-blue-400">
              EULA
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-mc-mute">{server.motd}</div>
      </div>

      {/* Tab 栏 */}
      <IconTabBar tabs={tabs} activeTab={activeTab} onSelect={setActiveTab} />

      {/* Body：根据 tab 渲染 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeTab === 'basic' && (
          <FieldGroup title="基本">
            <TextField
              label="服务器名称"
              value={server.serverName}
              onChange={(v) => updateField('serverName', v)}
            />
            <TextField label="MOTD" value={server.motd} onChange={(v) => updateField('motd', v)} />
            <NumberField
              label="最大玩家数"
              value={server.maxPlayers}
              min={1}
              max={999}
              onChange={(v) => updateField('maxPlayers', v)}
            />
            <NumberField
              label="端口"
              value={server.port}
              min={1}
              max={65535}
              onChange={(v) => updateField('port', v)}
            />
            <TextField
              label="世界种子"
              value={server.levelSeed ?? ''}
              onChange={(v) => updateField('levelSeed', v)}
            />
          </FieldGroup>
        )}

        {activeTab === 'world' && (
          <FieldGroup title="世界">
            <TextField
              label="世界名称"
              value={server.levelName}
              onChange={(v) => updateField('levelName', v)}
            />
            <SelectField
              label="游戏模式"
              value={server.gamemode}
              options={[
                { value: 'survival', label: '生存' },
                { value: 'creative', label: '创造' },
                { value: 'adventure', label: '冒险' },
                { value: 'spectator', label: '旁观' },
              ]}
              onChange={(v) => updateField('gamemode', v as ServerSpec['gamemode'])}
            />
            <SelectField
              label="难度"
              value={server.difficulty}
              options={[
                { value: 'peaceful', label: '和平' },
                { value: 'easy', label: '简单' },
                { value: 'normal', label: '普通' },
                { value: 'hard', label: '困难' },
              ]}
              onChange={(v) => updateField('difficulty', v as ServerSpec['difficulty'])}
            />
            <ToggleField
              label="允许飞行"
              value={server.allowFlight}
              onChange={(v) => updateField('allowFlight', v)}
            />
            <ToggleField
              label="允许下界"
              value={server.allowNether}
              onChange={(v) => updateField('allowNether', v)}
            />
            <ToggleField
              label="允许末地"
              value={server.allowEnd}
              onChange={(v) => updateField('allowEnd', v)}
            />
            <ToggleField
              label="生成动物"
              value={server.spawnAnimals}
              onChange={(v) => updateField('spawnAnimals', v)}
            />
            <ToggleField
              label="生成 NPC"
              value={server.spawnNpcs}
              onChange={(v) => updateField('spawnNpcs', v)}
            />
            <ToggleField
              label="生成怪物"
              value={server.spawnMonsters}
              onChange={(v) => updateField('spawnMonsters', v)}
            />
            <ToggleField
              label="生成结构"
              value={server.generateStructures}
              onChange={(v) => updateField('generateStructures', v)}
            />
          </FieldGroup>
        )}

        {activeTab === 'players' && (
          <FieldGroup title="玩家">
            <ToggleField label="PVP" value={server.pvp} onChange={(v) => updateField('pvp', v)} />
            <ToggleField
              label="正版验证"
              value={server.onlineMode}
              onChange={(v) => updateField('onlineMode', v)}
            />
            <ToggleField
              label="启用白名单"
              value={server.whitelist}
              onChange={(v) => updateField('whitelist', v)}
            />
            <ToggleField
              label="强制白名单"
              value={server.enforceWhitelist}
              onChange={(v) => updateField('enforceWhitelist', v)}
            />
          </FieldGroup>
        )}

        {activeTab === 'network' && (
          <FieldGroup title="网络">
            <NumberField
              label="视距"
              value={server.viewDistance}
              min={3}
              max={32}
              onChange={(v) => updateField('viewDistance', v)}
            />
            <NumberField
              label="模拟距离"
              value={server.simulationDistance}
              min={3}
              max={32}
              onChange={(v) => updateField('simulationDistance', v)}
            />
          </FieldGroup>
        )}

        {activeTab === 'memory' && (
          <FieldGroup title="内存">
            <TextField
              label="启动内存"
              value={server.startMemory}
              onChange={(v) => updateField('startMemory', v)}
            />
            <TextField
              label="最大内存"
              value={server.maxMemory}
              onChange={(v) => updateField('maxMemory', v)}
            />
            <NumberField
              label="最大内存百分比"
              value={server.maxRamPercent}
              min={1}
              max={100}
              onChange={(v) => updateField('maxRamPercent', v)}
            />
            <TextField
              label="Java 路径"
              value={server.javaPath}
              onChange={(v) => updateField('javaPath', v)}
            />
          </FieldGroup>
        )}

        {/* ===== 部署（一键开服） ===== */}
        {activeTab === 'deploy' && (
          <div className="space-y-4">
            <FieldGroup title="服务端类型">
              <SelectField
                label="服务端"
                value={server.serverType}
                options={[
                  { value: 'vanilla', label: 'Vanilla 原版' },
                  { value: 'paper', label: 'Paper（优化 + 插件支持）' },
                  { value: 'fabric', label: 'Fabric（Mod 支持）' },
                ]}
                onChange={(v) => updateField('serverType', v as ServerSpec['serverType'])}
              />
              <TextField
                label="MC 版本（下载用）"
                value={server.serverVersion}
                onChange={(v) => updateField('serverVersion', v)}
              />
              <TextField
                label="服务端文件名"
                value={server.jarName}
                onChange={(v) => updateField('jarName', v)}
              />
              <p className="text-[11px] text-mc-mute">
                install.sh / install.bat 会按此类型自动下载服务端（原版官方源 / PaperMC API / Fabric
                Installer）。
              </p>
            </FieldGroup>

            <FieldGroup title="云服务器部署（24h 在线）">
              <SelectField
                label="部署目标"
                value={server.deployTarget}
                options={[
                  { value: 'none', label: '不生成部署文件' },
                  { value: 'systemd', label: 'systemd 服务（开机自启）' },
                  { value: 'docker', label: 'Docker 容器' },
                  { value: 'both', label: 'systemd + Docker' },
                ]}
                onChange={(v) => updateField('deployTarget', v as ServerSpec['deployTarget'])}
              />
              <TextField
                label="服务用户"
                value={server.serviceUser}
                onChange={(v) => updateField('serviceUser', v)}
              />
              <TextField
                label="服务目录"
                value={server.serviceDir}
                onChange={(v) => updateField('serviceDir', v)}
              />
              <ToggleField
                label="崩溃自动重启"
                value={server.restartOnCrash}
                onChange={(v) => updateField('restartOnCrash', v)}
              />
              <NumberField
                label="备份间隔（小时，0 = 不备份）"
                value={server.backupInterval}
                min={0}
                max={168}
                onChange={(v) => updateField('backupInterval', v)}
              />
              <div className="mt-2 flex items-start gap-2 rounded-mc border border-mc-border bg-mc-surface-2/60 p-2">
                <Cloud className="mt-0.5 h-3 w-3 flex-shrink-0 text-mc-accent" />
                <div className="text-[11px] leading-relaxed text-mc-mute">
                  云服务器流程：把生成文件上传到服务器 → 执行{' '}
                  <code className="text-mc-text">bash install.sh</code> → 自动装
                  Java、下载服务端、安装 systemd 开机自启。
                </div>
              </div>
            </FieldGroup>

            <FieldGroup title="本地开服（局域网联机）">
              <div className="flex items-start gap-2 rounded-mc border border-mc-border bg-mc-surface-2/60 p-2">
                <Monitor className="mt-0.5 h-3 w-3 flex-shrink-0 text-mc-accent" />
                <div className="text-[11px] leading-relaxed text-mc-mute">
                  本地流程：双击 <code className="text-mc-text">install.bat</code> 检查 Java
                  并下载服务端 → 运行 <code className="text-mc-text">start.bat</code> 开服 → 同一
                  WiFi 玩家连
                  <code className="text-mc-text"> 你电脑IP:{server.port}</code>。
                </div>
              </div>
            </FieldGroup>
          </div>
        )}

        {/* ===== OP 管理 ===== */}
        {activeTab === 'ops' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-mc-accent" />
              <h3 className="text-sm font-medium text-mc-text">OP 玩家管理</h3>
              <span className="text-xs text-mc-mute">（{server.ops.length}）</span>
            </div>

            {/* 添加 OP */}
            <div className="flex gap-2 rounded-mc border border-mc-border bg-mc-surface-2 p-2">
              <input
                value={newOpName}
                onChange={(e) => setNewOpName(e.target.value)}
                placeholder="玩家名"
                className="flex-1 rounded-mc border border-mc-border bg-mc-surface px-2 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
                onKeyDown={(e) => e.key === 'Enter' && addOp()}
              />
              <select
                value={newOpLevel}
                onChange={(e) => setNewOpLevel(Number(e.target.value))}
                className="rounded-mc border border-mc-border bg-mc-surface px-2 py-1 text-xs text-mc-text outline-none"
              >
                {Object.entries(OP_LEVEL_LABELS).map(([lv, label]) => (
                  <option key={lv} value={lv}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                onClick={addOp}
                className="flex items-center gap-1 rounded-mc bg-mc-accent px-2 py-1 text-xs text-white hover:bg-mc-accent/80"
              >
                <Plus className="h-3 w-3" /> 添加
              </button>
            </div>

            {/* OP 列表 */}
            {server.ops.length === 0 ? (
              <div className="py-8 text-center text-xs text-mc-mute">尚无 OP 玩家</div>
            ) : (
              <ul className="space-y-1">
                {server.ops.map((op) => (
                  <li
                    key={op.name}
                    className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-xs"
                  >
                    <Shield className="h-3 w-3 text-mc-accent" />
                    <span className="flex-1 text-mc-text">{op.name}</span>
                    <select
                      value={op.level}
                      onChange={(e) => updateOpLevel(op.name, Number(e.target.value))}
                      className="rounded-mc border border-mc-border bg-mc-surface px-1 py-0.5 text-[10px] text-mc-text outline-none"
                    >
                      {Object.entries(OP_LEVEL_LABELS).map(([lv, label]) => (
                        <option key={lv} value={lv}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeOp(op.name)}
                      className="text-mc-mute hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ===== 白名单管理 ===== */}
        {activeTab === 'whitelist' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-mc-accent" />
              <h3 className="text-sm font-medium text-mc-text">白名单管理</h3>
              <span className="text-xs text-mc-mute">（{server.whitelistEntries.length}）</span>
              {!server.whitelist && (
                <span className="rounded-mc bg-yellow-500/20 px-1.5 py-0.5 text-[9px] text-yellow-400">
                  未启用
                </span>
              )}
            </div>

            {/* 添加白名单 */}
            <div className="space-y-2 rounded-mc border border-mc-border bg-mc-surface-2 p-2">
              <input
                value={newWlName}
                onChange={(e) => setNewWlName(e.target.value)}
                placeholder="玩家名"
                className="w-full rounded-mc border border-mc-border bg-mc-surface px-2 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
                onKeyDown={(e) => e.key === 'Enter' && addWhitelist()}
              />
              <input
                value={newWlUuid}
                onChange={(e) => setNewWlUuid(e.target.value)}
                placeholder="UUID（可选，如 069a79f4-44e9-4726-a5be-fca90e38aaf5）"
                className="w-full rounded-mc border border-mc-border bg-mc-surface px-2 py-1 font-mono text-[10px] text-mc-text outline-none focus:border-mc-accent"
                onKeyDown={(e) => e.key === 'Enter' && addWhitelist()}
              />
              <button
                onClick={addWhitelist}
                className="flex items-center gap-1 rounded-mc bg-mc-accent px-2 py-1 text-xs text-white hover:bg-mc-accent/80"
              >
                <Plus className="h-3 w-3" /> 添加
              </button>
            </div>

            {/* 白名单列表 */}
            {server.whitelistEntries.length === 0 ? (
              <div className="py-8 text-center text-xs text-mc-mute">尚无白名单条目</div>
            ) : (
              <ul className="space-y-1">
                {server.whitelistEntries.map((entry) => (
                  <li
                    key={entry.name}
                    className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-xs"
                  >
                    <Users className="h-3 w-3 text-mc-mute" />
                    <span className="flex-1 text-mc-text">{entry.name}</span>
                    {entry.uuid && (
                      <code className="font-mono text-[9px] text-mc-mute">
                        {entry.uuid.slice(0, 8)}…
                      </code>
                    )}
                    <button
                      onClick={() => removeWhitelist(entry.name)}
                      className="text-mc-mute hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ===== Mod 列表 ===== */}
        {activeTab === 'mods' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-mc-accent" />
              <h3 className="text-sm font-medium text-mc-text">服务器 Mod</h3>
              <span className="text-xs text-mc-mute">（{server.mods.length}）</span>
            </div>

            {server.mods.length === 0 ? (
              <div className="py-8 text-center text-xs text-mc-mute">
                尚无服务器 Mod
                <br />
                <span className="text-[10px]">在整合包面板或 Modrinth/CurseForge 搜索添加</span>
              </div>
            ) : (
              <ul className="space-y-1">
                {server.mods.map((mod: ServerModEntry) => {
                  const isCF = mod.source === 'curseforge';
                  return (
                    <li
                      key={mod.id}
                      className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-xs"
                    >
                      <Package className="h-3 w-3 text-mc-mute" />
                      <span className="flex-1 truncate text-mc-text">{mod.id}</span>
                      <span className="font-mono text-[9px] text-mc-dim">{mod.version}</span>
                      <span
                        className={`rounded-mc px-1 py-0.5 text-[8px] ${
                          isCF
                            ? 'bg-orange-500/20 text-orange-400'
                            : mod.source === 'url'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-green-500/20 text-green-400'
                        }`}
                      >
                        {mod.source === 'curseforge' ? 'CF' : mod.source === 'url' ? 'URL' : 'MR'}
                      </span>
                      <button
                        onClick={() => removeMod(mod.id)}
                        className="text-mc-mute hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* ===== server.properties 预览 ===== */}
        {activeTab === 'properties' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-mc-accent" />
                <h3 className="text-sm font-medium text-mc-text">server.properties 预览</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigator.clipboard?.writeText(propertiesText)}
                  className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
                >
                  <Copy className="h-3 w-3" /> 复制
                </button>
                <button
                  onClick={() => setShowPropertiesPreview(!showPropertiesPreview)}
                  className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
                >
                  {showPropertiesPreview ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {showPropertiesPreview ? '折叠' : '展开'}
                </button>
              </div>
            </div>
            {showPropertiesPreview && (
              <pre className="rounded-mc border border-mc-border bg-mc-surface-2 p-3 font-mono text-[10px] text-mc-text overflow-auto max-h-96">
                {propertiesText}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Footer：统计 */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        OP 玩家：{server.ops.length} · 白名单条目：{server.whitelistEntries.length} · 服务器 Mod：
        {server.mods.length}
      </div>
    </div>
  );
}

/** 生成 server.properties 文本 */
function generateServerProperties(server: ServerSpec): string {
  const lines: string[] = [
    `#Minecraft server properties`,
    `#Generated by MC Creator`,
    `#${new Date().toISOString()}`,
    `allow-flight=${server.allowFlight}`,
    `allow-nether=${server.allowNether}`,
    `allow-end=${server.allowEnd}`,
    `spawn-animals=${server.spawnAnimals}`,
    `spawn-npcs=${server.spawnNpcs}`,
    `spawn-monsters=${server.spawnMonsters}`,
    `generate-structures=${server.generateStructures}`,
    `gamemode=${server.gamemode}`,
    `difficulty=${server.difficulty}`,
    `level-name=${server.levelName}`,
    ...(server.levelSeed ? [`level-seed=${server.levelSeed}`] : []),
    `motd=${server.motd}`,
    `max-players=${server.maxPlayers}`,
    `online-mode=${server.onlineMode}`,
    `pvp=${server.pvp}`,
    `server-port=${server.port}`,
    `view-distance=${server.viewDistance}`,
    `simulation-distance=${server.simulationDistance}`,
    `white-list=${server.whitelist}`,
    `enforce-whitelist=${server.enforceWhitelist}`,
  ];
  // 额外属性
  for (const [k, v] of Object.entries(server.extraProperties ?? {})) {
    lines.push(`${k}=${v}`);
  }
  return lines.join('\n');
}
