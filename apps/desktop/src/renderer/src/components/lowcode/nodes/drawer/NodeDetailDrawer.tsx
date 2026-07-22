import { memo, useEffect } from 'react';
import { useDrawerStore } from '../../../../store/drawer-store.js';
import { NodeDetailForm } from './NodeDetailForm.js';

interface CompileMessage {
  type: 'error' | 'warning';
  nodeId: string;
  message: string;
}

interface NodeDetailDrawerProps {
  /** 编译消息列表（来自 PropertyPanel 旧功能） */
  compileMessages: CompileMessage[];
}

/**
 * 节点详情抽屉（右侧滑出，吸收旧 PropertyPanel 功能）。
 *
 * 功能：
 * - 草稿模式：openDrawer 时深拷贝 data 到 draft，保存写回 store，取消丢弃
 * - schema 驱动表单：委托 NodeDetailForm 渲染
 * - 编译消息：显示与当前节点相关的错误/警告
 * - MC 风格：3D 凸起边框 + 降饱和配色 + 像素字体
 * - Esc 键关闭（触发 cancelDraft）
 */
function NodeDetailDrawerComponent({ compileMessages }: NodeDetailDrawerProps) {
  const open = useDrawerStore((s) => s.open);
  const nodeId = useDrawerStore((s) => s.nodeId);
  const dirty = useDrawerStore((s) => s.dirty);
  const saveDraft = useDrawerStore((s) => s.saveDraft);
  const cancelDraft = useDrawerStore((s) => s.cancelDraft);

  // Esc 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDraft();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, cancelDraft]);

  if (!open || !nodeId) return null;

  const nodeMessages = compileMessages.filter((m) => m.nodeId === nodeId);

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={cancelDraft} aria-hidden="true" />
      {/* 抽屉 */}
      <aside
        role="dialog"
        aria-label="节点详情"
        className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-surface animate-mc-drawer-in"
      >
        {/* 头部 */}
        <header className="flex items-center justify-between border-b-2 border-b-black border-t-white border-l-white border-r-white bg-mc-btn px-3 py-2">
          <h2 className="text-[12px] font-medium text-mc-text">节点详情</h2>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-[10px] text-yellow-400">未保存</span>}
            <button
              type="button"
              aria-label="关闭"
              onClick={cancelDraft}
              className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 text-[11px] hover:bg-mc-btn-hover"
            >
              ×
            </button>
          </div>
        </header>

        {/* 编译消息区（吸收旧 NodeCompileMessages 功能） */}
        {nodeMessages.length > 0 && (
          <div className="space-y-1 border-b-2 border-b-black border-t-white border-l-white border-r-white bg-mc-bg px-3 py-2">
            {nodeMessages.map((msg, i) => (
              <div
                key={i}
                role={msg.type === 'error' ? 'alert' : 'status'}
                className={`text-[10px] ${
                  msg.type === 'error'
                    ? 'bg-red-900/40 text-red-300'
                    : 'bg-yellow-900/40 text-yellow-300'
                } border border-t-white border-l-white border-b-black border-r-black px-2 py-1`}
              >
                {msg.message}
              </div>
            ))}
          </div>
        )}

        {/* 表单区 */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <NodeDetailForm />
        </div>

        {/* 底部操作栏 */}
        <footer className="flex gap-2 border-t-2 border-t-white border-l-white border-r-white border-b-black bg-mc-btn px-3 py-2">
          <button
            type="button"
            onClick={saveDraft}
            className="flex-1 border border-t-white border-l-white border-b-black border-r-black bg-mc-accent px-2 py-1 text-[11px] text-white hover:brightness-110"
          >
            保存
          </button>
          <button
            type="button"
            onClick={cancelDraft}
            className="flex-1 border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 py-1 text-[11px] text-mc-text hover:bg-mc-btn-hover"
          >
            取消
          </button>
        </footer>
      </aside>
    </>
  );
}

export const NodeDetailDrawer = memo(NodeDetailDrawerComponent);
