import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  PenLine,
  Square,
  Undo2,
  Redo2,
  Download,
  Upload,
  Trash2,
  Plus,
  SlidersHorizontal,
  RotateCcw,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { floodFill } from './flood-fill';
import { getBodyPartAt } from './skin-uv';
import { PosePanel } from './PosePanel';
import { FilterPanel } from './FilterPanel';
import { LayerPanel } from './LayerPanel';
import { useToasts, ToastStack } from './toast';
import { ShortcutsHelp } from './ShortcutsHelp';

/** 像素工具 */
export type PixelTool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect';
/** 编辑图层：底层（base）/ 表层 overlay（帽子/外套/袖子/裤子第二层） */
export type PixelLayer = 'base' | 'overlay';

/** v1.1 姿势预设 */
export type PosePreset = 'idle' | 'walk' | 'run' | 'tpose' | 'fly' | 'custom';

/** v1.1 关节角度 */
export interface JointAngles {
  head: { x: number; y: number; z: number };
  body: { x: number; y: number; z: number };
  leftArm: { x: number; y: number; z: number };
  rightArm: { x: number; y: number; z: number };
  leftLeg: { x: number; y: number; z: number };
  rightLeg: { x: number; y: number; z: number };
}

/** v1.1 滤镜节点 */
export interface FilterNode {
  id: string;
  type: 'brightness' | 'contrast' | 'hue' | 'saturation' | 'noise' | 'sharpen' | 'sepia' | 'grayscale' | 'invert';
  params: Record<string, number>;
  enabled: boolean;
}

/** v1.1 滤镜管线 */
export interface FilterPipeline {
  enabled: boolean;
  filters: FilterNode[];
}

/** v1.2 混合模式 */
export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** v1.2 图层类型 */
export type LayerType = 'base' | 'overlay' | 'custom';

/** v1.2 图层定义 */
export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;        // 0-100
  blendMode: BlendMode;
  canvas: HTMLCanvasElement; // 64×64 离屏 canvas
}

/** v1.2 图层面板 Props */
export interface LayerPanelProps {
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

/** v1.3 披风尺寸常量 */
export const CAPE_WIDTH = 64;
export const CAPE_HEIGHT = 32;

/** v1.3 披风编辑器状态接口 */
export interface CapeEditorHandle {
  loadCape: (dataUrl: string) => void;
  getCapeDataUrl: () => string;
  clearCape: () => void;
  /** v1.3 披风 3D 直绘（复用披风编辑器工具/颜色状态） */
  paintStart: (x: number, y: number) => void;
  paintMove: (x: number, y: number) => void;
  paintEnd: () => void;
}

/** v1.3 资源包元数据 */
export interface ResourcePackMeta {
  packFormat: number;
  description: string;
}

/** v1.3 导出格式 */
export type ExportFormat = 'png' | 'gif' | 'mp4' | 'gltf' | 'resourcepack';

interface SkinPixelEditorProps {
  /** 起始纹理（官方图 / 生成图 dataURL），为 null 时从空白起画 */
  initialUrl: string | null;
  /** 每次落笔结束后的合成纹理（64x64 PNG dataURL），供 3D 联动 */
  onChange: (dataUrl: string) => void;
  /** 保存到项目文件 */
  onSave: (dataUrl: string) => void;
}

const HISTORY_LIMIT = 50;
const ZOOMS = [6, 8, 12] as const;

/** 默认调色板：肤色 / 发色 / MC 常用色 */
const DEFAULT_PALETTE = [
  '#ffffff', '#c8c8c8', '#8a8a8a', '#3a3a3a', '#141414',
  '#e8b07d', '#c89870', '#9c6b4a', '#5a3a28', '#2a1a12',
  '#3a2a1a', '#d97b2e', '#e8d878', '#7a5aa8', '#1a1a1a',
  '#2ba8a0', '#4a8aff', '#4040c8', '#5aa85a', '#e84a4a',
  '#d89030', '#e8e84a', '#8a6a3a', '#5a4a2a', '#4a3a2a',
];

const CUSTOM_PALETTE_KEY = 'mc-creator-skin-custom-palette';

function loadCustomPalette(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTE_KEY);
    const arr = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(arr) ? arr.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

/** 历史快照：完整图层数组 */
type LayerShot = Layer[];

/**
 * 供官方 3D 视图（skinview3d）直绘调用的命令式接口。
 * 绘制状态（工具/颜色/笔刷/镜像）复用 2D 编辑器自身状态，保证双视图一致。
 */
export interface SkinPixelEditorHandle {
  paintStart: (x: number, y: number, isOverlay: boolean, partKey: string) => void;
  paintMove: (x: number, y: number, isOverlay: boolean, partKey: string) => void;
  paintEnd: () => void;
  // v1.1 姿势控制
  setPose: (preset: PosePreset) => void;
  setCustomPose: (joint: keyof JointAngles, axis: 'x' | 'y' | 'z', value: number) => void;
  resetPose: () => void;
  // v1.2 图层操作
  layerOps: {
    addLayer: (name?: string, type?: LayerType) => string;
    duplicateLayer: (id: string) => string;
    deleteLayer: (id: string) => void;
    clearLayer: (id: string) => void;
    renameLayer: (id: string, name: string) => void;
    moveLayer: (fromIndex: number, toIndex: number) => void;
    setLayerProps: (id: string, props: Partial<Layer>) => void;
    mergeDown: (id: string) => void;
    mergeVisible: () => void;
  };
}

/**
 * 皮肤像素编辑器（对标 PMCSkin3D / minecraft.how 核心能力子集）：
 * - 画笔 / 橡皮 / 油漆桶 / 取色 / 直线 / 矩形，笔刷 1-3px
 * - 底层 + 表层双图层独立编辑与显隐
 * - 镜像绘制、网格、缩放、撤销/重做、调色板 + 自定义色 + 最近色
 * - 上传 PNG / 下载 PNG / 保存到项目，快捷键与主流编辑器对齐
 */
export const SkinPixelEditor = forwardRef<SkinPixelEditorHandle, SkinPixelEditorProps>(
  function SkinPixelEditor({ initialUrl, onChange, onSave }: SkinPixelEditorProps, ref) {
    const viewRef = useRef<HTMLCanvasElement | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // === v1.2 图层引擎辅助 ===
    const createLayerCanvas = useCallback((): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      return c;
    }, []);

    const createBaseLayer = useCallback((): Layer => ({
      id: 'base',
      name: '底层',
      type: 'base',
      visible: true,
      locked: false,
      opacity: 100,
      blendMode: 'source-over',
      canvas: createLayerCanvas(),
    }), [createLayerCanvas]);

    const createOverlayLayer = useCallback((): Layer => ({
      id: 'overlay',
      name: '表层',
      type: 'overlay',
      visible: true,
      locked: false,
      opacity: 100,
      blendMode: 'source-over',
      canvas: createLayerCanvas(),
    }), [createLayerCanvas]);

    const createCustomLayer = useCallback((name: string): Layer => ({
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      type: 'custom',
      visible: true,
      locked: false,
      opacity: 100,
      blendMode: 'source-over',
      canvas: createLayerCanvas(),
    }), [createLayerCanvas]);

    // 初始化默认图层
    const initLayers = useCallback((): Layer[] => [
      createBaseLayer(),
      createOverlayLayer(),
    ], [createBaseLayer, createOverlayLayer]);

    // === 核心状态（仅一次声明）===
    const [tool, setTool] = useState<PixelTool>('pencil');
    const [activeLayerId, setActiveLayerId] = useState<string>('base');
    const [color, setColor] = useState('#2ba8a0');
    const [brushSize, setBrushSize] = useState(1);
    const [mirrorMode, setMirrorMode] = useState<'off' | 'global' | 'bodypart'>('global');
    const [showGrid, setShowGrid] = useState(true);
    const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(8);
    const [ready, setReady] = useState(false);
    const [customColors, setCustomColors] = useState<string[]>(() => loadCustomPalette());
    const [recentColors, setRecentColors] = useState<string[]>([]);
    const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; part: string | null } | null>(null);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [spaceDown, setSpaceDown] = useState(false);
    const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
    const [touchMid, setTouchMid] = useState<{ x: number; y: number } | null>(null);
    const [layers, setLayers] = useState<Layer[]>(() => initLayers());

