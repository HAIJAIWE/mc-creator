import { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Layers,
  ArrowUpDown,
  Minus,
  Edit2,
  Merge,
} from 'lucide-react';
import { Layer, LayerType, BlendMode } from './SkinPixelEditor';

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '正常' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'overlay', label: '叠加' },
  { value: 'darken', label: '变暗' },
  { value: 'lighten', label: '变亮' },
  { value: 'color-dodge', label: '颜色减淡' },
  { value: 'color-burn', label: '颜色加深' },
  { value: 'hard-light', label: '强光' },
  { value: 'soft-light', label: '柔光' },
  { value: 'difference', label: '差值' },
  { value: 'exclusion', label: '排除' },
  { value: 'hue', label: '色相' },
  { value: 'saturation', label: '饱和度' },
  { value: 'color', label: '颜色' },
  { value: 'luminosity', label: '亮度' },
];

const LAYER_TYPE_LABELS: Record<LayerType, string> = {
  base: '底层',
  overlay: '表层',
  custom: '自定义',
};

const LAYER_TYPE_COLORS: Record<LayerType, string> = {
  base: 'text-blue-400',
  overlay: 'text-green-400',
  custom: 'text-purple-400',
};

interface LayerItemProps {
  layer: Layer;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
  onVisibilityToggle: () => void;
  onLockToggle: () => void;
  onOpacityChange: (value: number) => void;
  onBlendModeChange: (mode: BlendMode) => void;
  onMergeDown: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMergeDown: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isBaseOrOverlay: boolean;
}

