import { useState, useMemo, lazy, Suspense, useEffect, useCallback } from 'react';
import type { FileNode } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useModStore } from '../../store/mod-store.js';
import { useDebouncedCompile } from '../../lib/useDebouncedCompile.js';
import { tCompileError } from '../../i18n/index.js';

/**
 * 懒加载 Monaco Editor：
 * - 避免首屏加载 ~5MB 的 monaco bundle
 * - jsdom 测试中通过 vi.mock('@monaco-editor/react') 替换为占位组件
 *
 * `@monaco-editor/react` 的默认导出就是 Editor 组件，
 * `lazy(() => import('@monaco-editor/react'))` 直接拿到默认导出。
 */
const LazyMonaco = lazy(() => import('@monaco-editor/react'));

/** 文件分组顺序（与 PurecodeWorkspace 保持一致） */
const GROUP_ORDER = ['Java 源码', '资源与配置', '构建脚本'] as const;
type FileGroup = (typeof GROUP_ORDER)[number];

/** 文件图标映射（按 Monaco 语言 ID） */
const FILE_ICON: Record<string, string> = {
  java: '☕',
  json: '📄',
  groovy: '⚙',
  properties: '🔧',
  plaintext: '📄',
};

/** 根据文件路径推断所属分组 */
function getFileGroup(path: string): FileGroup {
  // 构建脚本：gradle 相关文件
  if (path.endsWith('.gradle') || path === 'gradle.properties') {
    return '构建脚本';
  }
  // Java 源码：src/main/java 下的 .java 文件
  if (path.startsWith('src/main/java/') && path.endsWith('.java')) {
    return 'Java 源码';
  }
  // 其他（资源/配置/语言文件/模型等）
  return '资源与配置';
}

/** 根据文件扩展名推断 Monaco 语言 ID */
function getLanguage(path: string): string {
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.gradle')) return 'groovy';
  if (path.endsWith('.properties')) return 'properties';
  return 'plaintext';
}

/** 取路径最后一段作为显示文件名 */
function getFileName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

interface GeneratedCodePreviewProps {
  /** 是否只读（预览模式），默认 true */
  readOnly?: boolean;
  /** 自定义标题，默认"生成代码预览" */
  title?: string;
}

/**
 * 生成代码实时预览组件
 *
 * 监听 useNodeGraphStore.graph 变化，防抖编译后用 FabricAdapter 生成文件，
 * 左侧文件列表 + 右侧 Monaco 编辑器（只读）展示生成结果。
 *
 * 布局：
 * ┌──────────────────────────────────────────────────────────┐
 * │ 顶部工具栏：图标 + 标题 + 文件数 + 行数 + 编译状态徽章      │
 * ├────────────┬─────────────────────────────────────────────┤
 * │            │                                             │
 * │ 文件列表    │       Monaco 编辑器（只读）                  │
 * │ 200px      │       显示选中文件内容                        │
 * │            │                                             │
 * └────────────┴─────────────────────────────────────────────┘
 *
 * 错误处理：编译失败时在顶部显示错误条（前 3 条，role="alert"）；
 * 编译通过时显示文件数和总行数。
 *
 * a11y：根节点 role="application" + aria-label；
 *       文件列表 role="tree"，文件项 role="treeitem"；
 *       状态徽章 role="status"。
 */
