import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Download,
  Upload,
  Copy,
} from 'lucide-react';

// ===== NBT 类型系统 =====

/** NBT 标签类型枚举（对应 Java 版 nbt.NbtType） */
export type NbtType =
  | 'byte' // 1
  | 'short' // 2
  | 'int' // 3
  | 'long' // 4
  | 'float' // 5
  | 'double' // 6
  | 'byte_array' // 7
  | 'string' // 8
  | 'list' // 9
  | 'compound' // 10
  | 'int_array' // 11
  | 'long_array'; // 12

/** NBT 标签节点 */
export interface NbtTag {
  type: NbtType;
  /** 数值型：number; 字符串：string; 数组：number[]; 列表：NbtTag[]; 复合：NbtEntry[] */
  value: number | string | number[] | NbtTag[] | NbtEntry[];
}

/** NBT Compound 条目 = 键 + 标签 */
export interface NbtEntry {
  key: string;
  tag: NbtTag;
}

/** NBT 根节点（通常是 Compound） */
export interface NbtRoot {
  entries: NbtEntry[];
}

const NBT_TYPE_LABELS: Record<NbtType, string> = {
  byte: 'Byte',
  short: 'Short',
  int: 'Int',
  long: 'Long',
  float: 'Float',
  double: 'Double',
  byte_array: 'Byte[]',
  string: 'String',
  list: 'List',
  compound: 'Compound',
  int_array: 'Int[]',
  long_array: 'Long[]',
};

const NBT_TYPE_COLORS: Record<NbtType, string> = {
  byte: 'text-green-400',
  short: 'text-green-500',
  int: 'text-yellow-400',
  long: 'text-yellow-500',
  float: 'text-blue-400',
  double: 'text-blue-500',
  byte_array: 'text-green-300',
  string: 'text-pink-400',
  list: 'text-orange-400',
  compound: 'text-cyan-400',
  int_array: 'text-yellow-300',
  long_array: 'text-yellow-300',
};

/** NBT 类型图标 */
const NBT_TYPE_ICONS: Record<NbtType, string> = {
  byte: 'box',
  short: 'box',
  int: 'star',
  long: 'star',
  float: 'star',
  double: 'star',
  byte_array: 'layers',
  string: 'file-text',
  list: 'list',
  compound: 'folder',
  int_array: 'layers',
  long_array: 'layers',
};

/** 创建默认值 */
function defaultValue(type: NbtType): NbtTag['value'] {
  switch (type) {
    case 'byte':
    case 'short':
    case 'int':
    case 'long':
    case 'float':
    case 'double':
      return 0;
    case 'string':
      return '';
    case 'byte_array':
    case 'int_array':
    case 'long_array':
      return [];
    case 'list':
      return [];
    case 'compound':
      return [];
  }
}

/** 从 SNBT（字符串化 NBT，简化版 JSON）解析为 NbtRoot */
export function parseSnbt(input: string): NbtRoot | null {
  try {
    // SNBT 类似 JSON 但键无引号、数值有类型后缀（b/s/l/f/d）
    // 简化：先尝试 JSON.parse，再推断类型
    const obj = JSON.parse(input);
    return { entries: objectToEntries(obj) };
  } catch {
    return null;
  }
}

/** 将 JS 对象递归转为 NbtEntry[] */
function objectToEntries(obj: Record<string, unknown>): NbtEntry[] {
  return Object.entries(obj).map(([key, val]) => ({
    key,
    tag: valueToTag(val),
  }));
}

/** 推断 JS 值的 NBT 类型 */
function valueToTag(val: unknown): NbtTag {
  if (typeof val === 'string') return { type: 'string', value: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      if (val >= -128 && val <= 127) return { type: 'byte', value: val };
      if (val >= -32768 && val <= 32767) return { type: 'short', value: val };
      return { type: 'int', value: val };
    }
    return { type: 'double', value: val };
  }
  if (typeof val === 'boolean') return { type: 'byte', value: val ? 1 : 0 };
  if (Array.isArray(val)) {
    if (val.length === 0) return { type: 'list', value: [] };
    // 检查首元素类型
    const first = val[0];
    if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
      return { type: 'list', value: val.map((v) => valueToTag(v)) };
    }
    if (typeof first === 'number' && Number.isInteger(first)) {
      return { type: 'int_array', value: val as number[] };
    }
    return { type: 'list', value: val.map((v) => valueToTag(v)) };
  }
  if (typeof val === 'object' && val !== null) {
    return { type: 'compound', value: objectToEntries(val as Record<string, unknown>) };
  }
  return { type: 'string', value: String(val) };
}

