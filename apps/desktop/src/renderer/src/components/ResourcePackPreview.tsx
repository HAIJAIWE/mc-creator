import { useState, useMemo, useCallback } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import {
  ChevronRight,
  ChevronDown,
  Image,
  Box,
  FileJson,
  Layers,
  Upload,
  LayoutGrid,
  List,
  Package,
  GitMerge,
  Eye,
} from 'lucide-react';

/** 分类后的资源文件 */
interface ResourceCategory {
  label: string;
  icon: typeof Image;
  files: Array<{ path: string; content: string }>;
}

/**
 * 资源包实时预览面板：贴图、模型、语言文件的分类浏览和预览。
 * 集成到 MiddlePanel 的 "preview" tab 中。
 */
export function ResourcePackPreview() {
  const files = useModStore((s) => s.files);
  const createFile = useModStore((s) => s.createFile);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['textures']));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showModelStructure, setShowModelStructure] = useState(true);

  // 导入资源文件：弹出文件选择框 → 读取 → 加入 files 列表
  const handleImport = useCallback(
    async (extensions?: string[]) => {
      setImporting(true);
      try {
        const res = await ipcClient.importResourceFiles({
          title: '导入资源文件',
          extensions: extensions ?? ['png', 'ogg', 'json', 'lang', 'mcmeta'],
          multiSelect: true,
        });
        if (!res.ok || res.files.length === 0) return;
        // 将导入的文件加入 store（按扩展名分配路径前缀）
        for (const f of res.files) {
          let prefix: string;
          if (f.ext === 'png' || f.ext === 'mcmeta') prefix = 'assets/minecraft/textures';
          else if (f.ext === 'ogg') prefix = 'assets/minecraft/sounds';
          else if (f.ext === 'json') prefix = 'assets/minecraft/models';
          else prefix = 'assets/minecraft';
          const virtualPath = `${prefix}/${f.fileName}`;
          createFile(virtualPath, f.base64);
        }
      } catch {
        // 导入失败不阻塞 UI
      } finally {
        setImporting(false);
      }
    },
    [createFile],
  );

  // 按类型分类
  const categories = useMemo<ResourceCategory[]>(() => {
    const cats: ResourceCategory[] = [
      { label: '贴图 (textures)', icon: Image, files: [] },
      { label: '模型 (models)', icon: Box, files: [] },
      { label: '语言 (lang)', icon: FileJson, files: [] },
      { label: '音效 (sounds)', icon: Layers, files: [] },
      { label: '其他资源', icon: FileJson, files: [] },
    ];

    for (const f of files) {
      if (f.path.includes('textures/') && (f.path.endsWith('.png') || f.path.endsWith('.mcmeta'))) {
        cats[0].files.push(f);
      } else if (f.path.includes('models/') && f.path.endsWith('.json')) {
        cats[1].files.push(f);
      } else if (f.path.includes('lang/') && f.path.endsWith('.json')) {
        cats[2].files.push(f);
      } else if (
        f.path.includes('sounds') &&
        (f.path.endsWith('.json') || f.path.endsWith('.ogg'))
      ) {
        cats[3].files.push(f);
      } else if (
        f.path.includes('assets/') &&
        !f.path.includes('textures/') &&
        !f.path.includes('models/') &&
        !f.path.includes('lang/')
      ) {
        cats[4].files.push(f);
      }
    }

    return cats.filter((c) => c.files.length > 0);
  }, [files]);

  const selectedContent = useMemo(() => {
    if (!selectedFile) return null;
    return files.find((f) => f.path === selectedFile);
  }, [files, selectedFile]);

  // pack.png 检测
  const packIcon = useMemo(() => {
    return files.find((f) => f.path.endsWith('pack.png'));
  }, [files]);

  // 语言文件覆盖检测（同名语言键在不同文件中出现）
  const langOverrides = useMemo(() => {
    const langFiles = files.filter((f) => f.path.includes('lang/') && f.path.endsWith('.json'));
    if (langFiles.length < 2) return new Map<string, string[]>();
    // 收集所有语言键及其来源文件
    const keySources = new Map<string, string[]>();
    for (const lf of langFiles) {
      try {
        const obj = JSON.parse(lf.content);
        for (const key of Object.keys(obj)) {
          const sources = keySources.get(key) ?? [];
          sources.push(lf.path.split('/').pop() ?? lf.path);
          keySources.set(key, sources);
        }
      } catch {
        /* skip invalid JSON */
      }
    }
    // 只返回有覆盖的键
    const overrides = new Map<string, string[]>();
    for (const [key, sources] of keySources) {
      if (sources.length > 1) overrides.set(key, sources);
    }
    return overrides;
  }, [files]);

  // 贴图文件列表（用于网格视图）
  const textureFiles = useMemo(() => {
    return files.filter(
      (f) =>
        f.path.includes('textures/') && (f.path.endsWith('.png') || f.path.endsWith('.mcmeta')),
    );
  }, [files]);

  const toggleCategory = (label: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const catKeys = ['textures', 'models', 'lang', 'sounds', 'other'];

  if (categories.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <McIcon scope="pixel" name="image" size={48} className="text-mc-mute" />
        <div className="text-sm text-mc-dim">暂无资源文件</div>
        <div className="text-xs text-mc-mute">生成资源包后可在此预览贴图和模型，或手动导入</div>
        <button
          onClick={() => handleImport()}
          disabled={importing}
          className="mt-2 flex items-center gap-1.5 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1.5 text-xs font-medium text-mc-text transition-colors hover:bg-mc-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload className="h-3 w-3" />
          {importing ? '导入中…' : '导入资源文件'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-mc-border bg-mc-surface px-3 py-1">
        {/* pack.png 图标 */}
        {packIcon && (
          <div className="flex items-center gap-1.5" title="资源包图标 (pack.png)">
            <Package className="h-3 w-3 text-mc-accent" />
            <div
              className="h-5 w-5 overflow-hidden rounded border border-mc-border"
              style={{ imageRendering: 'pixelated' }}
            >
              <img
                src={`data:image/png;base64,${packIcon.content}`}
                alt="pack icon"
                className="h-full w-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </div>
        )}
        {/* 语言覆盖指示器 */}
        {langOverrides.size > 0 && (
          <div
            className="flex items-center gap-1 text-[10px] text-yellow-400"
            title={`${langOverrides.size} 个语言键被覆盖`}
          >
            <GitMerge className="h-3 w-3" />
            {langOverrides.size} 覆盖
          </div>
        )}
        <button
          onClick={() => handleImport(['png', 'mcmeta'])}
          disabled={importing}
          className="flex items-center gap-1 rounded-mc px-2 py-0.5 text-[11px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
          title="导入贴图"
        >
          <Upload className="h-3 w-3" />
          贴图
        </button>
        <button
          onClick={() => handleImport(['ogg'])}
          disabled={importing}
          className="flex items-center gap-1 rounded-mc px-2 py-0.5 text-[11px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
          title="导入音效"
        >
          <Upload className="h-3 w-3" />
          音效
        </button>
        <button
          onClick={() => handleImport(['json'])}
          disabled={importing}
          className="flex items-center gap-1 rounded-mc px-2 py-0.5 text-[11px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
          title="导入模型/语言"
        >
          <Upload className="h-3 w-3" />
          JSON
        </button>
        <button
          onClick={() => handleImport()}
          disabled={importing}
          className="flex items-center gap-1 rounded-mc px-2 py-0.5 text-[11px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
          title="导入所有类型"
        >
          <Upload className="h-3 w-3" />
          全部
        </button>
        {importing && <span className="text-[10px] text-mc-mute">导入中…</span>}
        {/* 视图模式切换 */}
        <div className="ml-auto flex items-center gap-0.5 rounded-mc border border-mc-border p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={`rounded-mc p-0.5 transition-colors ${viewMode === 'grid' ? 'bg-mc-accent/20 text-mc-accent-bright' : 'text-mc-mute hover:text-mc-text'}`}
            title="网格视图"
          >
            <LayoutGrid className="h-3 w-3" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`rounded-mc p-0.5 transition-colors ${viewMode === 'list' ? 'bg-mc-accent/20 text-mc-accent-bright' : 'text-mc-mute hover:text-mc-text'}`}
            title="列表视图"
          >
            <List className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：资源分类树 / 网格视图 */}
        {viewMode === 'grid' ? (
          <div className="w-52 flex-shrink-0 overflow-y-auto border-r border-mc-border bg-mc-surface p-2">
            <div className="mb-2 text-[10px] font-medium text-mc-dim">贴图网格</div>
            <div className="grid grid-cols-3 gap-1.5">
              {textureFiles.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setSelectedFile(f.path)}
                  className={`group relative flex flex-col items-center rounded-mc border p-1 transition-colors ${
                    selectedFile === f.path
                      ? 'border-mc-accent bg-mc-accent/10'
                      : 'border-mc-border bg-mc-surface-2/40 hover:bg-mc-surface-2'
                  }`}
                  title={f.path}
                >
                  {f.path.endsWith('.png') ? (
                    <img
                      src={`data:image/png;base64,${f.content}`}
                      alt={f.path.split('/').pop()}
                      className="h-10 w-10 object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  ) : (
                    <Image className="h-6 w-6 text-mc-mute" />
                  )}
                  <span className="mt-0.5 truncate text-center text-[8px] text-mc-mute">
                    {f.path.split('/').pop()?.replace('.png', '')}
                  </span>
                </button>
              ))}
            </div>
            {textureFiles.length === 0 && (
              <div className="py-6 text-center text-[10px] text-mc-mute">暂无贴图文件</div>
            )}
          </div>
        ) : (
          <div className="w-52 flex-shrink-0 overflow-y-auto border-r border-mc-border bg-mc-surface">
            {categories.map((cat, i) => (
              <div key={cat.label}>
                <button
                  onClick={() => toggleCategory(catKeys[i])}
                  className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-medium text-mc-dim hover:bg-mc-surface-2"
                >
                  {expandedCategories.has(catKeys[i]) ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <cat.icon className="h-3 w-3 text-mc-mute" />
                  <span className="truncate">{cat.label}</span>
                  <span className="ml-auto text-[10px] text-mc-mute">{cat.files.length}</span>
                </button>
                {expandedCategories.has(catKeys[i]) && (
                  <div className="ml-4">
                    {cat.files.map((f) => (
                      <button
                        key={f.path}
                        onClick={() => setSelectedFile(f.path)}
                        className={`flex w-full items-center gap-1 px-2 py-1 text-[11px] transition-colors ${
                          selectedFile === f.path
                            ? 'bg-mc-accent/20 text-mc-accent-bright'
                            : 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
                        }`}
                        title={f.path}
                      >
                        <McIcon scope="pixel" name="file-text" size={10} className="shrink-0" />
                        <span className="truncate">{f.path.split('/').pop()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 右侧：预览区域 */}
        <div className="flex-1 overflow-y-auto bg-mc-bg p-4">
          {selectedContent ? (
            <ResourcePreviewContent
              path={selectedContent.path}
              content={selectedContent.content}
              langOverrides={langOverrides}
              showModelStructure={showModelStructure}
              onToggleModelStructure={() => setShowModelStructure(!showModelStructure)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="text-sm text-mc-mute">选择左侧资源文件预览</div>
              {packIcon && (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <div className="text-[10px] text-mc-dim">资源包图标</div>
                  <div
                    className="overflow-hidden rounded-mc border border-mc-border"
                    style={{
                      background:
                        'repeating-conic-gradient(#3c3c3c 0% 25%, #2c2c2c 0% 50%) 0 0 / 16px 16px',
                      padding: 8,
                    }}
                  >
                    <img
                      src={`data:image/png;base64,${packIcon.content}`}
                      alt="pack icon"
                      className="h-32 w-32 object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 资源预览内容：根据文件类型渲染不同预览 */
function ResourcePreviewContent({
  path,
  content,
  langOverrides,
  showModelStructure,
  onToggleModelStructure,
}: {
  path: string;
  content: string;
  langOverrides: Map<string, string[]>;
  showModelStructure: boolean;
  onToggleModelStructure: () => void;
}) {
  // PNG 贴图预览（base64 内嵌）
  if (path.endsWith('.png')) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-xs font-medium text-mc-text">{path}</div>
        {/* MC 风格的棋盘格背景 */}
        <div
          className="relative"
          style={{
            background: 'repeating-conic-gradient(#3c3c3c 0% 25%, #2c2c2c 0% 50%) 0 0 / 16px 16px',
            padding: 8,
            borderRadius: 4,
          }}
        >
          <img
            src={`data:image/png;base64,${content}`}
            alt={path}
            className="max-h-64 max-w-64 object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
        <div className="text-[10px] text-mc-mute">像素风格渲染（image-rendering: pixelated）</div>
      </div>
    );
  }

  // 模型 JSON 预览（结构化展示）
  if (path.includes('models/') && path.endsWith('.json')) {
    return (
      <ModelPreview
        path={path}
        content={content}
        showStructure={showModelStructure}
        onToggleStructure={onToggleModelStructure}
      />
    );
  }

  // 语言文件预览（键值对表）
  if (path.includes('lang/') && path.endsWith('.json')) {
    return <LangPreview path={path} content={content} langOverrides={langOverrides} />;
  }

  // 通用 JSON 预览
  if (path.endsWith('.json')) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium text-mc-text">{path}</div>
        <pre className="max-h-96 overflow-auto rounded-mc bg-mc-surface p-3 font-mono text-[11px] text-mc-text">
          {tryFormatJson(content)}
        </pre>
      </div>
    );
  }

  // 其他文件
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-mc-text">{path}</div>
      <pre className="max-h-96 overflow-auto rounded-mc bg-mc-surface p-3 font-mono text-[11px] text-mc-text">
        {content.slice(0, 5000)}
        {content.length > 5000 ? '\n\n... [已截断]' : ''}
      </pre>
    </div>
  );
}

/** 模型 JSON 预览：展示模型结构和元素信息 */
function ModelPreview({
  path,
  content,
  showStructure,
  onToggleStructure,
}: {
  path: string;
  content: string;
  showStructure: boolean;
  onToggleStructure: () => void;
}) {
  let model: Record<string, unknown> | null = null;
  try {
    model = JSON.parse(content);
  } catch {
    return <pre className="text-xs text-mc-redstone">{content}</pre>;
  }

  const elements = Array.isArray(model?.elements) ? (model?.elements as unknown[]) : [];
  const textures = (model?.textures as Record<string, string>) || {};
  const parent = model?.parent as string | undefined;
  const display = (model?.display as Record<string, unknown>) || {};
  const overrides = Array.isArray(model?.overrides) ? (model?.overrides as unknown[]) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-mc-text">{path}</div>
        <button
          onClick={onToggleStructure}
          className={`flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-[10px] transition-colors ${showStructure ? 'bg-mc-accent/20 text-mc-accent-bright' : 'text-mc-mute hover:text-mc-text'}`}
          title={showStructure ? '隐藏结构' : '显示结构'}
        >
          <Eye className="h-2.5 w-2.5" />
          {showStructure ? '结构' : '原始'}
        </button>
      </div>

      {!showStructure ? (
        <pre className="max-h-96 overflow-auto rounded-mc bg-mc-surface p-3 font-mono text-[11px] text-mc-text">
          {tryFormatJson(content)}
        </pre>
      ) : (
        <>
          {parent && (
            <div className="text-xs text-mc-dim">
              继承：<span className="font-mono text-mc-accent-bright">{parent}</span>
            </div>
          )}

          {/* 纹理引用 */}
          {Object.keys(textures).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium text-mc-dim">
                纹理变量 ({Object.keys(textures).length})
              </div>
              <div className="space-y-0.5">
                {Object.entries(textures).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-mc-accent-bright">{key}</span>
                    <span className="text-mc-mute">→</span>
                    <span className="text-mc-text">{val}</span>
                    {val.startsWith('#') && (
                      <span className="text-[10px] text-mc-mute">（引用变量）</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 元素信息 */}
          {elements.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium text-mc-dim">
                元素 ({elements.length})
              </div>
              <div className="space-y-1">
                {elements.map((el, i) => {
                  const e = el as Record<string, unknown>;
                  const from = Array.isArray(e.from) ? (e.from as number[]).join(', ') : '?';
                  const to = Array.isArray(e.to) ? (e.to as number[]).join(', ') : '?';
                  const faces = e.faces as Record<string, unknown> | undefined;
                  const faceCount = faces ? Object.keys(faces).length : 0;
                  return (
                    <div key={i} className="rounded-mc bg-mc-surface px-2 py-1 text-[11px]">
                      <span className="text-mc-dim">元素 {i}:</span>{' '}
                      <span className="font-mono text-mc-text">
                        [{from}] → [{to}]
                      </span>
                      {e.rotation != null && <span className="ml-2 text-mc-mute">有旋转</span>}
                      {e.shade === false && <span className="ml-2 text-mc-mute">无阴影</span>}
                      {faceCount > 0 && <span className="ml-2 text-mc-mute">{faceCount} 面</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 显示变换 (display) */}
          {Object.keys(display).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium text-mc-dim">
                显示变换 ({Object.keys(display).length})
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.keys(display).map((key) => (
                  <span
                    key={key}
                    className="rounded-mc bg-mc-surface px-1.5 py-0.5 font-mono text-[10px] text-mc-dim"
                  >
                    {key}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 覆盖 (overrides) */}
          {overrides.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium text-mc-dim">
                条件覆盖 ({overrides.length})
              </div>
              <div className="space-y-0.5">
                {overrides.map((ov, i) => {
                  const o = ov as Record<string, unknown>;
                  return (
                    <div key={i} className="font-mono text-[10px] text-mc-dim">
                      predicate: {JSON.stringify(o.predicate)} → model:{' '}
                      <span className="text-mc-accent-bright">{String(o.model)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* 完整 JSON（折叠） */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-mc-mute hover:text-mc-dim">
          查看完整 JSON
        </summary>
        <pre className="mt-1 max-h-64 overflow-auto rounded-mc bg-mc-surface p-2 font-mono text-[11px] text-mc-text">
          {tryFormatJson(content)}
        </pre>
      </details>
    </div>
  );
}

/** 语言文件预览：键值对表 */
function LangPreview({
  path,
  content,
  langOverrides,
}: {
  path: string;
  content: string;
  langOverrides: Map<string, string[]>;
}) {
  let entries: [string, string][] = [];
  try {
    const obj = JSON.parse(content);
    entries = Object.entries(obj);
  } catch {
    return <pre className="text-xs text-mc-redstone">{content}</pre>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-mc-text">
          {path} ({entries.length} 条)
        </div>
        {langOverrides.size > 0 && (
          <div
            className="flex items-center gap-1 text-[10px] text-yellow-400"
            title={`${langOverrides.size} 个键被其他语言文件覆盖`}
          >
            <GitMerge className="h-2.5 w-2.5" />
            {langOverrides.size} 覆盖
          </div>
        )}
      </div>
      <div className="max-h-96 overflow-auto rounded-mc border border-mc-border">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-mc-surface-2">
            <tr>
              <th className="px-2 py-1 text-left font-medium text-mc-dim">键</th>
              <th className="px-2 py-1 text-left font-medium text-mc-dim">值</th>
              <th className="w-16 px-2 py-1 text-left font-medium text-mc-dim">状态</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, val]) => {
              const isOverridden = langOverrides.has(key);
              return (
                <tr
                  key={key}
                  className={`border-t border-mc-border hover:bg-mc-surface-2/50 ${isOverridden ? 'bg-yellow-900/10' : ''}`}
                >
                  <td className="px-2 py-1 font-mono text-mc-accent-bright">{key}</td>
                  <td className="px-2 py-1 text-mc-text">{val}</td>
                  <td className="px-2 py-1">
                    {isOverridden && (
                      <span
                        className="flex items-center gap-1 text-[9px] text-yellow-400"
                        title={`覆盖来源：${langOverrides.get(key)?.join(', ')}`}
                      >
                        <GitMerge className="h-2.5 w-2.5" />
                        覆盖
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 尝试格式化 JSON */
function tryFormatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