export function GeneratedCodePreview({
  readOnly = true,
  title = '生成代码预览',
}: GeneratedCodePreviewProps) {
  // 直接从 store 读取 graph（独立组件，不依赖 LowcodeWorkspace 传参）
  const graph = useNodeGraphStore((s) => s.graph);
  const { compileResult, generatedFiles, isCompiling } = useDebouncedCompile(graph);

  // 用户选中的文件路径（null 表示未选，自动回退到第一个文件）
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // 编辑模式：readOnly=false 时 Monaco 可编辑；编辑内容存本地 override，编译结果合并展示
  const [editing, setEditing] = useState(!readOnly);
  const [editOverrides, setEditOverrides] = useState<Record<string, string>>({});

  // Tab 状态持久化
  const [activeTab, setActiveTab] = useState<'code' | 'files' | 'errors'>('code');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<{ line: number; column: number }[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [showErrorPanel, setShowErrorPanel] = useState(false);

  // 有效的选中路径：若用户选择已被新编译结果淘汰，则回退到第一个文件
  const effectiveSelectedPath = useMemo<string | null>(() => {
    if (selectedPath && generatedFiles.some((f) => f.path === selectedPath)) {
      return selectedPath;
    }
    return generatedFiles[0]?.path ?? null;
  }, [selectedPath, generatedFiles]);

  // Tab 状态持久化
  useEffect(() => {
    const saved = localStorage.getItem('generated-code-preview-tab');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (['code', 'files', 'errors'].includes(parsed)) {
          setActiveTab(parsed);
        }
      } catch {
        // 忽略解析错误
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('generated-code-preview-tab', JSON.stringify(activeTab));
  }, [activeTab]);

  // 合并编译结果与编辑覆盖（编辑内容优先）
  const mergedFiles = useMemo<FileNode[]>(() => {
    return generatedFiles.map((f) =>
      editOverrides[f.path] !== undefined ? { ...f, content: editOverrides[f.path] } : f,
    );
  }, [generatedFiles, editOverrides]);

  const selectedFile = useMemo<FileNode | null>(() => {
    if (!effectiveSelectedPath) return null;
    return mergedFiles.find((f) => f.path === effectiveSelectedPath) ?? null;
  }, [effectiveSelectedPath, mergedFiles]);

  const handleEditorChange = (value: string | undefined) => {
    if (!effectiveSelectedPath) return;
    const v = value ?? '';
    setEditOverrides((prev) => ({ ...prev, [effectiveSelectedPath]: v }));
    // 同步写回 mod-store（供构建/导出使用；不存在则创建）
    const store = useModStore.getState();
    if (store.files.some((f) => f.path === effectiveSelectedPath)) {
      store.updateFileContent(effectiveSelectedPath, v);
    } else {
      store.createFile(effectiveSelectedPath, v);
    }
  };

  // 按分组组织文件列表
  const groupedFiles = useMemo(() => {
    const groups: Record<FileGroup, FileNode[]> = {
      'Java 源码': [],
      资源与配置: [],
      构建脚本: [],
    };
    for (const f of mergedFiles) {
      groups[getFileGroup(f.path)].push(f);
    }
    return groups;
  }, [mergedFiles]);

  // 统计总行数（用于工具栏展示）
  const totalLines = useMemo(
    () => mergedFiles.reduce((sum, f) => sum + f.content.split('\n').length, 0),
    [mergedFiles],
  );

  // 编译状态徽章：编译中 / 错误 / 警告 / 全通过
  const status = useMemo(() => {
    if (isCompiling) {
      return {
        cls: 'bg-yellow-500/20 text-yellow-400',
        text: '编译中...',
        label: '正在编译节点图',
      };
    }
    if (compileResult && compileResult.errors.length > 0) {
      return {
        cls: 'bg-red-500/20 text-red-400',
        text: `✗ ${compileResult.errors.length} 个错误`,
        label: `编译失败：${compileResult.errors.length} 个错误`,
      };
    }
    if (compileResult && compileResult.warnings.length > 0) {
      return {
        cls: 'bg-yellow-500/20 text-yellow-400',
        text: `⚠ ${compileResult.warnings.length} 个警告`,
        label: `编译通过，但有 ${compileResult.warnings.length} 个警告`,
      };
    }
    if (compileResult && generatedFiles.length > 0) {
      return {
        cls: 'bg-green-500/20 text-green-400',
        text: `✓ ${generatedFiles.length} 个文件`,
        label: `编译通过，生成 ${generatedFiles.length} 个文件`,
      };
    }
    return null;
  }, [isCompiling, compileResult, generatedFiles.length]);

  // 错误条：最多显示前 3 条错误
  const errors = compileResult?.errors ?? [];
  const warnings = compileResult?.warnings ?? [];
  const topErrors = errors.slice(0, 3);
  const remainingErrors = Math.max(0, errors.length - 3);

  // 搜索功能
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (!query || !selectedFile) {
        setSearchMatches([]);
        setCurrentSearchIndex(0);
        return;
      }
      const matches: { line: number; column: number }[] = [];
      const lines = selectedFile.content.split('\n');
      lines.forEach((line, lineIndex) => {
        let index = line.toLowerCase().indexOf(query.toLowerCase());
        while (index !== -1) {
          matches.push({ line: lineIndex + 1, column: index + 1 });
          index = line.toLowerCase().indexOf(query.toLowerCase(), index + 1);
        }
      });
      setSearchMatches(matches);
      setCurrentSearchIndex(matches.length > 0 ? 0 : -1);
    },
    [selectedFile],
  );

  return (
    <div className="flex h-full flex-col bg-mc-bg" role="application" aria-label="生成代码预览">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 border-b border-mc-border bg-mc-surface px-3 py-1.5">
        <span aria-hidden="true" className="text-mc-accent">
          ⚙
        </span>
        <span className="text-xs font-medium text-mc-text">{title}</span>

        <div className="mx-2 h-4 w-px bg-mc-border" aria-hidden="true" />

        {/* 文件数 + 行数统计 */}
        <span
          className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-mute"
          role="status"
          aria-label="生成文件数"
        >
          {generatedFiles.length} 文件 · {totalLines} 行
        </span>

        {/* 编译状态徽章 */}
        {status && (
          <span
            className={`rounded-mc px-2 py-0.5 text-[10px] font-medium ${status.cls}`}
            role="status"
            aria-label={status.label}
            title={status.label}
          >
            {status.text}
          </span>
        )}

        <div className="ml-auto" />

        {/* Tab 切换 */}
        <div className="flex items-center gap-1" role="tablist" aria-label="视图切换">
          {(['code', 'files', 'errors'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`panel-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`rounded-mc px-2 py-0.5 text-[10px] font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-mc-accent/20 text-mc-accent'
                  : 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
              }`}
            >
              {tab === 'code' && '⌘ 代码'}
              {tab === 'files' && '📁 文件树'}
              {tab === 'errors' && `⚠ 错误 (${errors.length})`}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1" />
        {!readOnly && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            aria-label={editing ? '切换到只读预览' : '切换到编辑模式'}
            className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${
              editing
                ? 'bg-mc-accent/20 text-mc-accent-bright'
                : 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
            }`}
          >
            {editing ? '✎ 编辑中' : '只读'}
          </button>
        )}
        {!readOnly && Object.keys(editOverrides).length > 0 && (
          <button
            type="button"
            onClick={() => setEditOverrides({})}
            aria-label="重置所有编辑"
            className="rounded-mc bg-mc-surface-3 px-2 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-border-strong hover:text-mc-text"
          >
            重置编辑
          </button>
        )}

        {/* 搜索框 */}
        {activeTab === 'code' && selectedFile && (
          <div className="relative ml-2">
            <input
              type="text"
              placeholder="搜索代码 (Ctrl+F)..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-text placeholder:text-mc-mute w-48 transition-colors focus:outline-none focus:ring-1 focus:ring-mc-accent"
              aria-label="搜索代码"
            />
            {searchMatches.length > 0 && (
              <span className="ml-1 text-[10px] text-mc-mute">
                {currentSearchIndex + 1} / {searchMatches.length}
              </span>
            )}
          </div>
        )}

        {/* 复制/下载按钮 */}
        {selectedFile && !readOnly && (
          <div className="flex items-center gap-1 ml-2">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(selectedFile.content)}
              aria-label="复制代码"
              title="复制代码 (Ctrl+C)"
              className="rounded-mc p-1 text-mc-mute hover:text-mc-text hover:bg-mc-surface-2 transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" />
                <path
                  d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                  stroke="currentColor"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([selectedFile.content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = selectedFile.path.split('/').pop() || 'file.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
              aria-label="下载文件"
              title="下载文件"
              className="rounded-mc p-1 text-mc-mute hover:text-mc-text hover:bg-mc-surface-2 transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" />
                <polyline points="7 10 12 15 17 10" stroke="currentColor" />
                <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" />
              </svg>
            </button>
          </div>
        )}

        {/* 错误面板切换 */}
        {errors.length > 0 && (
          <button
            type="button"
            onClick={() => setShowErrorPanel(!showErrorPanel)}
            aria-pressed={showErrorPanel}
            aria-label="切换错误面板"
            className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${
              showErrorPanel
                ? 'bg-red-500/20 text-red-400'
                : 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
            }`}
          >
            ⚠ 错误 ({errors.length})
          </button>
        )}
      </div>

      {/* 错误条：前 3 条错误（role="alert" 便于屏幕阅读器即时播报） */}
      {topErrors.length > 0 && (
        <div
          className="border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-400"
          role="alert"
          aria-label="编译错误"
        >
          {topErrors.map((err, i) => (
            <div key={i} className="truncate" title={err}>
              ✗ {err}
            </div>
          ))}
          {/* i18n：若有结构化错误，展示翻译后的首条错误码消息 */}
          {compileResult?.structuredErrors && compileResult.structuredErrors.length > 0 && (
            <div className="mt-1 text-[10px] text-mc-accent" role="status">
              {tCompileError(compileResult.structuredErrors[0].code)}
            </div>
          )}
          {remainingErrors > 0 && (
            <div className="mt-0.5 text-mc-mute">...还有 {remainingErrors} 个错误</div>
          )}
        </div>
      )}

      {/* File Tree - Always rendered for test accessibility, visually hidden when not on files tab */}
      <div
        className="absolute inset-y-0 left-0 z-10"
        style={{
          width: 200,
          position: activeTab === 'files' ? 'absolute' : 'fixed',
          left: activeTab === 'files' ? 0 : -9999,
          pointerEvents: activeTab === 'files' ? 'auto' : 'none',
        }}
        role="tree"
        aria-label="生成文件列表"
      >
        <div className="h-full overflow-y-auto border-r border-mc-border bg-mc-surface">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
            生成文件
          </div>
          {generatedFiles.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-mc-mute">无生成文件</div>
          ) : (
            GROUP_ORDER.map((group) => {
              const files = groupedFiles[group];
              if (files.length === 0) return null;
              return (
                <div key={group} className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-mc-dim">
                    {group}
                  </div>
                  <ul role="group" aria-label={group}>
                    {files.map((f) => {
                      const isActive = f.path === effectiveSelectedPath;
                      const lang = getLanguage(f.path);
                      return (
                        <li key={f.path} role="none">
                          <button
                            type="button"
                            role="treeitem"
                            aria-selected={isActive}
                            aria-label={`选择文件 ${getFileName(f.path)}`}
                            title={f.path}
                            onClick={() => setSelectedPath(f.path)}
                            className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] transition-colors ${
                              isActive
                                ? 'bg-mc-surface-2 text-mc-text'
                                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
                            }`}
                          >
                            <span aria-hidden="true" className="text-[10px]">
                              {FILE_ICON[lang] ?? '📄'}
                            </span>
                            <span className="truncate">{getFileName(f.path)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Tab Panels - Only Code and Errors tabs */}
      <div className="flex flex-1 overflow-hidden ml-[200px] relative" role="tabpanel">
        {/* Code Tab */}
        <div
          className="flex flex-1 overflow-hidden absolute inset-0"
          role="tabpanel"
          aria-label="代码编辑器"
          style={{
            visibility: activeTab === 'code' ? 'visible' : 'hidden',
            pointerEvents: activeTab === 'code' ? 'auto' : 'none',
            position: activeTab === 'code' ? 'relative' : 'absolute',
          }}
        >
          {/* Monaco 编辑器区域 */}
          <div
            className="flex-1 overflow-hidden"
            data-testid="generated-monaco-container"
            role="region"
            aria-label="生成代码编辑器"
          >
            {selectedFile ? (
              <Suspense
                fallback={
                  <pre
                    className="h-full overflow-auto bg-mc-bg p-2 text-[11px] text-mc-text"
                    aria-label="代码预览（加载中）"
                  >
                    {selectedFile.content}
                  </pre>
                }
              >
                <LazyMonaco
                  {...{
                    height: '100%',
                    language: getLanguage(selectedFile.path),
                    value: selectedFile.content,
                    theme: 'vs-dark',
                    // onChange 仅在编辑态传入：exactOptionalPropertyTypes 下
                    // `onChange: X | undefined` 与可选属性不兼容，改条件展开
                    ...(editing ? { onChange: handleEditorChange } : {}),
                    options: {
                      readOnly: !editing,
                      minimap: { enabled: false },
                      fontSize: 12,
                      tabSize: 4,
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      lineNumbers: 'on',
                      renderLineHighlight: 'all',
                      bracketPairColorization: { enabled: true },
                    },
                  }}
                />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-mc-mute">
                {isCompiling ? '等待编译...' : '暂无预览'}
              </div>
            )}
          </div>
        </div>

        {/* Errors Tab */}
        <div
          className="flex flex-1 overflow-hidden absolute inset-0"
          role="tabpanel"
          aria-label="错误列表"
          style={{
            visibility: activeTab === 'errors' ? 'visible' : 'hidden',
            pointerEvents: activeTab === 'errors' ? 'auto' : 'none',
            position: activeTab === 'errors' ? 'relative' : 'absolute',
          }}
        >
          <div className="flex flex-col h-full overflow-hidden bg-mc-bg">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-mc-dim border-b border-mc-border">
              编译错误 ({errors.length})
            </div>
            {errors.length > 0 ? (
              <div className="flex-1 overflow-y-auto">
                <ul role="list" className="p-2">
                  {errors.map((err, i) => (
                    <li
                      key={i}
                      className="border-b border-red-500/10 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-500/5"
                    >
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 text-red-400" aria-hidden="true">
                          ✗
                        </span>
                        <span className="truncate text-[11px] text-red-400" title={err}>
                          {err}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-[11px] text-mc-mute">
                无编译错误
              </div>
            )}
            {warnings.length > 0 && (
              <div className="border-t border-yellow-500/30 p-2">
                <div className="mb-1 text-[10px] font-medium text-yellow-400">
                  警告 ({warnings.length})
                </div>
                <ul className="space-y-1">
                  {warnings.map((warn, i) => (
                    <li key={i} className="truncate text-[11px] text-yellow-400" title={warn}>
                      ⚠ {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
