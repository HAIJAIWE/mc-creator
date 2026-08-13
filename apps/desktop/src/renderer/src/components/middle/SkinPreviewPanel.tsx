import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import {
  SkinViewer,
  WalkingAnimation,
  RunningAnimation,
  IdleAnimation,
  FlyingAnimation,
  type PlayerAnimation,
} from 'skinview3d';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import { EmptySpecState, FieldGroup, TextField, SelectField } from './shared/index.js';
import type { SkinSpec } from '@mc-creator/shared';
import { Download, Shuffle, Play, Pause, RotateCcw, User, Sparkles, Camera } from 'lucide-react';

/** 标准 Minecraft 皮肤 UV 坐标（基于 64x64 像素图），模块级常量 */
const BASE_SKIN_REGIONS = [
  { x: 8, y: 8, w: 8, h: 8, label: '头', color: 'rgba(224, 172, 105, 0.4)' },
  { x: 20, y: 20, w: 8, h: 12, label: '身体', color: 'rgba(25, 166, 255, 0.4)' },
  { x: 44, y: 20, w: 4, h: 12, label: '右臂', color: 'rgba(49, 39, 24, 0.5)' },
  { x: 36, y: 52, w: 4, h: 12, label: '右腿', color: 'rgba(60, 42, 30, 0.5)' },
] as const;

type AnimationType = 'idle' | 'walking' | 'running' | 'flying';

const ANIMATIONS: { id: AnimationType; label: string; factory: () => PlayerAnimation }[] = [
  { id: 'idle', label: '站立', factory: () => new IdleAnimation() },
  { id: 'walking', label: '行走', factory: () => new WalkingAnimation() },
  { id: 'running', label: '跑步', factory: () => new RunningAnimation() },
  { id: 'flying', label: '飞行', factory: () => new FlyingAnimation() },
];

/** 预设皮肤颜色组合 */
const PRESETS: {
  name: string;
  colors: Pick<SkinSpec, 'skinColor' | 'hairColor' | 'shirtColor' | 'pantsColor' | 'shoesColor'>;
}[] = [
  {
    name: 'Steve',
    colors: {
      skinColor: '#9c6b4a',
      hairColor: '#3a2a1a',
      shirtColor: '#4a8aff',
      pantsColor: '#3a3a8a',
      shoesColor: '#5a3a2a',
    },
  },
  {
    name: 'Alex',
    colors: {
      skinColor: '#e0ac69',
      hairColor: '#a85a3a',
      shirtColor: '#5aa85a',
      pantsColor: '#5a4a3a',
      shoesColor: '#4a3a2a',
    },
  },
  {
    name: '骑士',
    colors: {
      skinColor: '#d4a574',
      hairColor: '#2a2a2a',
      shirtColor: '#6a6a7a',
      pantsColor: '#4a4a5a',
      shoesColor: '#3a3a3a',
    },
  },
  {
    name: '法师',
    colors: {
      skinColor: '#e8c4a0',
      hairColor: '#5a3a8a',
      shirtColor: '#8a3a8a',
      pantsColor: '#4a2a6a',
      shoesColor: '#2a1a4a',
    },
  },
  {
    name: '矿工',
    colors: {
      skinColor: '#c89870',
      hairColor: '#1a1a1a',
      shirtColor: '#8a6a3a',
      pantsColor: '#5a4a2a',
      shoesColor: '#3a2a1a',
    },
  },
  {
    name: '忍者',
    colors: {
      skinColor: '#d4a574',
      hairColor: '#1a1a1a',
      shirtColor: '#1a1a1a',
      pantsColor: '#1a1a1a',
      shoesColor: '#2a2a2a',
    },
  },
];

