import { useState, useMemo, lazy, Suspense } from 'react';
import type { FileNode } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useModStore } from '../../store/mod-store.js';
import { useDebouncedCompile } from '../../lib/useDebouncedCompile.js';

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

  // 有效的选中路径：若用户选择已被新编译结果淘汰，则回退到第一个文件
  const effectiveSelectedPath = useMemo<string | null>(() => {
    if (selectedPath && generatedFiles.some((f) => f.path === selectedPath)) {
      return selectedPath;
    }
    return generatedFiles[0]?.path ?? null;
  }, [selectedPath, generatedFiles]);

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
  const topErrors = errors.slice(0, 3);
  const remainingErrors = Math.max(0, errors.length - 3);

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

        {/* 编辑模式切换（仅当外部未强制只读时可用） */}
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
          {remainingErrors > 0 && (
            <div className="mt-0.5 text-mc-mute">...还有 {remainingErrors} 个错误</div>
          )}
        </div>
      )}

      {/* 内容区：文件列表 + Monaco 编辑器 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：文件列表（200px） */}
        <div
          className="shrink-0 overflow-y-auto border-r border-mc-border bg-mc-surface"
          style={{ width: 200 }}
          role="tree"
          aria-label="生成文件列表"
        >
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

        {/* 右侧：Monaco 编辑器（懒加载，Suspense fallback 用 pre 显示纯文本） */}
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
                height="100%"
                language={getLanguage(selectedFile.path)}
                value={selectedFile.content}
                theme="vs-dark"
                onChange={editing ? handleEditorChange : undefined}
                options={{
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
    </div>
  );
}