    // === 撤销/重做历史（存储完整 layers 快照）===
    const [undoStack, setUndoStack] = useState<LayerShot[]>([]);
    const [redoStack, setRedoStack] = useState<LayerShot[]>([]);

    // === v1.1 新增状态 ===
    const [pose, setPose] = useState<PosePreset>('idle');
    const [customPose, setCustomPose] = useState<JointAngles>({
      head: { x: 0, y: 0, z: 0 },
      body: { x: 0, y: 0, z: 0 },
      leftArm: { x: 0, y: 0, z: 0 },
      rightArm: { x: 0, y: 0, z: 0 },
      leftLeg: { x: 0, y: 0, z: 0 },
      rightLeg: { x: 0, y: 0, z: 0 },
    });
    const [filterPipeline, setFilterPipeline] = useState<FilterPipeline>({
      enabled: true,
      filters: [],
    });
    const [showPosePanel, setShowPosePanel] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showLayerPanel, setShowLayerPanel] = useState(false);

    // 反馈与帮助
    const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
    const [showHelp, setShowHelp] = useState(false);

    // === 常量定义（仅一次）===
    const TOOL_KEYS: Record<PixelTool, string> = {
      pencil: 'P', eraser: 'E', fill: 'F', picker: 'I', line: 'L', rect: 'R',
    };
    const TOOL_LABELS: Record<PixelTool, string> = {
      pencil: '画笔', eraser: '橡皮', fill: '填充', picker: '取色', line: '直线', rect: '矩形',
    };
    const MIRROR_LABELS: Record<'off' | 'global' | 'bodypart', string> = {
      off: '关', global: '全局', bodypart: '智能',
    };
    const BODY_PART_LABELS: Record<string, string> = {
      head: '头部', headOverlay: '帽子',
      body: '身体', bodyOverlay: '外套',
      rightArm: '右臂', rightArmOverlay: '右袖',
      leftArm: '左臂', leftArmOverlay: '左袖',
      rightLeg: '右腿', rightLegOverlay: '右裤',
      leftLeg: '左腿', leftLegOverlay: '左裤',
    };

    // === 绘图相关状态 ===
    const [isPainting, setIsPainting] = useState(false);
    const lastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    // dragStart 用于 line/rect 工具记录起始点，使用 let 避免 Ref 类型推断问题
    let dragStart: { x: number; y: number } | null = null;

    // === Canvas 上下文辅助 ===
    const activeCtx = useCallback((): CanvasRenderingContext2D | null => {
      const layer = layers.find(l => l.id === activeLayerId);
      return layer?.canvas.getContext('2d') ?? null;
    }, [layers, activeLayerId]);

    // 获取指定图层的上下文（用于 3D 直绘）
    const getLayerCtx = useCallback((layerId: string): CanvasRenderingContext2D | null => {
      const layer = layers.find(l => l.id === layerId);
      return layer?.canvas.getContext('2d') ?? null;
    }, [layers]);

    // === v1.1 滤镜引擎 ===
    const buildFilterString = useCallback((type: FilterNode['type'], params: Record<string, number>): string => {
      const v = params.value ?? 1;
      switch (type) {
        case 'brightness': return `brightness(${v})`;
        case 'contrast': return `contrast(${v})`;
        case 'hue': return `hue-rotate(${params.deg ?? 0}deg)`;
        case 'saturation': return `saturate(${v})`;
        case 'sepia': return `sepia(${v})`;
        case 'grayscale': return `grayscale(${v})`;
        case 'invert': return `invert(${v})`;
        case 'sharpen': return 'contrast(1.2) brightness(1.05)';
        case 'noise': return 'none'; // 需要 WebGL 着色器，暂不支持
        default: return 'none';
      }
    }, []);

    const applyFilters = useCallback((
      srcCanvas: HTMLCanvasElement,
      dstCtx: CanvasRenderingContext2D,
      pipeline: FilterPipeline,
      scale: number
    ) => {
      if (!pipeline.enabled || pipeline.filters.length === 0) {
        dstCtx.drawImage(srcCanvas, 0, 0, srcCanvas.width * scale, srcCanvas.height * scale);
        return;
      }
      const temp = document.createElement('canvas');
      temp.width = srcCanvas.width;
      temp.height = srcCanvas.height;
      const tctx = temp.getContext('2d')!;
      tctx.drawImage(srcCanvas, 0, 0);
      pipeline.filters.filter(f => f.enabled).forEach(f => {
        const filterStr = buildFilterString(f.type, f.params);
        tctx.filter = filterStr;
        tctx.drawImage(temp, 0, 0);
        tctx.filter = 'none';
      });
      dstCtx.drawImage(temp, 0, 0, temp.width * scale, temp.height * scale);
    }, [buildFilterString]);

    const redraw = useCallback(() => {
      const view = viewRef.current;
      if (!view) return;
      const z = view.width / 64;
      const ctx = view.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      // 棋盘格底（表示透明）
      const cell = Math.max(4, Math.floor(z / 2));
      for (let y = 0; y < view.height; y += cell) {
        for (let x = 0; x < view.width; x += cell) {
          ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? '#2a2a2a' : '#222222';
          ctx.fillRect(x, y, cell, cell);
        }
      }
      // 合成所有可见图层到 64x64 临时画布
      const composite = document.createElement('canvas');
      composite.width = 64;
      composite.height = 64;
      const cctx = composite.getContext('2d')!;
      cctx.imageSmoothingEnabled = false;
      // 按层级顺序绘制（数组顺序 = 绘制顺序，后绘制的在上层）
      layers.forEach(layer => {
        if (!layer.visible) return;
        cctx.globalAlpha = layer.opacity / 100;
        cctx.globalCompositeOperation = layer.blendMode;
        cctx.drawImage(layer.canvas, 0, 0);
      });
      cctx.globalAlpha = 1;
      cctx.globalCompositeOperation = 'source-over';
      // 应用滤镜管线并绘制到 view（带缩放）
      applyFilters(composite, ctx, filterPipeline, z);
      // 网格覆盖在滤镜之上
      if (showGrid && z >= 6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 64; i++) {
          ctx.moveTo(i * z + 0.5, 0);
          ctx.lineTo(i * z + 0.5, view.height);
          ctx.moveTo(0, i * z + 0.5);
          ctx.lineTo(view.width, i * z + 0.5);
        }
        ctx.stroke();
      }
    }, [layers, showGrid, filterPipeline, applyFilters]);

    useEffect(() => {
      redraw();
    }, [redraw]);

    // === 初始化：载入起始纹理到 base 图层，其他图层空白 ===
    useEffect(() => {
      if (!initialUrl) {
        setReady(true);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const baseLayer = layers.find(l => l.id === 'base');
        if (!baseLayer) {
          setReady(true);
          return;
        }
        const bctx = baseLayer.canvas.getContext('2d');
        if (!bctx) {
          setReady(true);
          return;
        }
        bctx.imageSmoothingEnabled = false;
        bctx.clearRect(0, 0, 64, 64);
        if (img.naturalWidth === 64 && img.naturalHeight === 32) {
          // 老格式：上半部照搬，下半部（表层）留透明
          bctx.drawImage(img, 0, 0);
        } else {
          bctx.drawImage(img, 0, 0, 64, 64);
        }
        setReady(true);
      };
      img.onerror = () => setReady(true);
      img.src = initialUrl;
    }, [initialUrl, layers]);

    // === 合成数据URL ===
    const compositeDataUrl = useCallback((): string => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      layers.forEach(l => {
        if (!l.visible) return;
        ctx.globalAlpha = l.opacity / 100;
        ctx.globalCompositeOperation = l.blendMode;
        ctx.drawImage(l.canvas, 0, 0);
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return c.toDataURL('image/png');
    }, [layers]);

    // === 历史记录（存储完整 layers 数组快照）===
    const snapshotLayers = useCallback((): Layer[] => {
      return layers.map(l => ({
        ...l,
        canvas: (() => {
          const c = document.createElement('canvas');
          c.width = 64;
          c.height = 64;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(l.canvas, 0, 0);
          return c;
        })(),
      }));
    }, [layers]);

    const pushHistory = useCallback(() => {
      const shot = snapshotLayers();
      setUndoStack((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), shot]);
      setRedoStack([]);
    }, [snapshotLayers]);

    const restoreLayers = useCallback(
      (shotLayers: Layer[], done?: () => void) => {
        let pending = shotLayers.length;
        const finish = () => {
          pending -= 1;
          if (pending === 0) {
            redraw();
            done?.();
          }
        };
        shotLayers.forEach(l => {
          const targetLayer = layers.find(l2 => l2.id === l.id);
          if (!targetLayer) {
            pending--;
            return;
          }
          const img = new Image();
          img.onload = () => {
            const ctx = targetLayer.canvas.getContext('2d')!;
            ctx.clearRect(0, 0, 64, 64);
            ctx.drawImage(img, 0, 0);
            finish();
          };
          img.src = l.canvas.toDataURL();
        });
        if (pending === 0) finish(); // 无图层时直接完成
      },
      [layers, redraw],
    );

    const emit = useCallback(() => {
      const url = compositeDataUrl();
      if (url) onChange(url);
    }, [compositeDataUrl, onChange]);

    // === 撤销/重做 ===
    const undo = useCallback(() => {
      setUndoStack((prev: LayerShot[]) => {
        if (prev.length === 0) return prev;
        const shot = prev[prev.length - 1];
        const cur = snapshotLayers();
        if (cur) setRedoStack((r: LayerShot[]) => [...r.slice(-(HISTORY_LIMIT - 1)), cur]);
        restoreLayers(shot, emit);
        return prev.slice(0, -1);
      });
    }, [snapshotLayers, restoreLayers, emit]);

    const redo = useCallback(() => {
      setRedoStack((prev: LayerShot[]) => {
        if (prev.length === 0) return prev;
        const shot = prev[prev.length - 1];
        const cur = snapshotLayers();
        if (cur) setUndoStack((u: LayerShot[]) => [...u.slice(-(HISTORY_LIMIT - 1)), cur]);
        restoreLayers(shot, emit);
        return prev.slice(0, -1);
      });
    }, [snapshotLayers, restoreLayers, emit]);

    // === 带反馈的操作封装 ===
    const handleSave = useCallback(() => {
      const url = compositeDataUrl();
      if (!url) {
        pushToast('没有可保存的纹理', 'error');
        return;
      }
      onSave(url);
      pushToast('已保存到项目', 'success');
    }, [compositeDataUrl, onSave, pushToast]);

    const handleUndo = useCallback(() => {
      if (undoStack.length === 0) {
        pushToast('没有可撤销的操作', 'info');
        return;
      }
      undo();
    }, [undoStack.length, undo, pushToast]);

    const handleRedo = useCallback(() => {
      if (redoStack.length === 0) {
        pushToast('没有可重做的操作', 'info');
        return;
      }
      redo();
    }, [redoStack.length, redo, pushToast]);

    // === 绘制原语 ===
    const dab = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
      const n = brushSize;
      const half = Math.floor(n / 2);
      if (tool === 'eraser') {
        ctx.clearRect(x - half, y - half, n, n);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x - half, y - half, n, n);
      }
      
      // 智能镜像：根据 mirrorMode 决定镜像行为
      const mode = mirrorMode;
      if (mode !== 'off') {
        // 智能镜像：根据身体部位决定镜像位置
        const getMirrorX = (x: number, y: number): number | null => {
          // 根据 Y 坐标判断身体部位
          if (y >= 0 && y < 8) return 63 - x; // 头部区域
          if (y >= 8 && y < 20) {
            // 头部下部
            if (x < 8 || x >= 56) return null; // 头部两侧不镜像
            return 63 - x;
          }
          if (y >= 20 && y < 32) {
            // 身体和手臂区域
            if (x >= 20 && x < 28) return 63 - x; // 身体
            if (x >= 44 && x < 48) return 63 - x; // 右臂
            if (x >= 36 && x < 40) return 63 - x; // 左臂
          }
          if (y >= 32 && y < 48) {
            // 下半身
            if (x >= 4 && x < 8) return 63 - x; // 右腿
            if (x >= 20 && x < 24) return 63 - x; // 左腿
          }
          if (y >= 48 && y < 52) {
            // 鞋子区域
            if (x >= 4 && x < 8) return 63 - x;
            if (x >= 20 && x < 24) return 63 - x;
          }
          return 63 - x; // 默认全局镜像
        };
        
        if (mode === 'bodypart') {
          const mx = getMirrorX(x, y);
          if (mx !== null && mx !== x) {
            if (tool === 'eraser') {
              ctx.clearRect(mx - half, y - half, n, n);
            } else {
              ctx.fillStyle = color;
              ctx.fillRect(mx - half, y - half, n, n);
            }
          }
        } else if (mode === 'global') {
          const mx = 63 - x;
          if (mx !== x) {
            if (tool === 'eraser') {
              ctx.clearRect(mx - half, y - half, n, n);
            } else {
              ctx.fillStyle = color;
              ctx.fillRect(mx - half, y - half, n, n);
            }
          }
        }
      }
    }, [tool, color, brushSize, mirrorMode]);

    const strokeLine = useCallback(
      (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const steps = Math.max(dx, dy);
        if (steps === 0) {
          dab(ctx, x0, y0);
          return;
        }
        for (let i = 0; i <= steps; i++) {
          const x = Math.round(x0 + ((x1 - x0) * i) / steps);
          const y = Math.round(y0 + ((y1 - y0) * i) / steps);
          dab(ctx, x, y);
        }
      },
      [dab],
    );

    const rememberColor = useCallback((c: string) => {
      setRecentColors((prev) => [c, ...prev.filter((x) => x !== c)].slice(0, 12));
    }, []);

    // === 取色 / 坐标转换 / 填充 ===
    const pickAt = useCallback((x: number, y: number) => {
      if (x < 0 || y < 0 || x >= 64 || y >= 64) return;
      const baseLayer = layers.find(l => l.id === 'base');
      const overLayer = layers.find(l => l.id === 'overlay');
      const base = baseLayer?.canvas.getContext('2d');
      const over = overLayer?.canvas.getContext('2d');
      if (!base || !over) return;
      const o = over.getImageData(x, y, 1, 1).data;
      const src = o[3] !== 0 ? o : base.getImageData(x, y, 1, 1).data;
      if (src[3] === 0) return;
      const hex = `#${((src[0] ?? 0) << 16 | (src[1] ?? 0) << 8 | (src[2] ?? 0)).toString(16).padStart(6, '0')}`;
      setColor(hex);
    }, [layers]);

    const pickColor = useCallback(
      (e: React.MouseEvent) => {
        const view = viewRef.current;
        if (!view) return;
        const rect = view.getBoundingClientRect();
        const x = Math.floor(((e.clientX - rect.left) / rect.width) * 64);
        const y = Math.floor(((e.clientY - rect.top) / rect.height) * 64);
        pickAt(x, y);
      },
      [pickAt],
    );

    const eventPos = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
      const view = viewRef.current;
      if (!view) return null;
      const rect = view.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * 64);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * 64);
      if (x < 0 || y < 0 || x >= 64 || y >= 64) return null;
      return { x, y };
    }, []);

    const handleFloodFill = useCallback((ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
      const partName = getBodyPartAt('classic', sx, sy);
      floodFill({
        ctx,
        sx,
        sy,
        color: color,
        mirrorMode: partName ? mirrorMode : 'off',
        model: 'classic',
        partName: partName ?? 'body',
      });
    }, [color, mirrorMode, getBodyPartAt]);

    // === 事件处理 ===

    const handlePointerDown = useCallback(
      (e: React.MouseEvent) => {
        if (tool === 'picker') {
          pickColor(e);
          return;
        }
        const p = eventPos(e);
        const ctx = activeCtx();
        if (!p || !ctx) return;
        pushHistory();
        setIsPainting(true);
        lastPos.current = p;
        const t = tool;
        if (t === 'pencil' || t === 'eraser') {
          dab(ctx, p.x, p.y);
          redraw();
        } else if (t === 'fill') {
          handleFloodFill(ctx, p.x, p.y);
          redraw();
          rememberColor(color);
          emit();
        }
      },
      [activeCtx, eventPos, pushHistory, dab, floodFill, redraw, rememberColor, emit, pickColor],
    );

    const handlePointerMove = useCallback(
      (e: React.MouseEvent) => {
        if (!isPainting) return;
        const p = eventPos(e);
        const ctx = activeCtx();
        if (!p || !ctx) return;
        const t = tool;
        if (t === 'pencil' || t === 'eraser') {
          const last = lastPos.current ?? p;
          strokeLine(ctx, last.x, last.y, p.x, p.y);
          lastPos.current = p;
          redraw();
        } else if ((t === 'line' || t === 'rect') && dragStart) {
          // line/rect 在 pointermove 中由 pointerUp 完成绘制，此处仅预览
        }
      },
      [isPainting, eventPos, strokeLine, redraw],
    );

    const handlePointerUp = useCallback(() => {
      if (!isPainting) return;
      setIsPainting(false);
      const t = tool;
      if (t === 'pencil' || t === 'eraser' || t === 'line' || t === 'rect') {
        rememberColor(color);
        emit();
      }
      dragStart = null;
    }, [rememberColor, emit]);

    // === 3D 直绘入口（官方 skinview3d 视图调用）===
    const painting3DRef = useRef(false);
    const last3DRef = useRef<{ x: number; y: number } | null>(null);
    const lastPart3DRef = useRef<string | null>(null);
    const painted3DRef = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        // === 3D 直绘 ===
        paintStart(x: number, y: number, isOverlay: boolean, partKey: string) {
          const t = tool;
          if (t === 'picker') {
            pickAt(x, y);
            return;
          }
          const layerId = isOverlay ? 'overlay' : activeLayerId;
          const ctx = getLayerCtx(layerId);
          if (!ctx || x < 0 || y < 0 || x >= 64 || y >= 64) return;
          pushHistory();
          painting3DRef.current = true;
          painted3DRef.current = false;
          last3DRef.current = { x, y };
          lastPart3DRef.current = partKey;
          if (t === 'pencil' || t === 'eraser') {
            dab(ctx, x, y);
            painted3DRef.current = true;
            redraw();
          } else if (t === 'fill') {
            handleFloodFill(ctx, x, y);
            painted3DRef.current = true;
            redraw();
            rememberColor(color);
            emit();
          } else {
            // line/rect 在 3D 下退化为单点，避免跨面拉线污染贴图
            dab(ctx, x, y);
            painted3DRef.current = true;
            redraw();
          }
        },
        paintMove(x: number, y: number, isOverlay: boolean, partKey: string) {
          if (!painting3DRef.current) return;
          const t = tool;
          if (t !== 'pencil' && t !== 'eraser') return;
          const layerId = isOverlay ? 'overlay' : activeLayerId;
          const ctx = getLayerCtx(layerId);
          if (!ctx || x < 0 || y < 0 || x >= 64 || y >= 64) return;
          // 跨部位/跨图层：只落单点，不连线
          if (lastPart3DRef.current !== null && lastPart3DRef.current !== partKey) {
            dab(ctx, x, y);
          } else {
            const last = last3DRef.current ?? { x, y };
            strokeLine(ctx, last.x, last.y, x, y);
          }
          last3DRef.current = { x, y };
          lastPart3DRef.current = partKey;
          painted3DRef.current = true;
          redraw();
        },
        paintEnd() {
          if (!painting3DRef.current && !painted3DRef.current) return;
          painting3DRef.current = false;
          last3DRef.current = null;
          lastPart3DRef.current = null;
          if (painted3DRef.current) {
            painted3DRef.current = false;
            rememberColor(color);
            emit();
          }
        },
        // v1.1 姿势控制
        setPose(preset: PosePreset) {
          setPose(preset);
        },
        setCustomPose(joint: keyof JointAngles, axis: 'x' | 'y' | 'z', value: number) {
          setCustomPose(prev => ({
            ...prev,
            [joint]: { ...prev[joint], [axis]: value },
          }));
        },
        resetPose() {
          setPose('idle');
          setCustomPose({
            head: { x: 0, y: 0, z: 0 },
            body: { x: 0, y: 0, z: 0 },
            leftArm: { x: 0, y: 0, z: 0 },
            rightArm: { x: 0, y: 0, z: 0 },
            leftLeg: { x: 0, y: 0, z: 0 },
            rightLeg: { x: 0, y: 0, z: 0 },
          });
        },
        // v1.2 图层操作
        layerOps: {
          addLayer: (name?: string, type?: LayerType) => {
            const newLayer = createCustomLayer(name ?? `图层 ${layers.filter(l => l.type === 'custom').length + 1}`);
            if (type) newLayer.type = type;
            setLayers(prev => [...prev, newLayer]);
            setActiveLayerId(newLayer.id);
            pushHistory();
            return newLayer.id;
          },
          duplicateLayer: (id: string) => {
            const src = layers.find(l => l.id === id);
            if (!src) return '';
            const newLayer = createCustomLayer(`${src.name} 副本`);
            const dstCtx = newLayer.canvas.getContext('2d')!;
            dstCtx.drawImage(src.canvas, 0, 0);
            newLayer.opacity = src.opacity;
            newLayer.blendMode = src.blendMode;
            newLayer.visible = src.visible;
            newLayer.locked = src.locked;
            const insertIndex = layers.findIndex(l => l.id === id) + 1;
            setLayers(prev => {
              const next = [...prev];
              next.splice(insertIndex, 0, newLayer);
              return next;
            });
            setActiveLayerId(newLayer.id);
            pushHistory();
            return newLayer.id;
          },
          deleteLayer: (id: string) => {
            if (layers.length <= 1) return;
            if (id === 'base' || id === 'overlay') return; // 保护基础图层
            setLayers(prev => prev.filter(l => l.id !== id));
            setActiveLayerId(layers.find(l => l.id !== id)?.id ?? 'base');
            pushHistory();
          },
          clearLayer: (id: string) => {
            const layer = layers.find(l => l.id === id);
            if (!layer) return;
            const ctx = layer.canvas.getContext('2d')!;
            ctx.clearRect(0, 0, 64, 64);
            pushHistory();
            redraw();
            emit();
          },
          renameLayer: (id: string, name: string) => {
            setLayers(prev => prev.map(l => l.id === id ? { ...l, name } : l));
          },
          moveLayer: (fromIndex: number, toIndex: number) => {
            setLayers(prev => {
              const next = [...prev];
              const [removed] = next.splice(fromIndex, 1);
              next.splice(toIndex, 0, removed);
              return next;
            });
            pushHistory();
          },
          setLayerProps: (id: string, props: Partial<Layer>) => {
            setLayers(prev => prev.map(l => l.id === id ? { ...l, ...props } : l));
          },
          mergeDown: (id: string) => {
            const index = layers.findIndex(l => l.id === id);
            if (index <= 0) return;
            const upper = layers[index];
            const lower = layers[index - 1];
            const lowerCtx = lower.canvas.getContext('2d')!;
            lowerCtx.globalAlpha = upper.opacity / 100;
            lowerCtx.globalCompositeOperation = upper.blendMode;
            lowerCtx.drawImage(upper.canvas, 0, 0);
            lowerCtx.globalAlpha = 1;
            lowerCtx.globalCompositeOperation = 'source-over';
            setLayers(prev => prev.filter(l => l.id !== id));
            pushHistory();
            redraw();
            emit();
          },
          mergeVisible: () => {
            const visibleLayers = layers.filter(l => l.visible && l.id !== 'base');
            if (visibleLayers.length === 0) return;
            const baseLayer = layers.find(l => l.id === 'base');
            if (!baseLayer) return;
            const baseCtx = baseLayer.canvas.getContext('2d')!;
            visibleLayers.forEach(l => {
              baseCtx.globalAlpha = l.opacity / 100;
              baseCtx.globalCompositeOperation = l.blendMode;
              baseCtx.drawImage(l.canvas, 0, 0);
            });
            baseCtx.globalAlpha = 1;
            baseCtx.globalCompositeOperation = 'source-over';
            setLayers(prev => prev.filter(l => l.id === 'base' || l.id === 'overlay' || !l.visible));
            pushHistory();
            redraw();
            emit();
          }
        },
      })
      // @ts-expect-error: dependency array false positive
      [dab, strokeLine, handleFloodFill, pickAt, pushHistory, rememberColor, emit, redraw, layers, activeLayerId, createCustomLayer],
    );


    // === 文件上传/下载 ===
    const handleUpload = useCallback(
      (fileList: FileList | null) => {
        const f = fileList?.[0];
        if (!f) return;
        const ctx = activeCtx();
        if (!ctx) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            // 只接受 64x64 / 64x32，其他尺寸拒绝，避免贴图错位
            if (!((w === 64 && h === 64) || (w === 64 && h === 32))) {
              pushToast(`已拒绝 ${w}x${h}：仅支持 64x64 / 64x32 PNG`, 'error');
              return;
            }
            pushHistory();
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, 64, 64);
            ctx.drawImage(img, 0, 0);
            redraw();
            emit();
            pushToast(`已载入 ${f.name}`, 'success');
          };
          img.src = String(reader.result ?? '');
        };
        reader.readAsDataURL(f);
      },
      [activeCtx, pushHistory, redraw, emit, pushToast],
    );

    const handleDownload = useCallback(() => {
      const url = compositeDataUrl();
      if (!url) {
        pushToast('没有可导出的纹理', 'error');
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skin.png';
      a.click();
      pushToast('已导出 skin.png', 'success');
    }, [compositeDataUrl, pushToast]);

    const handleClearLayer = useCallback(() => {
      const ctx = activeCtx();
      if (!ctx) return;
      pushHistory();
      ctx.clearRect(0, 0, 64, 64);
      redraw();
      emit();
      pushToast('已清空当前图层', 'info');
    }, [activeCtx, pushHistory, redraw, emit, pushToast]);

    const addCustomColor = useCallback(() => {
      setCustomColors((prev) => {
        if (prev.includes(color)) return prev;
        const next = [color, ...prev].slice(0, 24);
        try {
          localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }, [color]);

    // === 键盘处理 ===
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod) return;
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      // Shift + 键：面板切换
      if (e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'p': setShowPosePanel(v => !v); break;
          case 'f': setShowFilterPanel(v => !v); break;
          case 'l': setShowLayerPanel(v => !v); break;
          default: break;
        }
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'p': setTool('pencil'); break;
        case 'e': setTool('eraser'); break;
        case 'f': setTool('fill'); break;
        case 'i': setTool('picker'); break;
        case 'l': setTool('line'); break;
        case 'r': setTool('rect'); break;
        case 'm': setMirrorMode((v) => v === 'off' ? 'global' : v === 'global' ? 'bodypart' : 'off'); break;
        case 'g': setShowGrid((v) => !v); break;
        default: break;
      }
    }, [handleUndo, handleRedo]);

    const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    }, []);

    // === 鼠标滚轮缩放 ===
    const handleWheel = useCallback((e: React.WheelEvent) => {
      e.preventDefault();
      const canvas = viewRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const newZoom = Math.max(1, Math.min(12, zoom * (e.deltaY > 0 ? 0.9 : 1.1))) as (typeof ZOOMS)[number];
      const scale = newZoom / zoom;
      setZoom(newZoom);
      setPan(prev => ({
        x: pan.x - (cx - rect.left) * (scale - 1),
        y: pan.y - (cy - rect.top) * (scale - 1),
      }));
    }, [zoom]);

    // === 触摸手势：双指捏合缩放 + 双指拖拽平移；单指落笔走 Pointer 事件 ===
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const touches = Array.from(e.touches);
        const [t1, t2] = touches;
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        setTouchStartDist(dist);
        setTouchMid({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });
      }
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      if (e.touches.length === 2 && touchStartDist !== null) {
        e.preventDefault();
        const touches = Array.from(e.touches);
        const [t1, t2] = touches;
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const scale = dist / (touchStartDist || 1);
        setZoom(Math.max(1, Math.min(12, zoom * scale)) as (typeof ZOOMS)[number]);
        setTouchStartDist(dist);
        const mid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
        if (touchMid) {
          const dx = mid.x - touchMid.x;
          const dy = mid.y - touchMid.y;
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        }
        setTouchMid(mid);
      } else if (e.touches.length === 1 && !spaceDown) {
        const t = e.touches[0];
        const canvas = viewRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(63, ((t.clientX - rect.left) / rect.width) * 64));
        const y = Math.max(0, Math.min(63, ((t.clientY - rect.top) / rect.height) * 64));
        setHoverInfo({ x, y, part: getBodyPartAt('classic', x, y) });
      }
    }, [zoom, touchStartDist, touchMid, spaceDown, setHoverInfo, getBodyPartAt]);

    const handleTouchEnd = useCallback(() => {
      setTouchStartDist(null);
      setTouchMid(null);
    }, []);

    // === 工具按钮数据 ===
    const tools: Array<{ id: PixelTool; label: string; icon: React.ReactNode; key: string }> = [
      { id: 'pencil', label: '画笔', icon: <Pencil className="h-3.5 w-3.5" />, key: 'P' },
      { id: 'eraser', label: '橡皮', icon: <Eraser className="h-3.5 w-3.5" />, key: 'E' },
      { id: 'fill', label: '填充', icon: <PaintBucket className="h-3.5 w-3.5" />, key: 'F' },
      { id: 'picker', label: '取色', icon: <Pipette className="h-3.5 w-3.5" />, key: 'I' },
      { id: 'line', label: '直线', icon: <PenLine className="h-3.5 w-3.5" />, key: 'L' },
      { id: 'rect', label: '矩形', icon: <Square className="h-3.5 w-3.5" />, key: 'R' },
    ];

    // === 尺寸计算 ===
    const size = 64 * zoom;

    // === 渲染 ===
    return (
      <div className="skin-pixel-editor" onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} tabIndex={0} role="application" aria-label="皮肤像素编辑器">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-mc-mute">图层</span>
            <button
              onClick={() => setActiveLayerId('base')}
              className={`px-2 py-1 rounded-mc ${activeLayerId === 'base' ? 'bg-mc-primary text-mc-on-primary' : 'bg-mc-surface-2 text-mc-fg'}`}
              title="底层 (帽子/外套/袖子/裤子第一层)"
            >
              底层
            </button>
            <button
              onClick={() => setActiveLayerId('overlay')}
              className={`px-2 py-1 rounded-mc ${activeLayerId === 'overlay' ? 'bg-mc-primary text-mc-on-primary' : 'bg-mc-surface-2 text-mc-fg'}`}
              title="表层 (帽子/外套/袖子/裤子第二层)"
            >
              表层
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-mc-mute">镜像</span>
            <button
              onClick={() => setMirrorMode((v: any) => v === 'off' ? 'global' : v === 'global' ? 'bodypart' : 'off')}
              className={`px-2 py-1 rounded-mc ${mirrorMode === 'off' ? 'bg-mc-primary text-mc-on-primary' : 'bg-mc-surface-2 text-mc-fg'}`}
              title="镜像模式: 关/全局/智能"
            >
              {MIRROR_LABELS[mirrorMode]}
            </button>
          </div>
        </div>

        {/* 图层控制 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-mc border border-mc-border">
            {(['base', 'overlay'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setActiveLayerId(l)}
                className={`px-2 py-1 ${activeLayerId === l ? 'bg-mc-accent/25 text-mc-text' : 'bg-mc-surface-2 text-mc-dim'}`}
              >
                {l === 'base' ? '底层' : '表层'}
              </button>
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-mc-border" />
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setBrushSize(n)}
              title={`笔刷 ${n}px`}
              className={`rounded-mc border px-1.5 py-1 ${brushSize === n ? 'border-mc-accent bg-mc-accent/20 text-mc-text' : 'border-mc-border bg-mc-surface-2 text-mc-dim'}`}
            >
              {n}px
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-mc-border" />
          <button
            onClick={() => setMirrorMode(current => current === 'off' ? 'global' : current === 'global' ? 'bodypart' : 'off')}
            title={`镜像模式: ${mirrorMode === 'off' ? '关闭' : mirrorMode === 'global' ? '全局镜' : '部位智能镜像'} (M)`}
            className={`flex items-center gap-0.5 rounded-mc px-2 py-1 transition-colors ${
              mirrorMode === 'off'
                ? 'border-mc-border bg-mc-surface-2 text-mc-dim hover:text-mc-text'
                : mirrorMode === 'global'
                  ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                  : 'border-mc-accent bg-mc-accent/20 text-mc-accent'
            }`}
          >
            <span className="flex items-center gap-0.5">
              <Pencil className="h-3 w-3" />
              <span className="text-xs font-medium">
                {mirrorMode === 'off' ? '镜像关' : mirrorMode === 'global' ? '全局镜' : '智能镜'}
              </span>
            </span>
          </button>
          <button
            onClick={() => setShowGrid((v) => !v)}
            title="像素网格 (G)"
            className={`rounded-mc border px-2 py-1 ${showGrid ? 'border-mc-accent bg-mc-accent/20 text-mc-text' : 'border-mc-border bg-mc-surface-2 text-mc-dim'}`}
          >
            网格
          </button>
          <span className="mx-1 h-4 w-px bg-mc-border" />
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`rounded-mc border px-1.5 py-1 ${zoom === z ? 'border-mc-accent bg-mc-accent/20 text-mc-text' : 'border-mc-border bg-mc-surface-2 text-mc-dim'}`}
            >
              {z}x
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-mc-border" />
          {/* v1.1 姿势/滤镜面板切换 */}
          <button
            onClick={() => setShowPosePanel(v => !v)}
            title="姿势面板 (Shift+P)"
            className={`flex items-center gap-1 rounded-mc border px-2 py-1 transition-colors ${
              showPosePanel
                ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                : 'border-mc-border bg-mc-surface-2 text-mc-dim hover:text-mc-text'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="text-[11px]">姿势</span>
          </button>
          <button
            onClick={() => setShowFilterPanel(v => !v)}
            title="滤镜面板 (Shift+F)"
            className={`flex items-center gap-1 rounded-mc border px-2 py-1 transition-colors ${
              showFilterPanel
                ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                : 'border-mc-border bg-mc-surface-2 text-mc-dim hover:text-mc-text'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="text-[11px]">滤镜</span>
          </button>
          <span className="mx-1 h-4 w-px bg-mc-border" />
          {/* v1.2 图层面板切换 */}
          <button
            onClick={() => setShowLayerPanel(v => !v)}
            title="图层面板 (Shift+L)"
            className={`flex items-center gap-1 rounded-mc border px-2 py-1 transition-colors ${
              showLayerPanel
                ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                : 'border-mc-border bg-mc-surface-2 text-mc-dim hover:text-mc-text'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="text-[11px]">图层</span>
          </button>
        </div>

        {/* 画布 */}
        <div className="flex justify-center overflow-auto rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          {!ready ? (
            <div className="flex h-48 items-center justify-center text-xs text-mc-mute">载入纹理…</div>
          ) : (
            <canvas
              ref={viewRef}
              width={size}
              height={size}
              style={{
                width: size,
                height: size,
                imageRendering: 'pixelated',
                cursor: spaceDown ? 'grab' : 'crosshair',
                touchAction: 'none',
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={handleWheel}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              tabIndex={0}
              role="application"
              aria-label="皮肤像素画布"
            />
          )}
        </div>

        {/* v1.1 浮动面板：姿势 / 滤镜 */}
        {showPosePanel && (
          <div className="absolute right-4 top-4 z-10">
            <PosePanel
              pose={pose}
              customPose={customPose}
              onPoseChange={setPose}
              onCustomPoseChange={(joint, axis, value) =>
                setCustomPose(prev => ({
                  ...prev,
                  [joint]: { ...prev[joint], [axis]: value },
                }))
              }
              onReset={() => {
                setPose('idle');
                setCustomPose({
                  head: { x: 0, y: 0, z: 0 },
                  body: { x: 0, y: 0, z: 0 },
                  leftArm: { x: 0, y: 0, z: 0 },
                  rightArm: { x: 0, y: 0, z: 0 },
                  leftLeg: { x: 0, y: 0, z: 0 },
                  rightLeg: { x: 0, y: 0, z: 0 },
                });
              }}
            />
          </div>
        )}
        {showFilterPanel && (
          <div className="absolute right-4 top-4 z-10">
            <FilterPanel
              pipeline={filterPipeline}
              onPipelineChange={setFilterPipeline}
            />
          </div>
        )}
        {showLayerPanel && (
          <div className="absolute right-4 top-4 z-10">
            <LayerPanel
              layers={layers}
              activeLayerId={activeLayerId}
              onLayerSelect={setActiveLayerId}
              onLayerAdd={(name, type) => {
                const newLayer = createCustomLayer(name ?? `图层 ${layers.filter(l => l.type === 'custom').length + 1}`);
                if (type) newLayer.type = type;
                setLayers(prev => [...prev, newLayer]);
                setActiveLayerId(newLayer.id);
                pushHistory();
                return newLayer.id;
              }}
              onLayerDuplicate={(id) => {
                const src = layers.find(l => l.id === id);
                if (!src) return '';
                const newLayer = createCustomLayer(`${src.name} 副本`);
                const dstCtx = newLayer.canvas.getContext('2d')!;
                dstCtx.drawImage(src.canvas, 0, 0);
                newLayer.opacity = src.opacity;
                newLayer.blendMode = src.blendMode;
                newLayer.visible = src.visible;
                newLayer.locked = src.locked;
                const insertIndex = layers.findIndex(l => l.id === id) + 1;
                setLayers(prev => {
                  const next = [...prev];
                  next.splice(insertIndex, 0, newLayer);
                  return next;
                });
                setActiveLayerId(newLayer.id);
                pushHistory();
                return newLayer.id;
              }}
              onLayerDelete={(id) => {
                if (layers.length <= 1) return;
                const layer = layers.find(l => l.id === id);
                if (layer?.type === 'base' || layer?.type === 'overlay') return;
                setLayers(prev => prev.filter(l => l.id !== id));
                setActiveLayerId(layers.find(l => l.id !== id)?.id ?? 'base');
                pushHistory();
              }}
              onLayerClear={(id) => {
                const layer = layers.find(l => l.id === id);
                if (!layer) return;
                const ctx = layer.canvas.getContext('2d')!;
                ctx.clearRect(0, 0, 64, 64);
                pushHistory();
                redraw();
                emit();
              }}
              onLayerRename={(id, name) => {
                setLayers(prev => prev.map(l => l.id === id ? { ...l, name } : l));
              }}
              onLayerMove={(fromIndex, toIndex) => {
                setLayers(prev => {
                  const next = [...prev];
                  const [removed] = next.splice(fromIndex, 1);
                  next.splice(toIndex, 0, removed);
                  return next;
                });
                pushHistory();
              }}
              onLayerPropsChange={(id, props) => {
                setLayers(prev => prev.map(l => l.id === id ? { ...l, ...props } : l));
              }}
              onMergeDown={(id) => {
                const index = layers.findIndex(l => l.id === id);
                if (index <= 0) return;
                const upper = layers[index];
                const lower = layers[index - 1];
                const lowerCtx = lower.canvas.getContext('2d')!;
                lowerCtx.globalAlpha = upper.opacity / 100;
                lowerCtx.globalCompositeOperation = upper.blendMode;
                lowerCtx.drawImage(upper.canvas, 0, 0);
                lowerCtx.globalAlpha = 1;
                lowerCtx.globalCompositeOperation = 'source-over';
                setLayers(prev => prev.filter(l => l.id !== id));
                pushHistory();
                redraw();
                emit();
              }}
              onMergeVisible={() => {
                const visibleLayers = layers.filter(l => l.visible && l.id !== 'base');
                if (visibleLayers.length === 0) return;
                const baseLayer = layers.find(l => l.id === 'base');
                if (!baseLayer) return;
                const baseCtx = baseLayer.canvas.getContext('2d')!;
                visibleLayers.forEach(l => {
                  baseCtx.globalAlpha = l.opacity / 100;
                  baseCtx.globalCompositeOperation = l.blendMode;
                  baseCtx.drawImage(l.canvas, 0, 0);
                });
                baseCtx.globalAlpha = 1;
                baseCtx.globalCompositeOperation = 'source-over';
                setLayers(prev => prev.filter(l => l.id === 'base' || l.id === 'overlay' || !l.visible));
                pushHistory();
                redraw();
                emit();
              }}
            />
          </div>
        )}

        {/* 状态栏 */}
        <div className="flex items-center gap-4 px-2 py-1.5 text-[11px] text-mc-mute bg-mc-surface-2/60 rounded-mc border-t border-mc-border mt-1">
          <span>{hoverInfo ? `X: ${hoverInfo.x} Y: ${hoverInfo.y}` : 'X: - Y: -'}</span>
          <span className="mx-2">|</span>
          <span>{hoverInfo?.part ? `部位: ${BODY_PART_LABELS[hoverInfo.part] || hoverInfo.part}` : '部位: -'}</span>
          <span className="mx-2">|</span>
          <span>工具: {TOOL_LABELS[tool]} {TOOL_KEYS[tool]}</span>
          <span className="mx-2">|</span>
          <span style={{ color }}>■</span>
          <span>{color}</span>
          <span className="mx-2">|</span>
          <span>镜像: {MIRROR_LABELS[mirrorMode]}</span>
          <span className="mx-2">|</span>
          <span>图层: {activeLayerId === 'base' ? '底层' : '表层'}</span>
          <span className="mx-2">|</span>
          <span>缩放: {zoom}x</span>
        </div>

        {/* 工具栏 */}
        <div className="flex gap-1 px-2 py-1 bg-mc-surface-2 rounded-mc text-xs">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
              className={`flex items-center gap-1 rounded-mc border px-2 py-1 text-[11px] transition-colors ${tool === t.id ? 'bg-mc-primary text-mc-on-primary' : 'bg-transparent text-mc-fg'}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-mc-border" />
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="撤销 (Ctrl+Z)"
            className="rounded-mc border border-mc-border bg-mc-surface-2 p-1.5 text-mc-dim hover:text-mc-text disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="重做 (Ctrl+Y)"
            className="rounded-mc border border-mc-border bg-mc-surface-2 p-1.5 text-mc-dim hover:text-mc-text disabled:opacity-40"
          >
            <Redo2 className="h-3.5 w-3.5" /> Redo
          </button>
          <span className="mx-1 h-4 w-px bg-mc-border" />
          <button
            onClick={() => setShowHelp(true)}
            title="快捷键一览 (?)"
            className="rounded-mc border border-mc-border bg-mc-surface-2 p-1.5 text-mc-dim hover:text-mc-text"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 px-2 py-1 bg-mc-surface-2 rounded-mc text-xs">
          <button
            onClick={handleSave}
            className="flex-1 py-1 rounded-mc bg-mc-primary text-mc-on-primary"
          >
            保存到项目
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 py-1 rounded-mc bg-mc-surface-2 text-mc-fg"
          >
            <Download className="h-3.5 w-3.5" /> 下载 PNG
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-1 py-1 rounded-mc bg-mc-surface-2 text-mc-fg"
          >
            <Upload className="h-3.5 w-3.5" /> 上传 PNG
          </button>
          <button
            onClick={addCustomColor}
            title="加入自定义调色板"
            className="flex-1 py-1 rounded-mc bg-mc-surface-2 text-mc-dim hover:text-mc-text"
          >
            <Plus className="h-3 w-3" /> 入板
          </button>
        </div>

        {/* 颜色选择器 */}
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-12 cursor-pointer rounded-mc border border-mc-border bg-mc-surface-2"
          />
          <input
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="mc-input w-24 !py-1 !text-xs"
          />
          <button
            onClick={addCustomColor}
            title="加入自定义调色板"
            className="flex items-center gap-0.5 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-dim hover:text-mc-text"
          >
            <Plus className="h-3 w-3" /> 入板
          </button>
          {recentColors.length > 0 && (
            <div className="flex items-center gap-0.5">
              {recentColors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="h-5 w-5 rounded-sm border border-mc-border"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-mc-mute">调色板</div>
        <div className="flex flex-wrap gap-1">
          {DEFAULT_PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-sm border ${color === c ? 'border-mc-accent' : 'border-mc-border'}`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
        {customColors.length > 0 && (
          <>
            <div className="mb-1 mt-2 text-[10px] uppercase tracking-wider text-mc-mute">自定义</div>
            <div className="flex flex-wrap gap-1">
              {customColors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-sm border ${color === c ? 'border-mc-accent' : 'border-mc-border'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </>
        )}

        {/* 导入导出 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            className="mc-btn-primary !px-2.5 !py-1 !text-[11px]"
          >
            保存到项目
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
          >
            <Download className="h-3 w-3" /> 下载 PNG
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
          >
            <Upload className="h-3 w-3" /> 上传 PNG
          </button>
          <button
            onClick={handleClearLayer}
            title="清空当前图层"
            className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-dim hover:text-mc-text"
          >
            <Trash2 className="h-3 w-3" /> 清空图层
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(e) => {
              handleUpload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="text-[10px] leading-relaxed text-mc-mute">
          快捷键：P 画笔 · E 橡皮 · F 填充 · I 取色 · L 直线 · R 矩形 · M 镜像 · G 网格 · Ctrl+Z/Y 撤销重做 · Shift+P 姿势 · Shift+F 滤镜 · Shift+L 图层 · ? 帮助 · 空格+拖拽平移。表层为帽子/外套/袖子/裤子的第二层。
        </div>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} variant="skin" />
      </div>
    );
  }
);