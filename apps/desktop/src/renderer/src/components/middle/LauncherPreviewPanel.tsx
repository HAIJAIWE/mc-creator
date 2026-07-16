import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import { EmptyState, FieldGroup, TextField, NumberField, SelectField, ToggleField } from './shared/index.js';
import type { LauncherSpec } from '@mc-creator/shared';

/**
 * Launcher 预览面板：以分组表单展示 LauncherSpec 字段。
 * 字段修改后写回 useModStore.spec（实时同步）。
 */
export function LauncherPreviewPanel() {
  const { spec, setSpec } = useModStore(
    (s) => ({ spec: s.spec, setSpec: s.setSpec }),
    shallow,
  );

  if (!spec) {
    return <EmptyState icon="box" title="尚未生成启动器 Spec" hint="在右侧 AgentPanel 描述你想要的启动器，生成 Spec 后即可预览" />;
  }

  const launcher = spec as unknown as LauncherSpec;

  const updateField = <K extends keyof LauncherSpec>(key: K, value: LauncherSpec[K]) => {
    const updated = { ...launcher, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      {/* Header */}
      <div className="border-b border-mc-border px-4 py-3">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="box" size={16} className="text-mc-accent" />
          <span className="text-sm font-bold text-mc-text">{launcher.launcherName}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">{launcherTypeLabel(launcher.launcherType)}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">MC {launcher.mcVersion}</span>
        </div>
        <div className="mt-1 text-xs text-mc-mute">配置文件: {launcher.profileName}</div>
      </div>

      {/* Body：分组表单 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* 基本 */}
        <FieldGroup title="基本">
          <TextField label="启动器名称" value={launcher.launcherName} onChange={(v) => updateField('launcherName', v)} />
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
          <TextField label="配置名称" value={launcher.profileName} onChange={(v) => updateField('profileName', v)} />
          <TextField label="MC 版本" value={launcher.mcVersion} onChange={(v) => updateField('mcVersion', v)} />
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

        {/* JVM */}
        <FieldGroup title="JVM">
          <TextField label="Java 路径" value={launcher.javaPath} onChange={(v) => updateField('javaPath', v)} />
          <TextField label="JVM 参数" value={launcher.jvmArgs} onChange={(v) => updateField('jvmArgs', v)} />
          <NumberField label="最小内存(MB)" value={launcher.memoryMin} min={512} max={32768} onChange={(v) => updateField('memoryMin', v)} />
          <NumberField label="最大内存(MB)" value={launcher.memoryMax} min={1024} max={32768} onChange={(v) => updateField('memoryMax', v)} />
        </FieldGroup>

        {/* 账号 */}
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
          <TextField label="用户名" value={launcher.username} onChange={(v) => updateField('username', v)} />
          <TextField label="UUID" value={launcher.uuid} onChange={(v) => updateField('uuid', v)} />
        </FieldGroup>

        {/* 启动后 */}
        <FieldGroup title="启动后">
          <TextField label="自动连接服务器" value={launcher.serverAutorun} onChange={(v) => updateField('serverAutorun', v)} />
          <ToggleField label="全屏" value={launcher.fullscreen} onChange={(v) => updateField('fullscreen', v)} />
          <NumberField label="分辨率宽" value={launcher.resolutionWidth} min={1} max={7680} onChange={(v) => updateField('resolutionWidth', v)} />
          <NumberField label="分辨率高" value={launcher.resolutionHeight} min={1} max={4320} onChange={(v) => updateField('resolutionHeight', v)} />
        </FieldGroup>
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {launcherTypeLabel(launcher.launcherType)} · {launcher.loader} · {launcher.accountType === 'microsoft' ? '微软账号' : '离线'}
      </div>
    </div>
  );
}

function launcherTypeLabel(type: LauncherSpec['launcherType']): string {
  switch (type) {
    case 'official': return '官方启动器';
    case 'pcl2': return 'PCL2';
    case 'hmcl': return 'HMCL';
    default: return type;
  }
}