const LayerItem = ({
  layer,
  isActive,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
  onClear,
  onVisibilityToggle,
  onLockToggle,
  onOpacityChange,
  onBlendModeChange,
  onMergeDown,
  onMoveUp,
  onMoveDown,
  canMergeDown,
  canMoveUp,
  canMoveDown,
  isBaseOrOverlay,
}: LayerItemProps) => {
  const [showBlendMenu, setShowBlendMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const [renameValue, setRenameValue] = useState(layer.name);

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue !== layer.name) {
      onRename();
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit();
    else if (e.key === 'Escape') {
      setRenameValue(layer.name);
      setIsRenaming(false);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', layer.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== layer.id) {
      // 实际移动逻辑由父组件通过 onMoveUp/Down 处理
      // 这里仅提供视觉反馈
    }
  };

  return (
    <div
      draggable={true}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={(e) => handleDrop(e)}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-mc transition-colors ${
        isActive ? 'bg-mc-primary/15 border-l-2 border-l-mc-primary' : 'hover:bg-mc-surface-3'
      } ${layer.locked ? 'opacity-60' : ''}`}
      onClick={onSelect}
    >
      {/* 可见性 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVisibilityToggle();
        }}
        className="flex-shrink-0 p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
        title={layer.visible ? '隐藏图层' : '显示图层'}
      >
        {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>

      {/* 锁定 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onLockToggle();
        }}
        className="flex-shrink-0 p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
        title={layer.locked ? '解锁图层' : '锁定图层'}
      >
        {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
      </button>

      {/* 缩略图 */}
      <canvas
        width={24}
        height={24}
        className="flex-shrink-0 border border-mc-border rounded-sm"
        style={{
          opacity: layer.visible ? 1 : 0.4,
          filter: layer.blendMode !== 'source-over' ? 'brightness(1.1)' : 'none',
        }}
        ref={(canvas) => {
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(layer.canvas, 0, 0, 24, 24);
            }
          }
        }}
        title={`${LAYER_TYPE_LABELS[layer.type]}: ${layer.name}`}
      />

      {/* 图层名称 */}
      {isRenaming ? (
        <input
          ref={renameRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] bg-mc-surface-3 border border-mc-primary rounded-mc text-mc-text outline-none"
          autoFocus
        />
      ) : (
        <div
          onDoubleClick={(e) => {
            e.stopPropagation();
            setIsRenaming(true);
          }}
          className="flex-1 min-w-0 text-[11px] truncate text-mc-text cursor-pointer"
          title={layer.name}
        >
          <span className={`flex items-center gap-1 ${LAYER_TYPE_COLORS[layer.type]}`}>
            <Layers className="h-3 w-3" />
            {layer.name}
          </span>
          {layer.locked && <Lock className="h-2.5 w-2.5 ml-1 text-mc-mute" />}
        </div>
      )}

      {/* 不透明度 */}
      <input
        type="range"
        min="0"
        max="100"
        value={layer.opacity}
        onChange={(e) => {
          e.stopPropagation();
          onOpacityChange(parseInt(e.target.value));
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-20 h-1.5 bg-mc-surface-3 rounded appearance-none accent-mc-primary cursor-pointer"
        title={`不透明度: ${layer.opacity}%`}
      />

      {/* 混合模式 */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowBlendMenu(!showBlendMenu);
          }}
          className="flex-shrink-0 px-1.5 py-0.5 text-[10px] bg-mc-surface-3 border border-mc-border rounded-mc text-mc-dim hover:text-mc-text transition-colors"
          title={`混合模式: ${BLEND_MODES.find((b) => b.value === layer.blendMode)?.label || layer.blendMode}`}
        >
          {BLEND_MODES.find((b) => b.value === layer.blendMode)?.label || layer.blendMode}
        </button>
        {showBlendMenu && (
          <div className="absolute bottom-full left-0 mb-1 z-10 bg-mc-surface-2 border border-mc-border rounded-mc p-1 min-w-[120px] shadow-lg">
            {BLEND_MODES.map((b) => (
              <button
                key={b.value}
                onClick={(e) => {
                  e.stopPropagation();
                  onBlendModeChange(b.value);
                  setShowBlendMenu(false);
                }}
                className={`w-full px-2 py-1 text-[11px] rounded-sm text-left transition-colors ${
                  layer.blendMode === b.value
                    ? 'bg-mc-primary/20 text-mc-primary'
                    : 'text-mc-text hover:bg-mc-surface-3'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-0.5">
        {!isBaseOrOverlay && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              className="p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
              title="重命名"
            >
              <Edit2 className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              className="p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
              title="复制图层"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-0.5 rounded-sm text-mc-dim hover:text-red-400 transition-colors"
              title="删除图层"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
          title="清空图层"
        >
          <Minus className="h-3 w-3" />
        </button>
        {canMergeDown && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMergeDown();
            }}
            className="p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
            title="向下合并"
          >
            <Merge className="h-3 w-3" />
          </button>
        )}
        {canMoveUp && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            className="p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
            title="上移"
          >
            <ArrowUpDown className="h-3 w-3 rotate-180" />
          </button>
        )}
        {canMoveDown && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            className="p-0.5 rounded-sm text-mc-dim hover:text-mc-text transition-colors"
            title="下移"
          >
            <ArrowUpDown className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
};

interface LayerPanelProps {
  layers: Layer[];
  activeLayerId: string;
  onLayerSelect: (id: string) => void;
  onLayerAdd: (name?: string, type?: LayerType) => string;
  onLayerDuplicate: (id: string) => string;
  onLayerDelete: (id: string) => void;
  onLayerClear: (id: string) => void;
  onLayerRename: (id: string, name: string) => void;
  onLayerMove: (fromIndex: number, toIndex: number) => void;
  onLayerPropsChange: (id: string, props: Partial<Layer>) => void;
  onMergeDown: (id: string) => void;
  onMergeVisible: () => void;
}

