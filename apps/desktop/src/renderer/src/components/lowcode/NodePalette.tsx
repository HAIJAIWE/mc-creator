import { memo, useState, useCallback } from 'react';
import type { NodeKind } from '@mc-creator/shared';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { NODE_METADATA, NODE_CATEGORIES, type NodeMeta } from './nodes';
import {
  NODE_GRAPH_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type NodeGraphTemplate,
} from '../../lib/nodeGraphTemplates.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { customNodeRegistry } from './custom/customNodeRegistry.js';
import { CustomNodeImporter } from './custom/CustomNodeImporter.js';

const COLOR_TEXT_CLASSES: Record<string, string> = {
  pink: 'text-pink-400 border-pink-400/40 hover:bg-pink-400/10',
  orange: 'text-orange-400 border-orange-400/40 hover:bg-orange-400/10',
  cyan: 'text-cyan-400 border-cyan-400/40 hover:bg-cyan-400/10',
  yellow: 'text-yellow-400 border-yellow-400/40 hover:bg-yellow-400/10',
  emerald: 'text-emerald-400 border-emerald-400/40 hover:bg-emerald-400/10',
  violet: 'text-violet-400 border-violet-400/40 hover:bg-violet-400/10',
  purple: 'text-purple-400 border-purple-400/40 hover:bg-purple-400/10',
  blue: 'text-blue-400 border-blue-400/40 hover:bg-blue-400/10',
  red: 'text-red-400 border-red-400/40 hover:bg-red-400/10',
  gray: 'text-gray-300 border-gray-400/40 hover:bg-gray-400/10',
};

interface NodePaletteProps {
  /** 拖拽开始时调用（用于画布接收） */
  onNodeDragStart?: (kind: NodeKind) => void;
  /** 点击时调用（在画布中心创建） */
  onNodeClick?: (kind: NodeKind) => void;
  /** 是否禁用代码节点（L1 模式下） */
  disableCodeNode?: boolean;
  /** 模板点击回调（可选，未传时使用默认 confirm + loadGraph 行为） */
  onTemplateClick?: (template: NodeGraphTemplate) => void;
}

/**
 * 左侧节点库面板
 *
 * 按分类列出所有可用节点，支持：
 * - 拖拽到画布（HTML5 drag）
 * - 点击在画布中心创建
 * - 搜索过滤
 */