const RANDOM_SKIN_COLORS = [
  '#d4a574',
  '#e0ac69',
  '#9c6b4a',
  '#c89870',
  '#e8c4a0',
  '#a87a5a',
  '#b88a6a',
  '#d4a0a0',
  '#e8b8a0',
  '#a8b8c8',
];
const RANDOM_HAIR_COLORS = [
  '#1a1a1a',
  '#3a2a1a',
  '#5a3a2a',
  '#7a4a2a',
  '#a85a3a',
  '#c87a3a',
  '#e8a85a',
  '#5a3a8a',
  '#8a3a8a',
  '#3a5a8a',
];
const RANDOM_SHIRT_COLORS = [
  '#4a8aff',
  '#5aa85a',
  '#a85a3a',
  '#6a6a7a',
  '#8a3a8a',
  '#5a4a3a',
  '#e84a4a',
  '#4ae8e8',
  '#e8e84a',
  '#4ae84a',
];
const RANDOM_PANTS_COLORS = [
  '#3a3a8a',
  '#5a4a3a',
  '#4a4a5a',
  '#2a1a4a',
  '#5a2a2a',
  '#1a3a1a',
  '#3a3a3a',
  '#5a3a5a',
  '#1a4a4a',
  '#4a5a4a',
];
const RANDOM_SHOES_COLORS = [
  '#5a3a2a',
  '#4a3a2a',
  '#3a3a3a',
  '#2a2a2a',
  '#4a2a1a',
  '#3a2a1a',
  '#2a1a1a',
  '#4a4a2a',
  '#3a4a3a',
  '#2a3a4a',
];