export const LayerPanel = ({
  layers,
  activeLayerId,
  onLayerSelect,
  onLayerAdd,
  onLayerDuplicate,
  onLayerDelete,
  onLayerClear,
  onLayerMove,
  onLayerPropsChange,
  onMergeDown,
  onMergeVisible,
}: LayerPanelProps) => {
  const [showAddMenu, setShowAddMenu] = useState(false);

  const getLayerIndex = (id: string) => layers.findIndex((l) => l.id === id);

  const handleSelect = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (layer && !layer.locked) onLayerSelect(id);
  };

  const handleAddLayer = (type: LayerType) => {
    const customLayers = layers.filter((l) => l.type === 'custom').length;
    const name = type === 'custom' ? `图层 ${customLayers + 1}` : type === 'base' ? '底层' : '表层';
    onLayerAdd(name, type);
    setShowAddMenu(false);
  };

  const handleDuplicate = (id: string) => {
    onLayerDuplicate(id);
  };

  const handleDelete = (id: string) => {
    onLayerDelete(id);
  };

  const handleClear = (id: string) => {
    onLayerClear(id);
  };

  const handleOpacityChange = (id: string, value: number) => {
    onLayerPropsChange(id, { opacity: Math.max(0, Math.min(100, value)) });
  };

  const handleVisibilityToggle = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (layer) onLayerPropsChange(id, { visible: !layer.visible });
  };

  const handleLockToggle = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (layer) onLayerPropsChange(id, { locked: !layer.locked });
  };

  const handleMoveUp = (id: string) => {
    const index = getLayerIndex(id);
    if (index > 0) onLayerMove(index, index - 1);
  };

  const handleMoveDown = (id: string) => {
    const index = getLayerIndex(id);
    if (index < layers.length - 1) onLayerMove(index, index + 1);
  };

  const handleBlendModeChangeWrapper = (id: string, mode: BlendMode) => {
    onLayerPropsChange(id, { blendMode: mode });
  };

  const handleMergeDownWrapper = (id: string) => {
    onMergeDown(id);
  };

  // 从上到下渲染（最上层在最上面）
  const displayLayers = [...layers].reverse();

  return (
    <div className="bg-mc-surface-2 rounded-mc border border-mc-border p-2 w-80 max-h-[500px] flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-mc-text flex items-center gap-1.5">
          <Layers className="h-4 w-4" /> 图层
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMergeVisible()}
            disabled={layers.filter((l) => l.visible && l.id !== 'base').length === 0}
            className="p-1 rounded-mc border border-mc-border bg-mc-surface-3 text-mc-dim hover:text-mc-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="合并可见图层"
          >
            <Merge className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="p-1 rounded-mc border border-mc-border bg-mc-surface-3 text-mc-dim hover:text-mc-text transition-colors"
            title="新建图层"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 添加图层菜单 */}
      {showAddMenu && (
        <div className="mb-2 grid grid-cols-3 gap-1">
          {(['custom', 'base', 'overlay'] as LayerType[]).map((type) => (
            <button
              key={type}
              onClick={() => handleAddLayer(type)}
              className="px-2 py-1.5 rounded-mc bg-mc-surface-3 text-[11px] text-mc-text hover:bg-mc-primary/20 hover:text-mc-primary transition-colors text-left"
            >
              {LAYER_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}

      {/* 图层列表 */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {displayLayers.map((layer, displayIndex) => {
          const realIndex = layers.length - 1 - displayIndex;
          const isActive = layer.id === activeLayerId;
          const isBaseOrOverlay = layer.type === 'base' || layer.type === 'overlay';

          return (
            <LayerItem
              key={layer.id}
              layer={layer}
              index={realIndex}
              isActive={isActive}
              onSelect={() => handleSelect(layer.id)}
              onRename={() => {}} // 重命名通过双击触发
              onDuplicate={() => handleDuplicate(layer.id)}
              onDelete={() => handleDelete(layer.id)}
              onClear={() => handleClear(layer.id)}
              onVisibilityToggle={() => handleVisibilityToggle(layer.id)}
              onLockToggle={() => handleLockToggle(layer.id)}
              onOpacityChange={(v) => handleOpacityChange(layer.id, v)}
              onBlendModeChange={(m) => handleBlendModeChangeWrapper(layer.id, m)}
              onMergeDown={() => handleMergeDownWrapper(layer.id)}
              onMoveUp={() => handleMoveUp(layer.id)}
              onMoveDown={() => handleMoveDown(layer.id)}
              canMergeDown={getLayerIndex(layer.id) > 0 && !layer.locked}
              canMoveUp={realIndex < layers.length - 1 && !layer.locked}
              canMoveDown={realIndex > 0 && !layer.locked}
              isBaseOrOverlay={isBaseOrOverlay}
            />
          );
        })}
      </div>

      {/* 底部提示 */}
      <div className="mt-2 text-[10px] text-mc-mute text-center">
        双击重命名 · 拖拽排序 · 右键更多操作
      </div>
    </div>
  );
};
