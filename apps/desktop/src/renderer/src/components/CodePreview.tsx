import { useState, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import type { FileNode } from '@mc-creator/shared';
import type { GeneratorType } from '../../../shared/ipc-channels.js';
import { defineMcMonacoTheme, mcEditorOptions, MC_MONACO_THEME } from '../lib/monaco-theme.js';

function parsePngSize(content: string): { width: number; height: number } | null {
  try {
    const binary = atob(content);
    if (binary.length < 24) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width, height };
  } catch {
    return null;
  }
}

function PngPreview({ file }: { file: FileNode }) {
  const size = parsePngSize(file.content);
  const dataUrl = `data:image/png;base64,${file.content}`;
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <McIcon scope="pixel" name="image" size={16} className="text-mc-mute" />
        <span className="text-xs font-bold uppercase tracking-wider text-mc-dim">PNG 预览</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <div
          style={{
            backgroundImage:
              'linear-gradient(45deg, #3a352a 25%, transparent 25%), linear-gradient(-45deg, #3a352a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a352a 75%), linear-gradient(-45deg, transparent 75%, #3a352a 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            backgroundColor: '#242118',
          }}
          className="inline-block rounded-mc-lg p-4"
        >
          <img
            src={dataUrl}
            alt={file.path}
            style={{ maxWidth: 512, maxHeight: 480 }}
            className="block rounded-mc"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-mc-mute">
          <span className="break-all">{file.path}</span>
          {size && (
            <span className="text-mc-dim">
              • {size.width}×{size.height}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function getFileIcon(path: string): string {
  if (path.endsWith('.json')) return 'file-text';
  if (path.endsWith('.java')) return 'terminal';
  if (path.endsWith('.gradle') || path.endsWith('.toml') || path.endsWith('.properties'))
    return 'terminal';
  if (path.endsWith('.png')) return 'image';
  return 'file';
}

function computeDefaultName(generatorType: GeneratorType, spec: unknown): string {
  const s = (spec ?? {}) as Record<string, unknown>;
  let name = 'export';
  if (generatorType === 'mod' || generatorType === 'server') {
    const v = s.modId ?? s.serverName;
    if (typeof v === 'string' && v) name = v;
  } else {
    const v = s.packName ?? s.playerName;
    if (typeof v === 'string' && v) name = v;
  }
  return `${generatorType}-${name}.zip`;
}

export function CodePreview() {
  // P3 性能：shallow 选择器避免 buildLog 流式更新触发重渲染
  const { files, selectedFile, generatorType, spec } = useModStore(
    (s) => ({
      files: s.files,
      selectedFile: s.selectedFile,
      generatorType: s.generatorType,
      spec: s.spec,
    }),
    shallow,
  );
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  // P3 性能：仅 files/selectedFile 变化时重算 file，避免每次渲染都 O(n) find
  const file = useMemo(() => files.find((f) => f.path === selectedFile), [files, selectedFile]);
  const isPng = selectedFile?.endsWith('.png') ?? false;
  const fileIconName = file ? getFileIcon(file.path) : 'file';

  const handleExport = async () => {
    if (files.length === 0) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const defaultName = computeDefaultName(generatorType, spec);
      const res = await ipcClient.exportZip({ files, defaultName });
      if (res.ok && res.savedPath) {
        setExportMsg({ type: 'success', text: `已导出到：${res.savedPath}` });
      }
    } catch (e) {
      setExportMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const lang =
    file && !isPng
      ? file.path.endsWith('.java')
        ? 'java'
        : file.path.endsWith('.json')
          ? 'json'
          : file.path.endsWith('.gradle')
            ? 'groovy'
            : file.path.endsWith('.toml')
              ? 'ini'
              : 'plaintext'
      : 'plaintext';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-mc-border bg-mc-surface px-3 py-1.5">
        <div className="flex items-center gap-2">
          {file ? (
            <>
              <McIcon scope="pixel" name={fileIconName} size={16} className="text-mc-mute" />
              <span className="max-w-md truncate text-xs text-mc-dim">{file.path}</span>
            </>
          ) : (
            <span className="text-xs text-mc-mute">选择文件预览代码</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {exportMsg?.type === 'success' && (
            <span className="max-w-xs truncate text-xs text-mc-accent">{exportMsg.text}</span>
          )}
          {exportMsg?.type === 'error' && (
            <span className="max-w-xs truncate text-xs text-mc-redstone">{exportMsg.text}</span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting || files.length === 0}
            className="mc-btn-primary"
          >
            {exporting && <Loader2 className="h-3 w-3 animate-spin" />}
            <McIcon scope="pixel" name="download" size={12} />
            导出 zip
          </button>
        </div>
      </div>
      {!file ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-mc-bg">
          <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
            <McIcon scope="pixel" name="terminal" size={32} className="text-mc-mute" />
          </div>
          <div className="text-sm font-medium text-mc-dim">选择文件预览代码</div>
          <div className="text-xs text-mc-mute">点击左侧文件树中的文件</div>
        </div>
      ) : isPng ? (
        <PngPreview file={file} />
      ) : (
        <div className="flex-1 overflow-hidden bg-mc-bg">
          <Editor
            height="100%"
            path={file.path}
            language={lang}
            theme={MC_MONACO_THEME}
            onMount={defineMcMonacoTheme}
            value={file.content}
            options={{ ...mcEditorOptions, readOnly: true }}
          />
        </div>
      )}
    </div>
  );
}
