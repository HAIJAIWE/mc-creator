import { useState, useCallback, useEffect } from 'react';
import { X, Check, Save, GitMerge, Loader2 } from 'lucide-react';
import { CodeDiff } from './CodeDiff';
import { useModStore } from '../../store/mod-store';
import { useToast } from '../useToast';
import { McIcon } from '../../assets/mc-ui/McIcon';

export type ConflictResolutionAction =
  | 'accept-server' // 接受服务器版本
  | 'keep-local' // 保留本地版本
  | 'merge-to-local' // 合并到本地（编辑后的本地版本）
  | 'cancel'; // 取消

export interface CodeDiffDialogProps {
  /** 文件路径 */
  filePath: string;
  /** 服务器版本内容 */
  serverContent: string;
  /** 本地版本内容 */
  localContent: string;
  /** 对话框关闭回调 */
  onClose: (action: ConflictResolutionAction, mergedContent?: string) => void;
  /** 是否显示 */
  isOpen: boolean;
}

/**
 * 文件冲突差异对话框
 * - 左侧：服务器版本（只读）
 * - 右侧：本地版本（可编辑，编辑后启用"合并到本地"按钮）
 * - 底部按钮：接受服务器版本 / 保留本地版本 / 合并到本地 / 取消
 */
export function CodeDiffDialog({
  filePath,
  serverContent,
  localContent,
  onClose,
  isOpen,
}: CodeDiffDialogProps) {
  const { forceWriteFile } = useModStore();
  const toast = useToast();
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('side-by-side');
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(0);
  const [localContentEdited, setLocalContentEdited] = useState(localContent);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveAction, setSaveAction] = useState<ConflictResolutionAction | null>(null);

  // 本地内容变化时标记为已编辑
  useEffect(() => {
    setLocalContentEdited(localContent);
    setIsEditing(false);
  }, [localContent]);

  const handleAcceptServer = useCallback(async () => {
    setIsSaving(true);
    setSaveAction('accept-server');
    try {
      // 强制写入服务器版本
      await forceWriteFile(filePath, serverContent);
      toast.success('已接受服务器版本');
      onClose('accept-server');
    } catch (e) {
      toast.error(`接受服务器版本失败：${(e as Error).message}`);
    } finally {
      setIsSaving(false);
      setSaveAction(null);
    }
  }, [filePath, serverContent, forceWriteFile, toast, onClose]);

  const handleKeepLocal = useCallback(async () => {
    setIsSaving(true);
    setSaveAction('keep-local');
    try {
      // 强制写入本地版本（覆盖服务器）
      await forceWriteFile(filePath, localContent);
      toast.success('已保留本地版本');
      onClose('keep-local');
    } catch (e) {
      toast.error(`保留本地版本失败：${(e as Error).message}`);
    } finally {
      setIsSaving(false);
      setSaveAction(null);
    }
  }, [filePath, localContent, forceWriteFile, toast, onClose]);

  const handleMergeToLocal = useCallback(async () => {
    setIsSaving(true);
    setSaveAction('merge-to-local');
    try {
      // 写入编辑后的本地版本
      await forceWriteFile(filePath, localContentEdited);
      toast.success('已合并到本地版本');
      onClose('merge-to-local', localContentEdited);
    } catch (e) {
      toast.error(`合并失败：${(e as Error).message}`);
    } finally {
      setIsSaving(false);
      setSaveAction(null);
    }
  }, [filePath, localContentEdited, forceWriteFile, toast, onClose]);

  const handleCancel = useCallback(() => {
    onClose('cancel');
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        handleCancel();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, handleCancel]);

  if (!isOpen) return null;

  const canMerge =
    isEditing && localContentEdited !== serverContent && localContentEdited !== localContent;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50"
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
    >
      <div
        className="flex w-[90vw] max-w-6xl h-[90vh] max-h-[800px] flex-col overflow-hidden rounded-mc-lg border border-mc-border bg-mc-surface shadow-mc-pop animate-mc-toast-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-mc-border bg-mc-surface-2 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <McIcon scope="pixel" name="file-code" size={20} className="text-mc-gold" />
            <h2 id="conflict-dialog-title" className="text-sm font-medium text-mc-text">
              文件冲突：{filePath}
            </h2>
          </div>
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="rounded-mc p-1.5 text-mc-mute transition-colors hover:bg-mc-surface-3 hover:text-mc-text disabled:opacity-50"
            title="关闭 (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 差异对比区域 */}
        <div className="flex-1 overflow-hidden min-h-0">
          <CodeDiff
            oldContent={serverContent}
            newContent={localContentEdited}
            oldLabel="服务器版本"
            newLabel="本地版本"
            readOnly={false}
            showLineNumbers={true}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            maxHeight="calc(100% - 80px)"
            language={getLanguageFromPath(filePath)}
            onChunkClick={setActiveChunkIndex}
            activeChunkIndex={activeChunkIndex}
          />
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-mc-border bg-mc-surface-2 px-4 py-3 shrink-0 gap-3">
          <div className="flex items-center gap-2 text-xs text-mc-mute">
            <kbd className="rounded-mc bg-mc-bg px-1.5 py-0.5 border border-mc-border">F7</kbd>
            <span>下一个差异</span>
            <span className="mx-1">|</span>
            <kbd className="rounded-mc bg-mc-bg px-1.5 py-0.5 border border-mc-border">
              Shift+F7
            </kbd>
            <span>上一个差异</span>
            <span className="mx-1">|</span>
            <kbd className="rounded-mc bg-mc-bg px-1.5 py-0.5 border border-mc-border">Esc</kbd>
            <span>关闭</span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* 取消 */}
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="mc-btn-ghost disabled:opacity-50"
            >
              <X className="h-3 w-3 mr-1" />
              取消
            </button>

            {/* 接受服务器版本 */}
            <button
              onClick={handleAcceptServer}
              disabled={isSaving}
              className="mc-btn-ghost disabled:opacity-50"
            >
              {isSaving && saveAction === 'accept-server' && (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              )}
              <GitMerge className="h-3 w-3 mr-1" />
              接受服务器版本
            </button>

            {/* 保留本地版本 */}
            <button
              onClick={handleKeepLocal}
              disabled={isSaving}
              className="mc-btn-ghost disabled:opacity-50"
            >
              {isSaving && saveAction === 'keep-local' && (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              )}
              <Check className="h-3 w-3 mr-1" />
              保留本地版本
            </button>

            {/* 合并到本地 */}
            <button
              onClick={handleMergeToLocal}
              disabled={isSaving || !canMerge}
              className="mc-btn-primary disabled:opacity-50"
            >
              {isSaving && saveAction === 'merge-to-local' && (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              )}
              <Save className="h-3 w-3 mr-1" />
              合并到本地
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 根据文件路径推断语言 */
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    json: 'json',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    py: 'python',
    json5: 'json5',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    txt: 'plaintext',
    snbt: 'snbt',
    mcfunction: 'mcfunction',
    properties: 'properties',
    gradle: 'groovy',
    groovy: 'groovy',
    sh: 'shell',
    bash: 'shell',
  };
  return langMap[ext ?? ''] || 'plaintext';
}
