import { GitBranch } from 'lucide-react';
import { McIcon } from '../assets/mc-ui/McIcon';

/**
 * 源码管理面板（UI 占位）。
 * 提交 / 推送 / 拉取等真实 Git 操作需要主进程侧提供 Git 桥接（当前渲染进程无法执行 git），
 * 故此处仅做信息展示与操作入口占位，待主进程能力接入后启用。
 */
export function GitPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="mc-section-title border-b border-mc-border flex items-center gap-2">
        <GitBranch className="h-4 w-4" /> 源代码管理
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
          <GitBranch className="h-7 w-7 text-mc-mute" />
        </div>
        <div className="max-w-xs text-sm text-mc-dim">
          源代码管理（提交 / 推送 / 拉取）需要主进程 Git 桥接
        </div>
        <div className="flex gap-2">
          <button className="mc-btn-primary" disabled title="待接入主进程 Git 桥接">
            <McIcon scope="pixel" name="check" size={14} /> 提交
          </button>
          <button className="mc-btn-ghost" disabled title="待接入主进程 Git 桥接">
            <McIcon scope="pixel" name="reload" size={14} /> 拉取变更
          </button>
        </div>
        <div className="text-xs text-mc-mute">当前为 UI 占位，Git 操作将在主进程侧实现后启用</div>
      </div>
    </div>
  );
}
