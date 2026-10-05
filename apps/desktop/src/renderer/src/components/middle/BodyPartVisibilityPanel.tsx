import {
  BODY_PART_DISPLAY_ORDER,
  BODY_PART_INFOS,
  BodyPartId,
  getBodyPartRect,
} from './skin-uv.js';

interface BodyPartVisibilityPanelProps {
  visibleParts: Set<BodyPartId>;
  onToggle: (partId: BodyPartId) => void;
  model: 'classic' | 'slim';
}

export function BodyPartVisibilityPanel({
  visibleParts,
  onToggle,
  model,
}: BodyPartVisibilityPanelProps) {
  return (
    <div className="mt-3 p-3 rounded-mc border border-mc-border bg-mc-surface-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-mc-dim">部位可见性</span>
        <span className="ml-auto text-[10px] text-mc-mute">点击切换显隐</span>
      </div>

      <div className="space-y-1">
        {BODY_PART_DISPLAY_ORDER.map((partId) => {
          const info = BODY_PART_INFOS[partId];
          // Overlay 行只作为子按钮渲染，跳过顶层重复行
          if (!info || info.isOverlay) return null;

          // 获取当前模型下的矩形，如果不存在则跳过
          const rect = getBodyPartRect(model, partId, false);
          if (!rect || (rect.width === 0 && rect.height === 0)) return null;

          return (
            <div key={partId} className="flex items-center gap-2">
              <button
                onClick={() => onToggle(partId)}
                className={`flex items-center gap-1.5 rounded-mc px-2 py-1.5 text-xs transition-colors w-full text-left ${
                  visibleParts.has(partId)
                    ? 'bg-mc-accent/10 text-mc-text'
                    : 'text-mc-dim hover:bg-mc-surface-3'
                }`}
                title={info.label}
              >
                <span
                  className={`h-3 w-3 rounded-sm ${visibleParts.has(partId) ? 'bg-mc-accent' : 'bg-mc-border'}`}
                />
                <span className="flex-1 text-left truncate">{info.label}</span>
              </button>

              {info.overlayLabel && (
                <button
                  onClick={() => onToggle(`${partId}Overlay` as BodyPartId)}
                  className="flex items-center gap-1.5 rounded-mc px-2 py-1.5 text-xs transition-colors ${
                    visibleParts.has(`${partId}Overlay` as BodyPartId) 
                      ? 'bg-mc-accent/10 text-mc-text' 
                      : 'text-mc-dim hover:bg-mc-surface-3'
                  }"
                  title={info.overlayLabel}
                  style={{ marginLeft: '1.5rem' }}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-sm ${visibleParts.has(`${partId}Overlay` as BodyPartId) ? 'bg-mc-accent' : 'bg-mc-border'}`}
                  />
                  <span className="flex-1 text-left truncate text-[10px]">{info.overlayLabel}</span>
                </button>
              )}
            </div>
          );
        })}

        <div className="mt-2 pt-2 border-t border-mc-border flex gap-2">
          <button
            onClick={() => {
              BODY_PART_DISPLAY_ORDER.forEach((id) => {
                if (!visibleParts.has(id)) onToggle(id);
              });
            }}
            className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-xs text-mc-dim hover:border-mc-accent hover:text-mc-text"
          >
            全显示
          </button>
          <button
            onClick={() => {
              BODY_PART_DISPLAY_ORDER.forEach((id) => {
                if (visibleParts.has(id)) onToggle(id);
              });
            }}
            className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-xs text-mc-dim hover:border-mc-accent hover:text-mc-text"
          >
            全隐藏
          </button>
        </div>
      </div>
    </div>
  );
}