/** NbtRoot → SNBT（JSON 格式） */
export function toSnbt(root: NbtRoot): string {
  return JSON.stringify(entriesToObject(root.entries), null, 2);
}

function entriesToObject(entries: NbtEntry[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const e of entries) {
    obj[e.key] = tagToValue(e.tag);
  }
  return obj;
}

function tagToValue(tag: NbtTag): unknown {
  switch (tag.type) {
    case 'compound':
      return entriesToObject(tag.value as NbtEntry[]);
    case 'list':
      return (tag.value as NbtTag[]).map(tagToValue);
    case 'byte_array':
    case 'int_array':
    case 'long_array':
      return tag.value;
    default:
      return tag.value;
  }
}

// ===== 组件 =====

interface NbtEditorProps {
  /** 初始 SNBT 字符串（JSON 格式） */
  initialValue?: string;
  /** 值变更回调 */
  onChange?: (snbt: string) => void;
  /** 是否只读 */
  readOnly?: boolean;
}

/**
 * NBT 数据编辑器：树状可视化 + 行内编辑。
 * 用于查看/编辑 Minecraft 实体 NBT、方块实体、物品 NBT 等。
 */
export function NbtEditor({ initialValue = '{}', onChange, readOnly = false }: NbtEditorProps) {
  const [root, setRoot] = useState<NbtRoot>(() => parseSnbt(initialValue) ?? { entries: [] });
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']));
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [snbtInput, setSnbtInput] = useState('');
  const [showSnbtImport, setShowSnbtImport] = useState(false);
  const [copied, setCopied] = useState(false);

  // U-7 修复：切换文件时 initialValue 变化，重新解析 root（避免只首次挂载初始化）
  const lastInitialRef = useRef(initialValue);
  useEffect(() => {
    if (initialValue === lastInitialRef.current) return;
    lastInitialRef.current = initialValue;
    setRoot(parseSnbt(initialValue) ?? { entries: [] });
    setExpandedPaths(new Set(['']));
    setEditingPath(null);
  }, [initialValue]);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const notifyChange = useCallback(
    (newRoot: NbtRoot) => {
      setRoot(newRoot);
      onChange?.(toSnbt(newRoot));
    },
    [onChange],
  );

  // 更新标签值
  const updateTag = useCallback(
    (path: string[], newTag: NbtTag) => {
      const newRoot = { entries: [...root.entries] };
      setAtPath(newRoot.entries, path, newTag);
      notifyChange(newRoot);
    },
    [root, notifyChange],
  );

  // 删除条目
  const deleteEntry = useCallback(
    (parentPath: string[], index: number) => {
      const newRoot = { entries: [...root.entries] };
      const parent = getAtPath(newRoot.entries, parentPath);
      if (parent && Array.isArray(parent)) {
        (parent as NbtEntry[]).splice(index, 1);
        notifyChange(newRoot);
      }
    },
    [root, notifyChange],
  );

  // 添加条目
  const addEntry = useCallback(
    (parentPath: string[], type: NbtType = 'string') => {
      const newRoot = { entries: [...root.entries] };
      const parent = getAtPath(newRoot.entries, parentPath);
      if (parent && Array.isArray(parent)) {
        const entries = parent as NbtEntry[];
        const key = `key_${entries.length}`;
        entries.push({ key, tag: { type, value: defaultValue(type) } });
        notifyChange(newRoot);
      }
    },
    [root, notifyChange],
  );

  // 添加列表元素
  const addListItem = useCallback(
    (path: string[], type: NbtType = 'int') => {
      const newRoot = { entries: [...root.entries] };
      const tag = getTagAtPath(newRoot.entries, path);
      if (tag && tag.type === 'list') {
        (tag.value as NbtTag[]).push({ type, value: defaultValue(type) });
        notifyChange(newRoot);
      }
    },
    [root, notifyChange],
  );

  // 开始行内编辑
  const startEdit = useCallback(
    (path: string, currentValue: string) => {
      if (readOnly) return;
      setEditingPath(path);
      setEditValue(currentValue);
    },
    [readOnly],
  );

  // 保存编辑
  const saveEdit = useCallback(
    (pathStr: string, pathArr: string[], tag: NbtTag) => {
      let newTag: NbtTag;
      if (tag.type === 'string') {
        newTag = { type: 'string', value: editValue };
      } else if (['byte', 'short', 'int', 'long'].includes(tag.type)) {
        newTag = { type: tag.type, value: parseInt(editValue, 10) || 0 };
      } else if (['float', 'double'].includes(tag.type)) {
        newTag = { type: tag.type, value: parseFloat(editValue) || 0 };
      } else {
        newTag = tag; // 数组/复合/列表不支持行内编辑
      }
      updateTag(pathArr, newTag);
      setEditingPath(null);
    },
    [editValue, updateTag],
  );

  const summary = useMemo(() => {
    const countEntries = (entries: NbtEntry[]): number =>
      entries.reduce(
        (sum, e) =>
          sum + 1 + (e.tag.type === 'compound' ? countEntries(e.tag.value as NbtEntry[]) : 0),
        0,
      );
    return countEntries(root.entries);
  }, [root]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mc-surface">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-1">
        <McIcon scope="pixel" name="folder" size={14} className="text-mc-mute" />
        <span className="text-xs font-medium text-mc-dim">NBT 编辑器</span>
        <span className="text-[10px] text-mc-mute">{summary} 个标签</span>
        <div className="ml-auto flex items-center gap-1">
          {/* 复制 SNBT */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(toSnbt(root));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            title="复制 SNBT 到剪贴板"
          >
            <Copy className="h-3 w-3" />
            {copied ? '已复制' : '复制'}
          </button>
          {/* 导出 SNBT 文件 */}
          <button
            onClick={() => {
              const blob = new Blob([toSnbt(root)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'nbt_data.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            title="导出 SNBT 文件"
          >
            <Download className="h-3 w-3" />
            导出
          </button>
          {/* 导入 SNBT */}
          <button
            onClick={() => setShowSnbtImport(true)}
            className="flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            title="导入 SNBT"
          >
            <Upload className="h-3 w-3" />
            导入
          </button>
          {!readOnly && (
            <button
              onClick={() => addEntry([], 'string')}
              className="flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
              title="添加根条目"
            >
              <Plus className="h-3 w-3" />
              添加
            </button>
          )}
        </div>
      </div>

      {/* SNBT 导入区域 */}
      {showSnbtImport && (
        <div className="border-b border-mc-border bg-mc-surface-2 px-3 py-2">
          <div className="mb-1 text-[10px] font-medium text-mc-dim">导入 SNBT（JSON 格式）</div>
          <textarea
            value={snbtInput}
            onChange={(e) => setSnbtInput(e.target.value)}
            placeholder='粘贴 SNBT，如 {"CustomName":"...","Health":20}'
            className="w-full rounded-mc border border-mc-border bg-mc-surface px-2 py-1 font-mono text-[11px] text-mc-text outline-none focus:border-mc-accent"
            rows={4}
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => {
                const parsed = parseSnbt(snbtInput);
                if (parsed) {
                  notifyChange(parsed);
                  setShowSnbtImport(false);
                  setSnbtInput('');
                }
              }}
              className="rounded-mc bg-mc-accent px-2 py-0.5 text-[10px] text-white hover:bg-mc-accent/80"
            >
              应用
            </button>
            <button
              onClick={() => {
                setShowSnbtImport(false);
                setSnbtInput('');
              }}
              className="rounded-mc border border-mc-border px-2 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 树 */}
      <div className="flex-1 overflow-y-auto p-1">
        {root.entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <McIcon scope="pixel" name="folder" size={32} className="text-mc-mute" />
            <div className="text-xs text-mc-mute">空 Compound</div>
            {!readOnly && (
              <button
                onClick={() => addEntry([], 'string')}
                className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-dim hover:text-mc-text"
              >
                <Plus className="h-3 w-3" /> 添加第一个标签
              </button>
            )}
          </div>
        ) : (
          root.entries.map((entry, i) => (
            <NbtEntryRow
              key={`${entry.key}-${i}`}
              entry={entry}
              path={[String(i)]}
              pathStr={String(i)}
              depth={0}
              expanded={expandedPaths.has(String(i))}
              onToggle={() => toggleExpand(String(i))}
              expandedPaths={expandedPaths}
              onTogglePath={toggleExpand}
              editingPath={editingPath}
              editValue={editValue}
              onStartEdit={startEdit}
              onSaveEdit={saveEdit}
              onCancelEdit={() => setEditingPath(null)}
              onEditValueChange={setEditValue}
              onDelete={(p, idx) => deleteEntry(p, idx)}
              onAddEntry={addEntry}
              onAddListItem={addListItem}
              onUpdateTag={updateTag}
              readOnly={readOnly}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ===== 行内渲染 =====

interface RowProps {
  entry: NbtEntry;
  path: string[];
  pathStr: string;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  /** U-6：子行展开状态与切换（统一走 expandedPaths，避免硬编码 + 空 onToggle） */
  expandedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  editingPath: string | null;
  editValue: string;
  onStartEdit: (path: string, currentValue: string) => void;
  onSaveEdit: (pathStr: string, pathArr: string[], tag: NbtTag) => void;
  onCancelEdit: () => void;
  onEditValueChange: (v: string) => void;
  onDelete: (parentPath: string[], index: number) => void;
  onAddEntry: (parentPath: string[], type?: NbtType) => void;
  onAddListItem: (path: string[], type?: NbtType) => void;
  onUpdateTag: (path: string[], tag: NbtTag) => void;
  readOnly: boolean;
}

function NbtEntryRow({
  entry,
  path,
  pathStr,
  depth,
  expanded,
  onToggle,
  expandedPaths,
  onTogglePath,
  editingPath,
  editValue,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onDelete,
  onAddEntry,
  onAddListItem,
  onUpdateTag,
  readOnly,
}: RowProps) {
  const { key, tag } = entry;
  const isContainer = tag.type === 'compound' || tag.type === 'list';
  const isEditing = editingPath === pathStr;
  const indent = depth * 16;

  const displayValue = (() => {
    if (tag.type === 'compound') return `${(tag.value as NbtEntry[]).length} 个条目`;
    if (tag.type === 'list') return `${(tag.value as NbtTag[]).length} 个元素`;
    if (tag.type === 'byte_array' || tag.type === 'int_array' || tag.type === 'long_array')
      return `[${(tag.value as number[]).length} 个元素]`;
    if (tag.type === 'string') return `"${String(tag.value)}"`;
    return String(tag.value);
  })();

  const colorClass = NBT_TYPE_COLORS[tag.type];

  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] hover:bg-mc-surface-2/60"
        style={{ paddingLeft: indent + 4 }}
      >
        {/* 展开箭头 */}
        {isContainer ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? '折叠' : '展开'}
            aria-expanded={expanded}
            className="flex-shrink-0"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-mc-mute" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3 text-mc-mute" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* 图标 */}
        <McIcon
          scope="pixel"
          name={NBT_TYPE_ICONS[tag.type]}
          size={10}
          className={`flex-shrink-0 ${colorClass}`}
        />

        {/* 键名 */}
        <span className="flex-shrink-0 font-medium text-mc-text">{key}</span>
        <span className="flex-shrink-0 text-mc-mute">:</span>

        {/* 类型标签 */}
        <span className={`flex-shrink-0 text-[9px] ${colorClass}`}>
          {NBT_TYPE_LABELS[tag.type]}
        </span>

        {/* 值（可编辑） */}
        {isEditing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit(pathStr, path, tag);
              if (e.key === 'Escape') onCancelEdit();
            }}
            className="ml-1 flex-1 rounded-mc border border-mc-accent bg-mc-surface px-1 py-0 font-mono text-[11px] text-mc-text outline-none"
          />
        ) : (
          <span
            onDoubleClick={() => !isContainer && onStartEdit(pathStr, String(tag.value))}
            className={`ml-1 flex-1 truncate font-mono ${tag.type === 'string' ? 'text-pink-400' : colorClass} ${!isContainer && !readOnly ? 'cursor-text' : ''}`}
            title={!isContainer && !readOnly ? '双击编辑' : undefined}
          >
            {displayValue}
          </span>
        )}

        {/* 编辑按钮 */}
        {isEditing && (
          <>
            <button
              type="button"
              onClick={() => onSaveEdit(pathStr, path, tag)}
              aria-label="保存编辑"
              className="text-green-400 hover:text-green-300"
            >
              <Save className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              aria-label="取消编辑"
              className="text-red-400 hover:text-red-300"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </>
        )}

        {/* 操作按钮（hover 时显示） */}
        {!readOnly && !isEditing && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {!isContainer && (
              <button
                type="button"
                onClick={() => onStartEdit(pathStr, String(tag.value))}
                aria-label="编辑值"
                className="text-mc-mute hover:text-mc-text"
                title="编辑"
              >
                <Edit3 className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                // 从父级删除：path 末尾是索引，前面的 path 是父级路径
                const parentPath = path.slice(0, -1);
                const index = parseInt(path[path.length - 1], 10);
                onDelete(parentPath.length === 0 ? [] : parentPath, index);
              }}
              aria-label="删除条目"
              className="text-mc-mute hover:text-red-400"
              title="删除"
            >
              <Trash2 className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* 子节点 */}
      {isContainer && expanded && (
        <div>
          {tag.type === 'compound' &&
            (tag.value as NbtEntry[]).map((child, i) => {
              const childPath = `${pathStr}/${i}`;
              return (
                <NbtEntryRow
                  key={`${child.key}-${i}`}
                  entry={child}
                  path={[...path, String(i)]}
                  pathStr={childPath}
                  depth={depth + 1}
                  expanded={expandedPaths.has(childPath)}
                  onToggle={() => onTogglePath(childPath)}
                  expandedPaths={expandedPaths}
                  onTogglePath={onTogglePath}
                  editingPath={editingPath}
                  editValue={editValue}
                  onStartEdit={onStartEdit}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                  onEditValueChange={onEditValueChange}
                  onDelete={onDelete}
                  onAddEntry={onAddEntry}
                  onAddListItem={onAddListItem}
                  onUpdateTag={onUpdateTag}
                  readOnly={readOnly}
                />
              );
            })}
          {tag.type === 'list' &&
            (tag.value as NbtTag[]).map((childTag, i) => {
              const childPath = `${pathStr}/${i}`;
              return (
                <NbtEntryRow
                  key={`list-${i}`}
                  entry={{ key: `[${i}]`, tag: childTag }}
                  path={[...path, String(i)]}
                  pathStr={childPath}
                  depth={depth + 1}
                  expanded={expandedPaths.has(childPath)}
                  onToggle={() => onTogglePath(childPath)}
                  expandedPaths={expandedPaths}
                  onTogglePath={onTogglePath}
                  editingPath={editingPath}
                  editValue={editValue}
                  onStartEdit={onStartEdit}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                  onEditValueChange={onEditValueChange}
                  onDelete={onDelete}
                  onAddEntry={onAddEntry}
                  onAddListItem={onAddListItem}
                  onUpdateTag={onUpdateTag}
                  readOnly={readOnly}
                />
              );
            })}
          {/* 添加按钮 */}
          {!readOnly && (
            <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: indent + 20 }}>
              {tag.type === 'compound' && (
                <button
                  onClick={() => onAddEntry(path)}
                  className="flex items-center gap-1 rounded-mc px-1 py-0.5 text-[10px] text-mc-mute hover:bg-mc-surface-2 hover:text-mc-text"
                >
                  <Plus className="h-2.5 w-2.5" /> 添加条目
                </button>
              )}
              {tag.type === 'list' && (
                <button
                  onClick={() => onAddListItem(path)}
                  className="flex items-center gap-1 rounded-mc px-1 py-0.5 text-[10px] text-mc-mute hover:bg-mc-surface-2 hover:text-mc-text"
                >
                  <Plus className="h-2.5 w-2.5" /> 添加元素
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 工具函数 =====

/** 根据 path 数组获取 NbtEntry[] 中的对象 */
function getAtPath(entries: NbtEntry[], path: string[]): NbtEntry[] | null {
  if (path.length === 0) return entries;
  const [head, ...rest] = path;
  const idx = parseInt(head, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= entries.length) return null;
  if (rest.length === 0) return entries;
  const entry = entries[idx];
  if (entry.tag.type === 'compound') return getAtPath(entry.tag.value as NbtEntry[], rest);
  return null;
}

/** 根据 path 获取 NbtTag */
function getTagAtPath(entries: NbtEntry[], path: string[]): NbtTag | null {
  if (path.length === 0) return null;
  const [head, ...rest] = path;
  const idx = parseInt(head, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= entries.length) return null;
  const entry = entries[idx];
  if (rest.length === 0) return entry.tag;
  if (entry.tag.type === 'compound') return getTagAtPath(entry.tag.value as NbtEntry[], rest);
  if (entry.tag.type === 'list') {
    const listIdx = parseInt(rest[0], 10);
    const listItems = entry.tag.value as NbtTag[];
    if (rest.length === 1 && listIdx >= 0 && listIdx < listItems.length) return listItems[listIdx];
  }
  return null;
}

/** 根据 path 设置 NbtTag */
function setAtPath(entries: NbtEntry[], path: string[], newTag: NbtTag): void {
  if (path.length === 0) return;
  const [head, ...rest] = path;
  const idx = parseInt(head, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= entries.length) return;
  if (rest.length === 0) {
    entries[idx] = { ...entries[idx], tag: newTag };
    return;
  }
  const entry = entries[idx];
  if (entry.tag.type === 'compound') {
    setAtPath(entry.tag.value as NbtEntry[], rest, newTag);
  }
}
