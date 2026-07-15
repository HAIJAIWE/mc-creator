import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import type { FileNode } from '@mc-creator/shared';
import type { GeneratorType } from '../../../shared/ipc-channels.js';

/** 从 PNG base64 content 解析 IHDR 中的 width/height（big-endian） */
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
      <div className="mb-2 text-xs font-semibold text-zinc-400">PNG 预览</div>
      <div className="flex flex-col items-center gap-3">
        <div
          style={{
            backgroundImage:
              'linear-gradient(45deg, #555 25%, transparent 25%), linear-gradient(-45deg, #555 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #555 75%), linear-gradient(-45deg, transparent 75%, #555 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            backgroundColor: '#333',
          }}
          className="inline-block rounded"
        >
          <img
            src={dataUrl}
            alt={file.path}
            style={{ maxWidth: 512, maxHeight: 512 }}
            className="block"
          />
        </div>
        <div className="break-all text-center text-xs text-zinc-500">
          {file.path}
          {size && <span className="ml-2 text-zinc-400">（{size.width}×{size.height}）</span>}
        </div>
      </div>
    </div>
  );
}

/** 根据 generatorType + spec 计算导出 zip 的默认文件名 */
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
  const { files, selectedFile, generatorType, spec } = useModStore();
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const file = files.find((f) => f.path === selectedFile);
  const isPng = selectedFile?.endsWith('.png') ?? false;

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
      // 用户取消时不报错
    } catch (e) {
      setExportMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const lang = file && !isPng
    ? file.path.endsWith('.java') ? 'java'
      : file.path.endsWith('.json') ? 'json'
      : file.path.endsWith('.gradle') ? 'groovy'
      : file.path.endsWith('.toml') ? 'ini'
      : 'plaintext'
    : 'plaintext';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <button
          onClick={handleExport}
          disabled={exporting || files.length === 0}
          className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {exporting && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          导出 zip
        </button>
        {exportMsg?.type === 'success' && (
          <span className="truncate text-xs text-green-400">{exportMsg.text}</span>
        )}
        {exportMsg?.type === 'error' && (
          <span className="truncate text-xs text-red-400">{exportMsg.text}</span>
        )}
      </div>
      {!file ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">选择文件预览代码</div>
      ) : isPng ? (
        <PngPreview file={file} />
      ) : (
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            path={file.path}
            language={lang}
            value={file.content}
            theme="vs-dark"
            options={{ readOnly: true, fontSize: 13, minimap: { enabled: false } }}
          />
        </div>
      )}
    </div>
  );
}