function randomColor(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Skin 预览面板（增强版）：
 * - 顶栏统计：5 颜色配置概览
 * - 左：3D 角色预览（动画切换 / 自动旋转 / 暂停）
 * - 右：2D 皮肤贴图（64x64 + 部位标注）
 * - 底部：预设皮肤 / 随机颜色 / 导出 PNG / 颜色编辑表单
 */
export function SkinPreviewPanel() {
  const { spec, setSpec, files } = useModStore(
    (s) => ({ spec: s.spec, setSpec: s.setSpec, files: s.files }),
    shallow,
  );

  // 3D viewer canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  // 动画/控制状态
  const [animation, setAnimation] = useState<AnimationType>('walking');
  const [autoRotate, setAutoRotate] = useState(true);
  const [paused, setPaused] = useState(false);

  // 2D 视图背景色切换
  const [bgColor, setBgColor] = useState<'#1a1a1a' | '#3a3a3a' | '#ffffff' | '#7a5a3a'>('#1a1a1a');

  // 从 files 找皮肤 PNG（路径是 ${playerName}.png）
  // 注意：useMemo/useCallback 必须在 early return 之前调用，否则 hooks 数量会随 spec 变化
  const skinUrl = useMemo(() => {
    if (!spec) return null;
    const skinSpec = spec as unknown as SkinSpec;
    const file = files.find((f) => f.path === `${skinSpec.playerName}.png`);
    if (!file) return null;
    return `data:image/png;base64,${file.content}`;
  }, [files, spec]);

  const applyPreset = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      if (!spec) return;
      const skinSpec = spec as unknown as SkinSpec;
      const updated = { ...skinSpec, ...preset.colors };
      setSpec(updated as unknown as typeof spec);
    },
    [spec, setSpec],
  );

  const randomizeColors = useCallback(() => {
    if (!spec) return;
    const skinSpec = spec as unknown as SkinSpec;
    const updated = {
      ...skinSpec,
      skinColor: randomColor(RANDOM_SKIN_COLORS),
      hairColor: randomColor(RANDOM_HAIR_COLORS),
      shirtColor: randomColor(RANDOM_SHIRT_COLORS),
      pantsColor: randomColor(RANDOM_PANTS_COLORS),
      shoesColor: randomColor(RANDOM_SHOES_COLORS),
    };
    setSpec(updated as unknown as typeof spec);
  }, [spec, setSpec]);

  const exportPng = useCallback(() => {
    if (!viewerRef.current || !spec) return;
    // 从 skinview3d viewer 渲染当前帧并导出
    const viewer = viewerRef.current;
    viewer.render();
    const dataUrl = viewer.canvas.toDataURL('image/png');
    const skinSpec = spec as unknown as SkinSpec;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${skinSpec.playerName}-preview.png`;
    a.click();
  }, [spec]);

  const export2DPng = useCallback(() => {
    if (!skinUrl || !spec) return;
    const skinSpec = spec as unknown as SkinSpec;
    const a = document.createElement('a');
    a.href = skinUrl;
    a.download = `${skinSpec.playerName}.png`;
    a.click();
  }, [skinUrl, spec]);

  if (!spec) {
    return <EmptySpecState label="皮肤" describe="皮肤" />;
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
          <span className="text-xs text-mc-dim">
            {skin.model === 'slim' ? 'Slim (Alex)' : 'Classic (Steve)'}
          </span>
        </div>
        <div className="mt-1 text-xs text-mc-mute">
          {skinUrl ? '皮肤 PNG 已生成' : '皮肤 PNG 未生成（保存后即可预览）'}
        </div>
      </div>

      {/* 颜色配置概览统计 */}
      <div className="grid grid-cols-5 gap-2 border-b border-mc-border bg-mc-surface-2/30 p-2">
        {(
          [
            { label: '皮肤', value: skin.skinColor },
            { label: '头发', value: skin.hairColor },
            { label: '上衣', value: skin.shirtColor },
            { label: '裤子', value: skin.pantsColor },
            { label: '鞋子', value: skin.shoesColor },
          ] as const
        ).map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2/60 px-2 py-1.5"
          >
            <span
              className="h-5 w-5 rounded-mc border border-mc-border"
              style={{ backgroundColor: c.value }}
              title={c.value}
            />
            <div>
              <div className="text-[10px] text-mc-mute">{c.label}</div>
              <div className="font-mono text-[10px] text-mc-dim">{c.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Body：左右分栏 */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* 左：3D 预览 */}
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-4"
          style={{ backgroundColor: bgColor }}
        >
          {skinUrl ? (
            <SkinViewer3D
              canvasRef={canvasRef}
              viewerRef={viewerRef}
              skinUrl={skinUrl}
              model={skin.model}
              animation={animation}
              autoRotate={autoRotate}
              paused={paused}
            />
          ) : (
            <div className="flex h-64 w-48 items-center justify-center rounded-mc border border-dashed border-mc-border text-xs text-mc-mute">
              等待皮肤 PNG 生成
            </div>
          )}

          {/* 动画控制条 */}
          <div className="flex flex-wrap items-center justify-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2/80 px-2 py-1">
            {ANIMATIONS.map((a) => (
              <button
                key={a.id}
                onClick={() => setAnimation(a.id)}
                className={`rounded-mc px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  animation === a.id
                    ? 'bg-mc-accent/30 text-mc-accent'
                    : 'text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                }`}
              >
                {a.label}
              </button>
            ))}
            <span className="mx-1 h-3 w-px bg-mc-border" />
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={`flex items-center gap-0.5 rounded-mc px-1.5 py-0.5 text-[10px] transition-colors ${
                autoRotate ? 'bg-mc-accent/20 text-mc-accent' : 'text-mc-dim hover:bg-mc-surface-3'
              }`}
              title="自动旋转"
            >
              <RotateCcw className="h-2.5 w-2.5" /> 自转
            </button>
            <button
              onClick={() => setPaused(!paused)}
              className="flex items-center gap-0.5 rounded-mc px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-3"
              title={paused ? '继续' : '暂停'}
            >
              {paused ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
              {paused ? '继续' : '暂停'}
            </button>
          </div>
        </div>

        {/* 右：2D UV 贴图 */}
        <div
          className="flex w-full flex-col gap-2 border-t border-mc-border p-4 md:w-80 md:border-l md:border-t-0"
          style={{ backgroundColor: bgColor }}
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-mc-dim">
              2D 纹理贴图 (64×64)
            </div>
            {skinUrl && (
              <button
                onClick={export2DPng}
                className="flex items-center gap-0.5 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 text-[10px] text-mc-dim hover:border-mc-accent hover:text-mc-text"
                title="导出 2D 皮肤 PNG"
              >
                <Download className="h-2.5 w-2.5" /> 导出 PNG
              </button>
            )}
          </div>
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
            {(['#1a1a1a', '#3a3a3a', '#ffffff', '#7a5a3a'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setBgColor(c)}
                className={`h-5 w-5 rounded-mc border ${bgColor === c ? 'border-mc-accent' : 'border-mc-border'}`}
                style={{ backgroundColor: c }}
                title={`背景色 ${c}`}
              />
            ))}
          </div>

          {/* 预设皮肤 */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-mc-dim">
              <Sparkles className="h-3 w-3" /> 预设皮肤
            </div>
            <div className="grid grid-cols-3 gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  className="flex flex-col items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-1 py-1.5 hover:border-mc-accent"
                  title={`应用 ${p.name} 预设`}
                >
                  <div className="flex gap-0.5">
                    {[p.colors.skinColor, p.colors.hairColor, p.colors.shirtColor].map((c, i) => (
                      <span key={i} className="h-2 w-2 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <span className="text-[10px] text-mc-dim">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer：颜色与字段编辑表单 */}
      <div className="max-h-72 overflow-y-auto border-t border-mc-border p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={randomizeColors}
            className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
          >
            <Shuffle className="h-3 w-3" /> 随机颜色
          </button>
          <button
            onClick={exportPng}
            disabled={!skinUrl}
            className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title={skinUrl ? '导出 3D 预览截图为 PNG' : '需要先有皮肤 PNG'}
          >
            <Camera className="h-3 w-3" /> 导出 3D 截图
          </button>
          <div className="ml-auto flex items-center gap-1 text-[10px] text-mc-mute">
            <User className="h-2.5 w-2.5" />
            {skin.model === 'slim' ? 'Alex 模型 (3px 臂)' : 'Steve 模型 (4px 臂)'}
          </div>
        </div>

        <FieldGroup title="基本">
          <TextField
            label="玩家名"
            value={skin.playerName}
            onChange={(v) => updateField('playerName', v)}
          />
          <SelectField
            label="模型"
            value={skin.model}
            options={[
              { value: 'classic', label: 'Classic (Steve)' },
              { value: 'slim', label: 'Slim (Alex)' },
            ]}
            onChange={(v) => updateField('model', v as SkinSpec['model'])}
          />
        </FieldGroup>

        <div className="mt-4">
          <FieldGroup title="颜色">
            <ColorRow
              label="皮肤色"
              value={skin.skinColor}
              onChange={(v) => updateField('skinColor', v)}
            />
            <ColorRow
              label="头发色"
              value={skin.hairColor}
              onChange={(v) => updateField('hairColor', v)}
            />
            <ColorRow
              label="上衣色"
              value={skin.shirtColor}
              onChange={(v) => updateField('shirtColor', v)}
            />
            <ColorRow
              label="裤子色"
              value={skin.pantsColor}
              onChange={(v) => updateField('pantsColor', v)}
            />
            <ColorRow
              label="鞋子色"
              value={skin.shoesColor}
              onChange={(v) => updateField('shoesColor', v)}
            />
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
  animation: AnimationType;
  autoRotate: boolean;
  paused: boolean;
}

function SkinViewer3D({
  canvasRef,
  viewerRef,
  skinUrl,
  model,
  animation,
  autoRotate,
  paused,
}: SkinViewer3DProps) {
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
  // 注：viewerRef 是 useRef 返回的稳定 ref object，引用永不变化，
  // 加到 deps 数组无意义（React 官方文档明确说 ref 不应出现在 deps 里）。
  // viewerRef.current 在上面的 useEffect 中初始化，首次渲染时为 null，
  // 此时本 effect 提前 return；viewer 创建完成后 skinUrl/model 变化会再次触发。
  useEffect(() => {
    if (!viewerRef.current) return;
    viewerRef.current.loadSkin(skinUrl, { model });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinUrl, model]);

  // 动画切换
  useEffect(() => {
    if (!viewerRef.current) return;
    const animDef = ANIMATIONS.find((a) => a.id === animation);
    if (animDef) {
      viewerRef.current.animation = animDef.factory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation]);

  // 自动旋转切换
  useEffect(() => {
    if (!viewerRef.current) return;
    viewerRef.current.autoRotate = autoRotate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRotate]);

  // 暂停/继续动画
  useEffect(() => {
    if (!viewerRef.current?.animation) return;
    viewerRef.current.animation.paused = paused;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

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
  const regions = useMemo(
    () => BASE_SKIN_REGIONS.map((r, i) => (i === 2 && model === 'slim' ? { ...r, w: 3 } : r)),
    [model],
  );

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

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
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
