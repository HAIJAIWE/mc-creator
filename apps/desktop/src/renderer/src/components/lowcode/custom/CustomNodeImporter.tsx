import { useState, useCallback, type ChangeEvent } from 'react';
import { customNodeRegistry } from './customNodeRegistry.js';

interface CustomNodeImporterProps {
  onClose: () => void;
}

/** 读取文件为文本（兼容 jsdom：File.text() 在 jsdom 不可用，用 FileReader） */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

/**
 * 自定义节点 JSON 导入对话框。
 *
 * 用户选择 JSON 文件 → 读取 → customNodeRegistry.importJSON（含 Zod 校验）
 * → 成功显示提示，失败显示错误。
 */
export function CustomNodeImporter({ onClose }: CustomNodeImporterProps) {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = customNodeRegistry.importJSON(text);
      if (result.ok) {
        setMessage({ type: 'success', text: `导入成功：${file.name}` });
      } else {
        setMessage({ type: 'error', text: `导入失败：${result.error}` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `导入失败：${(err as Error).message}` });
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-importer-title"
      onClick={onClose}
    >
      <div
        className="w-[400px] rounded-mc-lg border border-mc-border bg-mc-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="custom-importer-title" className="mb-3 text-sm font-medium text-mc-text">
          导入自定义节点
        </h2>
        <input
          data-testid="file-input"
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          className="mb-3 block w-full text-[11px] text-mc-mute file:mr-2 file:rounded-mc file:border-0 file:bg-mc-surface-2 file:px-2 file:py-1 file:text-[11px] file:text-mc-text"
        />
        {message && (
          <div
            className={`mb-3 rounded-mc px-2 py-1 text-[11px] ${
              message.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-red-500/20 text-red-300'
            }`}
            role="status"
          >
            {message.text}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-mc bg-mc-surface-2 px-3 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
