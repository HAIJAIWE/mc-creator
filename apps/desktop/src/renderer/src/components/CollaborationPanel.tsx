import { useState } from 'react';
import { Share2, Upload, Download, Check, X, GitCompare } from 'lucide-react';
import { ipcClient } from '../lib/ipc-client.js';
import { useModStore } from '../store/mod-store.js';
import type { SpecSnapshot } from '../../../shared/ipc-channels.js';
import {
  diffSpecValues,
  summarizeDiff,
  formatDiffValue,
  type SpecDiffEntry,
} from '../lib/specDiff.js';

interface CollaborationPanelProps {
  onClose: () => void;
}

/**
 * 协作面板（基于文件的异步协作）：
 * - 导出当前 Spec 为 .mc-spec.json 快照（分享给他人）
 * - 导入他人 Spec 快照，字段级 diff 预览，选择"合并/替换"
 * - 合并 = 以导入 Spec 为基准覆盖当前 Spec（可回滚）
 */
export function CollaborationPanel({ onClose }: CollaborationPanelProps) {
  const spec = useModStore((s) => s.spec);
  const generatorType = useModStore((s) => s.generatorType);
  const [description, setDescription] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [snapshot, setSnapshot] = useState<SpecSnapshot | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const handleExport = async () => {
    if (!spec) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await ipcClient.exportSpec({
        spec,
        generatorType,
        description,
      });
      if (res.ok && res.savedPath) {
        setExportMsg(`已导出到 ${res.savedPath}`);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    setApplied(false);
    try {
      const res = await ipcClient.importSpec();
      if (res.canceled) return;
      if (res.error) {
        setImportError(res.error);
        return;
      }
      if (res.snapshot) {
        setSnapshot(res.snapshot);
      }
    } finally {
      setImporting(false);
    }
  };

  const entries: SpecDiffEntry[] = snapshot ? diffSpecValues(spec, snapshot.spec) : [];
  const summary = summarizeDiff(entries);

  const handleMerge = () => {
    if (!snapshot) return;
    useModStore.setState({ spec: snapshot.spec as never });
    setApplied(true);
  };

  const kindStyle: Record<SpecDiffEntry['kind'], string> = {
    added: 'text-mc-accent',
    removed: 'text-mc-redstone',
    changed: 'text-mc-gold',
  };
  const kindLabel: Record<SpecDiffEntry['kind'], string> = {
    added: '新增',
    removed: '删除',
    changed: '修改',
  };

  return (
    <div className="flex h-full flex-col bg-mc-surface">
      <div className="mc-section-title flex items-center gap-2 border-b border-mc-border">
        <Share2 className="h-4 w-4" /> 协作
        <button
          onClick={onClose}
          className="ml-auto rounded-mc px-1.5 py-0.5 text-xs text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
          title="关闭"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 导出区 */}
        <div className="mb-4 rounded-mc border border-mc-border bg-mc-surface-2 p-3">
          <div className="mb-2 text-xs font-medium text-mc-text">导出 Spec 快照</div>
          <p className="mb-2 text-[11px] text-mc-mute">
            把当前 Spec 保存为 .mc-spec.json 文件，通过文件分享给协作者。
          </p>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="版本说明（可选，如 v2 修复矿石生成）"
            className="mc-input mb-2 w-full"
          />
          <div className="flex items-center gap-2">
            <button onClick={handleExport} disabled={!spec || exporting} className="mc-btn-primary">
              <Download className="h-3 w-3" /> {exporting ? '导出中…' : '导出'}
            </button>
            {exportMsg && <span className="text-[11px] text-mc-accent">{exportMsg}</span>}
          </div>
        </div>

        {/* 导入区 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
          <div className="mb-2 text-xs font-medium text-mc-text">导入协作者 Spec</div>
          <p className="mb-2 text-[11px] text-mc-mute">
            读取 .mc-spec.json 快照，预览与当前 Spec 的差异后合并。
          </p>
          <button onClick={handleImport} disabled={importing} className="mc-btn-primary">
            <Upload className="h-3 w-3" /> {importing ? '导入中…' : '导入 Spec'}
          </button>
          {importError && <div className="mt-2 text-[11px] text-mc-redstone">{importError}</div>}
        </div>

        {/* 差异预览 */}
        {snapshot && (
          <div className="mt-4 rounded-mc border border-mc-border bg-mc-surface-2 p-3">
            <div className="mb-2 flex items-center gap-2">
              <GitCompare className="h-3 w-3 text-mc-accent" />
              <span className="text-xs font-medium text-mc-text">差异预览</span>
              <span className="ml-auto text-[11px] text-mc-mute">
                导入于 {new Date(snapshot.meta.exportedAt).toLocaleString()}
              </span>
            </div>

            {applied ? (
              <div className="flex items-center gap-2 text-[11px] text-mc-accent">
                <Check className="h-3 w-3" /> 已合并导入版本
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-3 text-[11px]">
                  <span className="text-mc-accent">+{summary.added}</span>
                  <span className="text-mc-redstone">-{summary.removed}</span>
                  <span className="text-mc-gold">~{summary.changed}</span>
                  <span className="ml-auto text-mc-mute">共 {entries.length} 处差异</span>
                </div>

                {entries.length === 0 ? (
                  <div className="py-2 text-[11px] text-mc-mute">与当前 Spec 没有差异</div>
                ) : (
                  <ul className="max-h-48 divide-y divide-mc-border overflow-y-auto">
                    {entries.slice(0, 20).map((e, i) => (
                      <li key={i} className="py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-medium ${kindStyle[e.kind]}`}>
                            {kindLabel[e.kind]}
                          </span>
                          <code className="truncate font-mono text-[10px] text-mc-text">
                            {e.path}
                          </code>
                        </div>
                        <div className="mt-0.5 grid grid-cols-2 gap-2">
                          <code className="truncate font-mono text-[10px] text-mc-dim">
                            {formatDiffValue(e.oldValue)}
                          </code>
                          <code className="truncate font-mono text-[10px] text-mc-text">
                            {formatDiffValue(e.newValue)}
                          </code>
                        </div>
                      </li>
                    ))}
                    {entries.length > 20 && (
                      <li className="py-1 text-[10px] text-mc-mute">
                        还有 {entries.length - 20} 处差异未显示
                      </li>
                    )}
                  </ul>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <button onClick={handleMerge} className="mc-btn-primary">
                    <Check className="h-3 w-3" /> 合并导入版本
                  </button>
                  <button
                    onClick={() => {
                      setSnapshot(null);
                      setApplied(false);
                    }}
                    className="mc-btn-ghost"
                  >
                    <X className="h-3 w-3" /> 取消
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 协作说明 */}
        <div className="mt-4 rounded-mc border border-mc-border bg-mc-surface-2/60 p-3 text-[11px] leading-relaxed text-mc-mute">
          <div className="mb-1 text-xs font-medium text-mc-text">协作方式</div>
          通过 .mc-spec.json 文件交换 Spec 快照：导出 → 分享文件 → 协作者导入并合并。
          合并前会展示字段级差异，合并后可通过「Spec 历史」回滚。
        </div>
      </div>
    </div>
  );
}
