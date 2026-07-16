import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import type { ServerSpec } from '@mc-creator/shared';

/**
 * Server 预览面板：以分组表单展示 ServerSpec 字段。
 * 字段修改后写回 useModStore.spec（实时同步）。
 */
export function ServerPreviewPanel() {
  const { spec, setSpec } = useModStore(
    (s) => ({ spec: s.spec, setSpec: s.setSpec }),
    shallow,
  );

  if (!spec) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
        <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
          <McIcon scope="pixel" name="server" size={32} className="text-mc-mute" />
        </div>
        <div className="text-sm font-medium text-mc-dim">尚未生成 Server Spec</div>
        <div className="text-xs text-mc-mute">在右侧 AgentPanel 描述你想要的服务器，生成 Spec 后即可预览</div>
      </div>
    );
  }

  const server = spec as unknown as ServerSpec;

  const updateField = <K extends keyof ServerSpec>(key: K, value: ServerSpec[K]) => {
    const updated = { ...server, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

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
        </div>
        <div className="mt-1 text-xs text-mc-mute">{server.motd}</div>
      </div>

      {/* Body：分组表单 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* 基本 */}
        <FieldGroup title="基本">
          <TextField label="服务器名称" value={server.serverName} onChange={(v) => updateField('serverName', v)} />
          <TextField label="MOTD" value={server.motd} onChange={(v) => updateField('motd', v)} />
          <NumberField label="最大玩家数" value={server.maxPlayers} min={1} max={999} onChange={(v) => updateField('maxPlayers', v)} />
          <NumberField label="端口" value={server.port} min={1} max={65535} onChange={(v) => updateField('port', v)} />
        </FieldGroup>

        {/* 世界 */}
        <FieldGroup title="世界">
          <TextField label="世界名称" value={server.levelName} onChange={(v) => updateField('levelName', v)} />
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
        </FieldGroup>

        {/* 玩家 */}
        <FieldGroup title="玩家">
          <ToggleField label="PVP" value={server.pvp} onChange={(v) => updateField('pvp', v)} />
          <ToggleField label="正版验证" value={server.onlineMode} onChange={(v) => updateField('onlineMode', v)} />
          <ToggleField label="白名单" value={server.whitelist} onChange={(v) => updateField('whitelist', v)} />
          <ToggleField label="强制白名单" value={server.enforceWhitelist} onChange={(v) => updateField('enforceWhitelist', v)} />
        </FieldGroup>

        {/* 网络 */}
        <FieldGroup title="网络">
          <NumberField label="视距" value={server.viewDistance} min={3} max={32} onChange={(v) => updateField('viewDistance', v)} />
          <NumberField label="模拟距离" value={server.simulationDistance} min={3} max={32} onChange={(v) => updateField('simulationDistance', v)} />
        </FieldGroup>

        {/* 内存 */}
        <FieldGroup title="内存">
          <TextField label="启动内存" value={server.startMemory} onChange={(v) => updateField('startMemory', v)} />
          <TextField label="最大内存" value={server.maxMemory} onChange={(v) => updateField('maxMemory', v)} />
        </FieldGroup>
      </div>

      {/* Footer：统计 */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        OP 玩家：{server.ops.length} · 白名单条目：{server.whitelistEntries.length} · 服务器 Mod：{server.mods.length}
      </div>
    </div>
  );
}

// ===== 子组件 =====

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-mc-dim">{title}</div>
      <div className="space-y-2 rounded-mc-lg border border-mc-border bg-mc-surface-2/40 p-3">
        {children}
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-input flex-1 !py-1 !text-xs"
      />
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="mc-input w-24 !py-1 !text-xs"
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-select flex-1 !py-1 !text-xs"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-mc-accent' : 'bg-mc-surface-3'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      <span className="text-xs text-mc-mute">{value ? '开' : '关'}</span>
    </div>
  );
}
