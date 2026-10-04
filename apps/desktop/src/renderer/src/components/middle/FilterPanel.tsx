import { useState } from 'react';
import { SlidersHorizontal, RotateCcw, Trash2, Plus, Eye } from 'lucide-react';
import { FilterPipeline, FilterNode } from './SkinPixelEditor';

interface FilterPanelProps {
  pipeline: FilterPipeline;
  onPipelineChange: (pipeline: FilterPipeline) => void;
}

const FILTER_TYPES: { type: FilterNode['type']; label: string; defaultParams: Record<string, number>; paramLabels: Record<string, string>; min: number; max: number; step: number }[] = [
  { type: 'brightness', label: '亮度', defaultParams: { value: 1 }, paramLabels: { value: '强度' }, min: 0, max: 2, step: 0.05 },
  { type: 'contrast', label: '对比度', defaultParams: { value: 1 }, paramLabels: { value: '强度' }, min: 0, max: 2, step: 0.05 },
  { type: 'saturation', label: '饱和度', defaultParams: { value: 1 }, paramLabels: { value: '强度' }, min: 0, max: 3, step: 0.05 },
  { type: 'hue', label: '色相', defaultParams: { deg: 0 }, paramLabels: { deg: '角度' }, min: -180, max: 180, step: 1 },
  { type: 'sepia', label: '复古/棕褐', defaultParams: { value: 0 }, paramLabels: { value: '强度' }, min: 0, max: 1, step: 0.05 },
  { type: 'grayscale', label: '灰度', defaultParams: { value: 0 }, paramLabels: { value: '强度' }, min: 0, max: 1, step: 0.05 },
  { type: 'invert', label: '反色', defaultParams: { value: 0 }, paramLabels: { value: '强度' }, min: 0, max: 1, step: 0.05 },
  { type: 'sharpen', label: '锐化', defaultParams: { value: 0 }, paramLabels: { value: '强度' }, min: 0, max: 1, step: 0.05 },
];

const generateId = () => Math.random().toString(36).slice(2, 10);

export const FilterPanel = ({ pipeline, onPipelineChange }: FilterPanelProps) => {
  const [showAddMenu, setShowAddMenu] = useState(false);

  const addFilter = (type: FilterNode['type']) => {
    const def = FILTER_TYPES.find(f => f.type === type)!;
    const newFilter: FilterNode = {
      id: generateId(),
      type,
      params: { ...def.defaultParams },
      enabled: true,
    };
    onPipelineChange({
      ...pipeline,
      filters: [...pipeline.filters, newFilter],
    });
    setShowAddMenu(false);
  };

  const removeFilter = (id: string) => {
    onPipelineChange({
      ...pipeline,
      filters: pipeline.filters.filter(f => f.id !== id),
    });
  };

  const toggleFilter = (id: string) => {
    onPipelineChange({
      ...pipeline,
      filters: pipeline.filters.map(f =>
        f.id === id ? { ...f, enabled: !f.enabled } : f
      ),
    });
  };

  const updateFilterParam = (id: string, key: string, value: number) => {
    onPipelineChange({
      ...pipeline,
      filters: pipeline.filters.map(f =>
        f.id === id ? { ...f, params: { ...f.params, [key]: value } } : f
      ),
    });
  };

  const resetAll = () => {
    onPipelineChange({ enabled: true, filters: [] });
  };

  return (
    <div className="bg-mc-surface-2 rounded-mc border border-mc-border p-3 w-72">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-mc-text flex items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4" /> 滤镜管线
        </h3>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1 text-[11px] text-mc-dim cursor-pointer">
            <input
              type="checkbox"
              checked={pipeline.enabled}
              onChange={(e) => onPipelineChange({ ...pipeline, enabled: e.target.checked })}
              className="accent-mc-primary"
            />
            启用
          </label>
          <button
            onClick={resetAll}
            disabled={pipeline.filters.length === 0}
            className="text-[11px] text-mc-dim hover:text-mc-text disabled:opacity-40 transition-colors"
            title="清空所有滤镜"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 添加滤镜菜单 */}
      <div className="mb-3">
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-mc border border-mc-border bg-mc-surface-3 text-[11px] text-mc-dim hover:text-mc-text hover:border-mc-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> 添加滤镜
        </button>
        {showAddMenu && (
          <div className="mt-1 grid grid-cols-2 gap-1">
            {FILTER_TYPES.map((f) => (
              <button
                key={f.type}
                onClick={() => addFilter(f.type)}
                className="px-2 py-1.5 rounded-mc bg-mc-surface-3 text-[11px] text-mc-text hover:bg-mc-primary/20 hover:text-mc-primary transition-colors text-left"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 管线列表 */}
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {pipeline.filters.length === 0 ? (
          <div className="text-center py-6 text-mc-mute text-[11px]">
            无滤镜，点击上方「添加滤镜」开始
          </div>
        ) : (
          pipeline.filters.map((filter, index) => {
            const def = FILTER_TYPES.find(f => f.type === filter.type)!;
            return (
              <div
                key={filter.id}
                className="bg-mc-surface-3 rounded-mc border border-mc-border p-2 transition-colors"
                style={{ opacity: filter.enabled ? 1 : 0.5 }}
              >
                <div className="flex items-start gap-2 mb-1.5">
                  <span className="flex-1 font-medium text-[11px] text-mc-text capitalize">{def.label}</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filter.enabled}
                      onChange={() => toggleFilter(filter.id)}
                      className="accent-mc-primary"
                      title="启用/禁用"
                    />
                    <Eye className="h-3 w-3 text-mc-dim" />
                  </label>
                  <button
                    onClick={() => removeFilter(filter.id)}
                    className="text-mc-dim hover:text-red-400 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* 参数滑块 */}
                <div className="space-y-1">
                  {Object.entries(filter.params).map(([paramKey, paramValue]) => {
                    const label = def.paramLabels[paramKey] || paramKey;
                    return (
                      <div key={paramKey} className="flex items-center gap-2">
                        <span className="w-14 text-[10px] text-mc-dim">{label}</span>
                        <input
                          type="range"
                          min={def.min}
                          max={def.max}
                          step={def.step}
                          value={paramValue}
                          onChange={(e) => updateFilterParam(filter.id, paramKey, parseFloat(e.target.value))}
                          className="flex-1 h-1.5 bg-mc-surface-2 rounded appearance-none accent-mc-primary"
                        />
                        <input
                          type="number"
                          min={def.min}
                          max={def.max}
                          step={def.step}
                          value={paramValue}
                          onChange={(e) => updateFilterParam(filter.id, paramKey, parseFloat(e.target.value))}
                          className="w-14 px-1 py-0.5 text-[10px] bg-mc-surface-2 border border-mc-border rounded-mc text-mc-text"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 拖拽排序提示 */}
      {pipeline.filters.length > 1 && (
        <div className="mt-2 text-center text-[10px] text-mc-mute">
          拖拽滤镜卡片可调整顺序（顺序影响最终效果）
        </div>
      )}
    </div>
  );
};