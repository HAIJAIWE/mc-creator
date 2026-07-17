import { useEffect, useRef, useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import { EmptyState, FieldGroup } from './shared/index.js';
import type { SkinSpec } from '@mc-creator/shared';

/**
 * Skin 预览面板：
 * - 左：skinview3d 3D 角色预览（可拖动旋转、滚轮缩放、自动旋转）
 * - 右：2D 皮肤贴图（显示完整 64x64 PNG + overlay 标注身体部位）
 * - 底部：表单编辑 playerName/model/5 颜色字段
 * 字段修改写回 useModStore.spec。
 */
export function SkinPreviewPanel() {
  const { spec, setSpec, files } = useModStore(
    (s) => ({ spec: s.spec, setSpec: s.setSpec, files: s.files }),
    shallow,
  );

  // 3D viewer canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  // 2D 视图背景色切换
  const [bgColor, setBgColor] = useState<'#1a1a1a' | '#3a3a3a' | '#ffffff'>('#1a1a1a');

  // 从 files 找皮肤 PNG（路径是 ${playerName}.png）
  // 注意：useMemo 必须在 early return 之前调用，否则 hooks 数量会随 spec 变化
  const skinUrl = useMemo(() => {
    if (!spec) return null;
    const skinSpec = spec as unknown as SkinSpec;
    const file = files.find((f) => f.path === `${skinSpec.playerName}.png`);
    if (!file) return null;
    return `data:image/png;base64,${file.content}`;
  }, [files, spec]);

  if (!spec) {
    return <EmptyState icon="box" title="尚未生成皮肤 Spec" hint="在右侧 AgentPanel 描述你想要的皮肤，生成 Spec 后即可预览" />;
  }

  const skin = spec as unknown as SkinSpec;

  const updateField = <K extends keyof SkinSpec>(key: K, value: SkinSpec[K]) => {
    const updated = { ...skin, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      {/* Header */}
      <div className="border-b border-mc-border px-4 py-3">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="star" size={16} className="text-mc-accent" />
          <span className="text-sm font-bold text-mc-text">{skin.playerName}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">{skin.model === 'slim' ? 'Slim (Alex)' : 'Classic (Steve)'}</span>
        </div>
        <div className="mt-1 text-xs text-mc-mute">{skinUrl ? '皮肤 PNG 已生成' : '皮肤 PNG 未生成（保存后即可预览）'}</div>
      </div>

      {/* Body：左右分栏 */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* 左：3D 预览 */}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4" style={{ backgroundColor: bgColor }}>
          {skinUrl ? (
            <SkinViewer3D
              canvasRef={canvasRef}
              viewerRef={viewerRef}
              skinUrl={skinUrl}
              model={skin.model}
            />
          ) : (
            <div className="flex h-64 w-48 items-center justify-center rounded-mc border border-dashed border-mc-border text-xs text-mc-mute">
              等待皮肤 PNG 生成
            </div>
          )}
          <div className="text-xs text-mc-mute">拖动旋转 · 滚轮缩放 · 自动旋转中</div>
        </div>

        {/* 右：2D UV 贴图 */}
        <div className="flex w-full flex-col gap-2 border-t border-mc-border p-4 md:w-80 md:border-l md:border-t-0" style={{ backgroundColor: bgColor }}>
          <div className="text-xs font-bold uppercase tracking-wider text-mc-dim">2D 纹理贴图 (64×64)</div>
          <div className="relative">
            {skinUrl ? (
              <Skin2DOverlay skinUrl={skinUrl} model={skin.model} />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-mc border border-dashed border-mc-border text-xs text-mc-mute">
                等待皮肤 PNG 生成
              </div>
            )}
          </div>
          <div className="text-xs text-mc-mute">半透明色块标注身体部位区域</div>

          {/* 背景色切换 */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-mc-dim">背景:</span>
            {(['#1a1a1a', '#3a3a3a', '#ffffff'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setBgColor(c)}
                className={`h-5 w-5 rounded-mc border ${bgColor === c ? 'border-mc-accent' : 'border-mc-border'}`}
                style={{ backgroundColor: c }}
                title={`背景色 ${c}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer：颜色与字段编辑表单 */}
      <div className="max-h-64 overflow-y-auto border-t border-mc-border p-4">
        <FieldGroup title="基本">
          <div className="flex items-center gap-3">
            <label className="w-28 shrink-0 text-xs text-mc-dim">玩家名</label>
            <input
              type="text"
              value={skin.playerName}
              onChange={(e) => updateField('playerName', e.target.value)}
              className="mc-input flex-1 !py-1 !text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-28 shrink-0 text-xs text-mc-dim">模型</label>
            <select
              value={skin.model}
              onChange={(e) => updateField('model', e.target.value as SkinSpec['model'])}
              className="mc-select flex-1 !py-1 !text-xs"
            >
              <option value="classic">Classic (Steve)</option>
              <option value="slim">Slim (Alex)</option>
            </select>
          </div>
        </FieldGroup>

        <div className="mt-4">
          <FieldGroup title="颜色">
            <ColorRow label="皮肤色" value={skin.skinColor} onChange={(v) => updateField('skinColor', v)} />
            <ColorRow label="头发色" value={skin.hairColor} onChange={(v) => updateField('hairColor', v)} />
            <ColorRow label="上衣色" value={skin.shirtColor} onChange={(v) => updateField('shirtColor', v)} />
            <ColorRow label="裤子色" value={skin.pantsColor} onChange={(v) => updateField('pantsColor', v)} />
            <ColorRow label="鞋子色" value={skin.shoesColor} onChange={(v) => updateField('shoesColor', v)} />
          </FieldGroup>
        </div>
      </div>
    </div>
  );
}

// ===== 3D 子组件 =====

interface SkinViewer3DProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  viewerRef: React.MutableRefObject<SkinViewer | null>;
  skinUrl: string;
  model: SkinSpec['model'];
}

function SkinViewer3D({ canvasRef, viewerRef, skinUrl, model }: SkinViewer3DProps) {
  // 创建/销毁 viewer（仅在 mount 时）
  useEffect(() => {
    if (!canvasRef.current) return;
    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width: 240,
      height: 320,
    });
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.5;
    viewer.animation = new WalkingAnimation();
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载皮肤（url 或 model 变化时）
  useEffect(() => {
    if (!viewerRef.current) return;
    viewerRef.current.loadSkin(skinUrl, { model });
  }, [skinUrl, model]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={320}
      className="rounded-mc border border-mc-border"
    />
  );
}

// ===== 2D UV 子组件 =====

interface Skin2DOverlayProps {
  skinUrl: string;
  model: SkinSpec['model'];
}

/** 2D 皮肤 PNG + 半透明色块标注身体部位（基于 64x64 标准 UV 布局） */
function Skin2DOverlay({ skinUrl, model }: Skin2DOverlayProps) {
  // 标准 Minecraft 皮肤 UV 坐标（基于 64x64 像素图）
  const regions: Array<{ x: number; y: number; w: number; h: number; label: string; color: string }> = [
    { x: 8, y: 8, w: 8, h: 8, label: '头', color: 'rgba(224, 172, 105, 0.4)' },
    { x: 20, y: 20, w: 8, h: 12, label: '身体', color: 'rgba(25, 166, 255, 0.4)' },
    { x: 44, y: 20, w: 4, h: 12, label: '右臂', color: 'rgba(49, 39, 24, 0.5)' },
    { x: 36, y: 52, w: 4, h: 12, label: '右腿', color: 'rgba(60, 42, 30, 0.5)' },
  ];
  // slim 模型手臂宽度为 3 而非 4
  if (model === 'slim') {
    regions[2].w = 3;
  }

  // 显示尺寸：每个像素放大 3 倍（64x64 → 192x192）
  const scale = 3;

  return (
    <div className="relative" style={{ width: 64 * scale, height: 64 * scale }}>
      <img
        src={skinUrl}
        alt="skin"
        width={64 * scale}
        height={64 * scale}
        className="block"
        style={{ imageRendering: 'pixelated' }}
      />
      {regions.map((r, i) => (
        <div
          key={i}
          className="absolute flex items-center justify-center text-[10px] font-bold text-white"
          style={{
            left: r.x * scale,
            top: r.y * scale,
            width: r.w * scale,
            height: r.h * scale,
            backgroundColor: r.color,
            border: '1px solid rgba(255,255,255,0.3)',
          }}
        >
          {r.label}
        </div>
      ))}
    </div>
  );
}

// ===== 颜色行子组件 =====

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-12 cursor-pointer rounded-mc border border-mc-border bg-mc-surface-2"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-input w-24 !py-1 !text-xs"
      />
    </div>
  );
}