function NodePaletteComponent({
  onNodeDragStart,
  onNodeClick,
  disableCodeNode,
  onTemplateClick,
}: NodePaletteProps) {
  const [search, setSearch] = useState('');
  /** 模板区域搜索关键字（仅过滤模板，不影响节点搜索） */
  const [templateSearch, setTemplateSearch] = useState('');
  /** 模板分类筛选（'all' 或 TEMPLATE_CATEGORIES 中的 id） */
  const [templateCategory, setTemplateCategory] = useState<string>('all');
  /** 自定义节点导入对话框显隐（阶段 C） */
  const [showImporter, setShowImporter] = useState(false);
  /** 自定义节点列表（从注册表读取，渲染时实时获取） */
  const [customNodes, setCustomNodes] = useState(() => customNodeRegistry.list());

  const addCustomNode = useNodeGraphStore((s) => s.addCustomNode);

  // 刷新自定义节点列表（导入后调用）
  const refreshCustomNodes = useCallback(() => {
    setCustomNodes(customNodeRegistry.list());
  }, []);

  const filtered = NODE_METADATA.filter(
    (m) =>
      m.label.toLowerCase().includes(search.toLowerCase()) ||
      m.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, kind: NodeKind) => {
      e.dataTransfer.setData('application/reactflow-node-kind', kind);
      e.dataTransfer.effectAllowed = 'move';
      onNodeDragStart?.(kind);
    },
    [onNodeDragStart],
  );

  // 模板点击默认行为：确认后保存撤销点并载入模板图
  const handleTemplateClick = useCallback(
    (template: NodeGraphTemplate) => {
      // 若外部传入回调，优先使用（便于测试 mock）
      if (onTemplateClick) {
        onTemplateClick(template);
        return;
      }
      // 默认行为：弹窗确认 → commit 保存撤销点 → loadGraph 载入模板
      const confirmed = window.confirm(`加载模板"${template.name}"将替换当前节点图，是否继续？`);
      if (!confirmed) return;
      useNodeGraphStore.getState().commit();
      useNodeGraphStore.getState().loadGraph(template.graph);
    },
    [onTemplateClick],
  );

  return (
    <div className="flex h-full flex-col bg-mc-surface" role="search" aria-label="节点库面板">
      {/* 搜索框 */}
      <div className="border-b border-mc-border p-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索节点..."
          aria-label="搜索节点"
          className="w-full rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
        />
      </div>

      {/* 节点列表：listbox + 分组（每个分类一个 group，项为 option） */}
      <div
        className="flex-1 overflow-y-auto p-2"
        role="listbox"
        aria-label="可用节点列表"
        aria-orientation="vertical"
      >
        {NODE_CATEGORIES.map((cat) => {
          const items = filtered.filter((m) => m.category === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="mb-3" role="group" aria-label={cat.label}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
                {cat.label}
              </div>
              <div className="grid grid-cols-1 gap-1">
                {items.map((meta) => (
                  <PaletteItem
                    key={meta.kind}
                    meta={meta}
                    disabled={disableCodeNode && meta.kind === 'code'}
                    onDragStart={handleDragStart}
                    onClick={onNodeClick}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-4 text-center text-[11px] text-mc-mute">无匹配节点</div>
        )}
      </div>

      {/* 模板区域：搜索框 + 分类筛选 + 按分类分组显示，点击加载模板 */}
      <div
        className="max-h-56 overflow-y-auto border-t border-mc-border p-2"
        role="group"
        aria-label="节点图模板"
      >
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
          📦 模板
        </div>
        <div className="mb-2 flex gap-1">
          <input
            type="search"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="搜索模板..."
            aria-label="搜索模板"
            className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
          />
          <select
            value={templateCategory}
            onChange={(e) => setTemplateCategory(e.target.value)}
            aria-label="筛选模板分类"
            className="rounded-mc border border-mc-border bg-mc-surface-2 px-1 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
          >
            <option value="all">全部分类</option>
            {TEMPLATE_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>
        {TEMPLATE_CATEGORIES.map((cat) => {
          if (templateCategory !== 'all' && templateCategory !== cat.id) return null;
          const items = NODE_GRAPH_TEMPLATES.filter(
            (t) =>
              t.category === cat.id &&
              (templateSearch === '' ||
                t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
                t.description.toLowerCase().includes(templateSearch.toLowerCase())),
          );
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="mb-2" role="group" aria-label={cat.label}>
              <div className="mb-0.5 text-[10px] text-mc-dim">{cat.label}</div>
              <div className="grid grid-cols-1 gap-1">
                {items.map((template) => (
                  <TemplateItem
                    key={template.id}
                    template={template}
                    onClick={handleTemplateClick}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {NODE_GRAPH_TEMPLATES.filter(
          (t) =>
            (templateCategory === 'all' || t.category === templateCategory) &&
            (templateSearch === '' ||
              t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
              t.description.toLowerCase().includes(templateSearch.toLowerCase())),
        ).length === 0 && (
          <div className="py-2 text-center text-[10px] text-mc-mute">无匹配模板</div>
        )}
      </div>

      {/* 自定义节点分区（阶段 C） */}
      <div className="border-t border-mc-border p-2" role="group" aria-label="自定义节点">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
            🧩 自定义节点
          </div>
          <button
            type="button"
            onClick={() => setShowImporter(true)}
            className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-text hover:bg-mc-surface-3"
          >
            导入自定义节点
          </button>
        </div>
        {customNodes.length === 0 ? (
          <div className="text-[10px] text-mc-dim">未导入自定义节点</div>
        ) : (
          <div className="grid grid-cols-1 gap-1">
            {customNodes.map((schema) => (
              <button
                key={schema.typeId}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/custom-node-typeid', schema.typeId);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => addCustomNode(schema.typeId, { x: 100, y: 100 })}
                className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-left text-xs text-mc-text hover:border-mc-accent"
              >
                <McIcon scope="pixel" name={schema.icon || 'custom'} size={14} aria-hidden="true" />
                <div className="flex-1">
                  <div className="font-medium text-mc-text">{schema.label}</div>
                  <div className="truncate text-[10px] text-mc-mute">{schema.typeId}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {showImporter && (
        <CustomNodeImporter
          onClose={() => {
            setShowImporter(false);
            refreshCustomNodes();
          }}
        />
      )}

      {/* 提示 */}
      <div className="border-t border-mc-border p-2 text-[10px] text-mc-mute">
        💡 拖拽节点到画布或点击添加
      </div>
    </div>
  );
}

interface PaletteItemProps {
  meta: NodeMeta;
  disabled?: boolean;
  onDragStart: (e: React.DragEvent, kind: NodeKind) => void;
  onClick?: (kind: NodeKind) => void;
}

const PaletteItem = memo(function PaletteItem({
  meta,
  disabled,
  onDragStart,
  onClick,
}: PaletteItemProps) {
  const colorClass = COLOR_TEXT_CLASSES[meta.color] ?? COLOR_TEXT_CLASSES.gray;
  return (
    <button
      type="button"
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, meta.kind)}
      onClick={() => onClick?.(meta.kind)}
      disabled={disabled}
      role="option"
      aria-selected="false"
      aria-label={`添加${meta.label}节点：${meta.description}`}
      className={`flex items-center gap-2 rounded-mc border bg-mc-surface-2 px-2 py-1.5 text-left text-xs transition-colors ${colorClass} ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      <McIcon scope="pixel" name={meta.icon} size={14} aria-hidden="true" />
      <div className="flex-1">
        <div className="font-medium text-mc-text">{meta.label}</div>
        <div className="truncate text-[10px] text-mc-mute">{meta.description}</div>
      </div>
    </button>
  );
});

// === 模板项组件 ===

interface TemplateItemProps {
  template: NodeGraphTemplate;
  onClick: (template: NodeGraphTemplate) => void;
}

const TemplateItem = memo(function TemplateItem({ template, onClick }: TemplateItemProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(template)}
      aria-label={`加载模板：${template.name}`}
      className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-left text-xs text-mc-text transition-colors hover:border-mc-accent hover:bg-mc-surface-3 cursor-pointer"
    >
      <span className="text-base leading-none" aria-hidden="true">
        {template.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-mc-text">{template.name}</div>
        <div className="truncate text-[10px] text-mc-mute">{template.description}</div>
      </div>
    </button>
  );
});

export const NodePalette = memo(NodePaletteComponent);
