import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';

export function ChatPanel() {
  const {
    description, setDescription, loader, mcVersion, generatorType,
    spec, setSpec, setFiles, setLoading, setError, loading, error,
  } = useModStore();

  // P19：编辑器文本、原始 spec（用于重置）、解析错误
  const [editorText, setEditorText] = useState('');
  const [originalSpec, setOriginalSpec] = useState('');
  const [specError, setSpecError] = useState<string | null>(null);

  const generateSpec = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateSpec(description, generatorType);
      const text = JSON.stringify(res.spec, null, 2);
      setSpec(res.spec as any);
      setEditorText(text);
      setOriginalSpec(text);
      setSpecError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generateFiles = async () => {
    // P19：用当前编辑器内容（而非原始 spec）
    if (!editorText) return;
    let parsedSpec: unknown;
    try {
      parsedSpec = JSON.parse(editorText);
      setSpecError(null);
    } catch (e) {
      setSpecError((e as Error).message);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateFiles({ loader, mcVersion, spec: parsedSpec, generatorType });
      setFiles(res.files);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    const v = value ?? '';
    setEditorText(v);
    try {
      const parsed = JSON.parse(v);
      setSpec(parsed as any);
      setSpecError(null);
    } catch (e) {
      // JSON 解析失败：不更新 store.spec，仅显示错误
      setSpecError((e as Error).message);
    }
  };

  const resetSpec = () => {
    setEditorText(originalSpec);
    try {
      setSpec(JSON.parse(originalSpec) as any);
      setSpecError(null);
    } catch {
      // 原始 spec 解析失败时忽略
    }
  };

  const placeholder = generatorType === 'mod'
    ? '描述你想要的 mod（如：做一个添加红宝石工具的 mod）'
    : generatorType === 'datapack'
    ? '描述你想要的数据包（如：添加一个钻石换铁的配方）'
    : generatorType === 'modpack'
    ? '描述你想要的整合包（如：性能优化整合包，含 Sodium + Iris）'
    : generatorType === 'server'
    ? '描述你想要的服务器配置（如：20 人生存服，难度 normal，开启白名单）'
    : generatorType === 'texture'
    ? '描述你想要的材质（如：16x16 红色方块材质，蓝色工具材质）'
    : generatorType === 'skin'
    ? '描述你想要的皮肤（如：classic 模型，蓝头发白衣服）'
    : '描述你想要的资源包（如：覆盖石头为红色，添加自定义字体和音效）';

  return (
    <div className="flex flex-col gap-3 border-b border-zinc-800 p-4">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={placeholder}
        className="h-24 rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100"
        disabled={loading}
      />
      <div className="flex gap-2">
        <button
          onClick={generateSpec}
          disabled={loading || !description}
          className="flex items-center gap-2 rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading && (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          生成 Spec
        </button>
        <button
          onClick={generateFiles}
          disabled={loading || !spec}
          className="flex items-center gap-2 rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading && (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          生成代码
        </button>
      </div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {spec && (
        <div className={`rounded border bg-zinc-900 p-2 ${specError ? 'border-red-500' : 'border-zinc-800'}`}>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs text-zinc-400">Spec（可编辑，修改后点生成代码）</div>
            <button
              onClick={resetSpec}
              className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-600"
            >
              重置
            </button>
          </div>
          <Editor
            height="200px"
            language="json"
            theme="vs-dark"
            value={editorText}
            onChange={handleEditorChange}
            options={{ fontSize: 12, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true }}
          />
          {specError && (
            <div className="mt-1 text-xs text-red-400">JSON 解析错误：{specError}</div>
          )}
        </div>
      )}
    </div>
  );
}
