import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import * as THREE from 'three';
import {
  SkinViewer,
  WalkingAnimation,
  RunningAnimation,
  IdleAnimation,
  FlyingAnimation,
  type PlayerAnimation,
} from 'skinview3d';
import { officialSkinUrl } from '../../assets/skins/skins.js';
import { useModStore } from '../../store/mod-store.js';
import { FieldGroup, TextField, SelectField } from './shared/index.js';
import {
  SkinPixelEditor,
  type SkinPixelEditorHandle,
  type CapeEditorHandle,
} from './SkinPixelEditor.js';
import { CapeEditor } from './CapeEditor.js';
import { ExportEngine } from './ExportEngine.js';
import { ExportPanel } from './ExportPanel.js';
import { BodyPartVisibilityPanel } from './BodyPartVisibilityPanel.js';
import { SkinHistoryPanel } from './SkinHistoryPanel.js';
import { CollabPanel } from './CollabPanel.js';
import { PanelErrorBoundary } from './PanelErrorBoundary.js';
import { loadSkinImage, normalizeSkinPng } from './skin-normalize.js';
import { convertLegacySkinToModern, isLegacySkinSize } from '../../lib/legacy-skin.js';
import type { SkinSpec } from '@mc-creator/shared';
import { BodyPartId } from './skin-uv.js';
import {
  Shuffle,
  Play,
  Pause,
  RotateCcw,
  User,
  Sparkles,
  Camera,
  ChevronDown,
  Plus,
  Pencil,
  Check,
  ArrowLeft,
  Trash2,
} from 'lucide-react';

type AnimationType = 'idle' | 'walking' | 'running' | 'flying';

const ANIMATIONS: { id: AnimationType; label: string; factory: () => PlayerAnimation }[] = [
  { id: 'idle', label: '站立', factory: () => new IdleAnimation() },
  { id: 'walking', label: '行走', factory: () => new WalkingAnimation() },
  { id: 'running', label: '跑步', factory: () => new RunningAnimation() },
  { id: 'flying', label: '飞行', factory: () => new FlyingAnimation() },
];

// ===== 选择器：官方默认皮肤库 =====
// Steve / Alex 使用游戏原文件（assets/skins/official）；
// 其余 7 款按官方外观考据（发型/服装/配饰），由 paintSkinTexture 程序化绘制。

type HairStyle =
  'short' | 'long' | 'bob' | 'buzz' | 'bowlcut' | 'ponytail' | 'braid' | 'curly' | 'scarf';

interface SkinColors {
  skinColor: string;
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
  shoesColor: string;
}

type SkinTop = 'tee' | 'collar' | 'jacket' | 'dress' | 'overalls';

interface DefaultSkin {
  name: string;
  model: SkinSpec['model'];
  colors: SkinColors;
  hairStyle: HairStyle;
  eyeColor: string;
  beard: boolean;
  /** 上衣版型与装饰 */
  top: SkinTop;
  /** 装饰色：领口 / 内衬 / 腰带 / 背带裤上衣 */
  trimColor?: string;
  /** 袖口色（夹克） */
  cuffColor?: string;
  /** 金属假肢手臂（Sunny） */
  metalArm?: 'left' | 'right';
  /** 嘴色（默认按肤色压暗） */
  mouth?: string;
  /** 游戏原文件基准名（如 wide-steve / slim-alex），有则直接使用 */
  file?: string;
}

const DEFAULT_SKINS: DefaultSkin[] = [
  {
    name: 'Steve',
    model: 'classic',
    colors: {
      skinColor: '#b57a52',
      hairColor: '#32281f',
      shirtColor: '#2ba8a0',
      pantsColor: '#4040c8',
      shoesColor: '#3a3a3a',
    },
    hairStyle: 'short',
    eyeColor: '#3a3ac8',
    beard: true,
    top: 'tee',
    file: 'wide-steve',
  },
  {
    name: 'Alex',
    model: 'slim',
    colors: {
      skinColor: '#e8b07d',
      hairColor: '#d97b2e',
      shirtColor: '#7ab874',
      pantsColor: '#5a4632',
      shoesColor: '#4a3a2a',
    },
    hairStyle: 'long',
    eyeColor: '#3aa83a',
    beard: false,
    top: 'tee',
    file: 'slim-alex',
  },
  {
    name: 'Sunny',
    model: 'classic',
    colors: {
      skinColor: '#a06a42',
      hairColor: '#141414',
      shirtColor: '#4a8a3a',
      pantsColor: '#2a4a9a',
      shoesColor: '#2a2a2a',
    },
    hairStyle: 'bowlcut',
    eyeColor: '#101010',
    beard: false,
    mouth: '#5a3a32',
    top: 'overalls',
    trimColor: '#4a8a3a',
    metalArm: 'left',
    file: 'wide-sunny',
  },
  {
    name: 'Kai',
    model: 'classic',
    colors: {
      skinColor: '#b57a52',
      hairColor: '#e0c060',
      shirtColor: '#1a1a1a',
      pantsColor: '#1a1a1a',
      shoesColor: '#3a2a2a',
    },
    hairStyle: 'ponytail',
    eyeColor: '#3a7a4a',
    beard: false,
    top: 'dress',
    trimColor: '#a02040',
    cuffColor: '#7a4a9a',
    file: 'wide-kai',
  },
  {
    name: 'Ari',
    model: 'classic',
    colors: {
      skinColor: '#e8b07d',
      hairColor: '#6a4a2a',
      shirtColor: '#d89030',
      pantsColor: '#3a5a9a',
      shoesColor: '#4a3a2a',
    },
    hairStyle: 'braid',
    eyeColor: '#4a2a1a',
    beard: false,
    top: 'tee',
    file: 'wide-ari',
  },
  {
    name: 'Zuri',
    model: 'classic',
    colors: {
      skinColor: '#7a5238',
      hairColor: '#101010',
      shirtColor: '#c03030',
      pantsColor: '#b8a878',
      shoesColor: '#4a3a2a',
    },
    hairStyle: 'short',
    eyeColor: '#2a1a1a',
    beard: false,
    top: 'collar',
    trimColor: '#f0f0f0',
    file: 'wide-zuri',
  },
  {
    name: 'Efe',
    model: 'slim',
    colors: {
      skinColor: '#6a4632',
      hairColor: '#101010',
      shirtColor: '#2a2a30',
      pantsColor: '#2a2a30',
      shoesColor: '#3a3a3a',
    },
    hairStyle: 'short',
    eyeColor: '#1a1a1a',
    beard: false,
    top: 'jacket',
    trimColor: '#d8d8d8',
    file: 'slim-efe',
  },
  {
    name: 'Makena',
    model: 'slim',
    colors: {
      skinColor: '#5a3a28',
      hairColor: '#141414',
      shirtColor: '#e07090',
      pantsColor: '#3a5ac8',
      shoesColor: '#4a3a2a',
    },
    hairStyle: 'curly',
    eyeColor: '#1a1a1a',
    beard: false,
    top: 'tee',
    file: 'slim-makena',
  },
  {
    name: 'Noor',
    model: 'slim',
    colors: {
      skinColor: '#c89870',
      hairColor: '#2a1a2a',
      shirtColor: '#7a4a9a',
      pantsColor: '#2a2a3a',
      shoesColor: '#3a3a3a',
    },
    hairStyle: 'scarf',
    eyeColor: '#2a1a1a',
    beard: false,
    top: 'tee',
    trimColor: '#7a4a9a',
    file: 'slim-noor',
  },
];

/** 旧版 6 预设（保留兼容：随机/编辑器仍可引用色板） */
const PRESETS: {
  name: string;
  colors: Pick<SkinSpec, 'skinColor' | 'hairColor' | 'shirtColor' | 'pantsColor' | 'shoesColor'>;
}[] = DEFAULT_SKINS.slice(0, 6).map((d) => ({ name: d.name, colors: d.colors }));

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

// ===== 客户端像素小人绘制（选择器卡片/缩略图用，不占 WebGL 上下文） =====

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `#${((cl(r) << 16) | (cl(g) << 8) | cl(b)).toString(16).padStart(6, '0')}`;
}

/** Procedural detailed-skin painter params */
interface SkinFeatures {
  hairStyle: HairStyle;
  eyeColor: string;
  beard: boolean;
  mouth?: string | undefined;
  top: SkinTop;
  trimColor?: string | undefined;
  cuffColor?: string | undefined;
  metalArm?: 'left' | 'right' | undefined;
}

/**
 * Paint a full official-style 64x64 skin texture.
 * Strategy: flood the whole canvas with skin color first (base layer stays
 * opaque), then overpaint generous blocks per region (uniform colors, so the
 * 1px slim-narrowing is invisible). Face is painted on the front only.
 */
function paintSkinTexture(colors: SkinColors, _model: SkinSpec['model'], f: SkinFeatures): string {
  void _model;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const R = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const skin = colors.skinColor;
  const hair = colors.hairColor;
  const shirt = colors.shirtColor;
  const pants = colors.pantsColor;
  const shoes = colors.shoesColor;
  const trim = f.trimColor ?? shirt;
  const mouth = f.mouth ?? shade(skin, -60);

  // 0. opaque skin base over the whole canvas
  R(0, 0, 64, 64, skin);

  // 1. legs: right block (0,16,16,16), left block (16,48,16,16)
  const legBlocks = [
    [0, 16],
    [16, 48],
  ];
  for (let li = 0; li < legBlocks.length; li++) {
    const bx = legBlocks[li][0];
    const by = legBlocks[li][1];
    R(bx, by, 16, 4, pants);
    if (f.top === 'dress') {
      R(bx, by + 4, 16, 4, shirt);
      R(bx, by + 8, 16, 2, trim);
      R(bx, by + 10, 16, 4, pants);
    } else {
      R(bx, by + 4, 16, 10, pants);
    }
    R(bx, by + 14, 16, 2, shoes);
  }

  // 2. arms: right block (40,16,16,16), left block (32,48,16,16)
  const armBlocks = [
    { bx: 40, by: 16, side: 'right' },
    { bx: 32, by: 48, side: 'left' },
  ];
  for (let ai = 0; ai < armBlocks.length; ai++) {
    const bx = armBlocks[ai].bx;
    const by = armBlocks[ai].by;
    const side = armBlocks[ai].side;
    if (f.metalArm === side) {
      R(bx, by, 16, 4, '#8f8f8f');
      R(bx, by + 4, 16, 10, '#8f8f8f');
      R(bx, by + 14, 16, 2, '#6f6f6f');
      continue;
    }
    R(bx, by, 16, 4, shirt);
    R(bx, by + 4, 16, 6, shirt);
    if (f.cuffColor) R(bx, by + 10, 16, 2, f.cuffColor);
    else R(bx, by + 10, 16, 2, shirt);
    R(bx, by + 12, 16, 4, skin);
  }

  // 3. torso block (16,16,24,16)
  R(16, 16, 24, 4, shirt);
  if (f.top === 'jacket') {
    R(16, 20, 24, 12, shirt);
    R(23, 20, 2, 12, trim);
    R(16, 20, 24, 1, shade(shirt, -25));
  } else if (f.top === 'dress') {
    R(16, 20, 24, 12, shirt);
    R(16, 26, 24, 2, trim);
  } else if (f.top === 'overalls') {
    R(16, 20, 24, 12, shirt);
    R(21, 20, 1, 4, pants);
    R(26, 20, 1, 4, pants);
    R(22, 20, 4, 8, pants);
    R(22, 24, 1, 1, trim);
    R(25, 24, 1, 1, trim);
  } else {
    R(16, 20, 24, 12, shirt);
    R(20, 20, 8, 1, shade(shirt, -25));
    if (f.top === 'collar') {
      R(20, 20, 8, 1, trim);
      R(23, 21, 2, 2, trim);
    }
  }
  R(16, 31, 24, 1, shade(shirt, -18));

  // 4. hair (head base is already skin)
  R(8, 0, 8, 8, hair);
  const fringe = f.hairStyle === 'buzz' ? 0 : f.hairStyle === 'bowlcut' ? 2 : 1;
  if (fringe > 0) R(8, 8, 8, fringe, hair);
  if (f.hairStyle === 'short') {
    R(0, 8, 2, 5, hair);
    R(22, 8, 2, 5, hair);
    R(24, 8, 8, 4, hair);
  } else if (f.hairStyle === 'bob' || f.hairStyle === 'long' || f.hairStyle === 'bowlcut') {
    R(0, 8, 2, 8, hair);
    R(22, 8, 2, 8, hair);
    R(24, 8, 8, 8, hair);
  }
  if (f.hairStyle === 'long') {
    R(20, 20, 2, 4, hair);
    R(26, 20, 2, 4, hair);
  }
  if (f.hairStyle === 'ponytail') {
    R(0, 8, 2, 5, hair);
    R(22, 8, 2, 5, hair);
    R(24, 8, 8, 4, hair);
    R(28, 14, 3, 10, hair);
  }
  if (f.hairStyle === 'braid') {
    R(0, 8, 2, 5, hair);
    R(22, 8, 2, 8, hair);
    R(24, 8, 8, 8, hair);
    R(8, 8, 2, 10, hair);
    R(28, 14, 3, 10, hair);
  }
  if (f.hairStyle === 'curly' || f.hairStyle === 'bowlcut' || f.hairStyle === 'scarf') {
    const cap = f.hairStyle === 'scarf' ? trim : hair;
    R(40, 0, 8, 8, cap);
    R(40, 8, 8, 8, cap);
    R(32, 8, 8, 8, cap);
    R(48, 8, 8, 8, cap);
    R(56, 8, 8, 8, cap);
  }

  // 5. face (front x8-15, y8-15)
  R(9, 12, 2, 1, '#ffffff');
  R(13, 12, 2, 1, '#ffffff');
  R(10, 12, 1, 1, f.eyeColor);
  R(13, 12, 1, 1, f.eyeColor);
  if (f.beard) {
    R(8, 13, 8, 3, hair);
    R(11, 14, 2, 1, '#6b4632');
  } else {
    R(11, 14, 2, 1, mouth);
  }
  return canvas.toDataURL('image/png');
}

/**
 * Composite a front view from a skin texture (card thumbnails, always
 * identical to what the 3D viewer shows). Right-arm front is (44,20);
 * left-arm front is (36,52) classic / (37,52) slim — generated textures
 * flood the whole arm block uniformly so either crop is correct.
 */
function drawTextureThumb(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  model: SkinSpec['model'],
) {
  const aw = model === 'slim' ? 3 : 4;
  const ox = aw;
  canvas.width = aw * 2 + 8;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const B = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  B(8, 8, 8, 8, ox, 0, 8, 8);
  B(20, 20, 8, 12, ox, 8, 8, 12);
  B(44, 20, aw, 12, 0, 8, aw, 12);
  B(36, 52, aw, 12, ox + 8, 8, aw, 12);
  B(4, 20, 4, 12, ox, 20, 4, 12);
  B(20, 52, 4, 12, ox + 4, 20, 4, 12);
}
// ===== 已保存皮肤（localStorage 持久化） =====

interface SavedSkin {
  id: string;
  name: string;
  model: SkinSpec['model'];
  dataUrl: string;
  createdAt: number;
}

const SAVED_SKINS_KEY = 'mc-creator-saved-skins';

function loadSavedSkins(): SavedSkin[] {
  try {
    const raw = localStorage.getItem(SAVED_SKINS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedSkin[];
    return Array.isArray(arr) ? arr.filter((s) => s && s.dataUrl) : [];
  } catch {
    return [];
  }
}

/**
 * 无项目时的演示 spec：选择器直接可用，所见即所得；
 * 一旦项目产出真实 spec，自动切换到真实数据。
 */
const DEMO_SKIN: SkinSpec = {
  playerName: 'Player',
  model: 'classic',
  skinColor: '#9c6b4a',
  hairColor: '#3a2a1a',
  shirtColor: '#2ba8a0',
  pantsColor: '#4040c8',
  shoesColor: '#3a3a3a',
  generatePreview: false,
};

/**
 * 显示用的皮肤 URL：legacy `64×32` 自动转成现代 `64×64`。
 *
 * 3D 预览走 skinview3d，它只认现代布局（头 `(0,0)`、躯干 `(16,16)`、
 * 右臂 `(40,16)`、右腿 `(0,16)`、左臂 `(32,48)`、左腿 `(16,48)`）。
 * legacy 皮肤**没有左半身**，直接丢给它渲染出来的模型是「有头有躯干、
 * 四肢透明」的残缺人 —— 实测过。
 *
 * 转换只发生在**显示**层：皮肤库里存的仍然是原始 PNG（1.6/1.7 的离线皮肤
 * 资源包要的就是 64×32 原始文件，见 `offline-skin-pack.ts`）。
 *
 * 顺带把「这张图是 legacy」带出来：legacy 只有 Steve 模型，
 * 用 slim 的 UV 画它会错位。
 */
function useModernSkinUrl(url: string | null): { url: string | null; isLegacy: boolean } {
  const [state, setState] = useState<{ url: string | null; isLegacy: boolean }>({
    url,
    isLegacy: false,
  });
  useEffect(() => {
    let cancelled = false;
    if (url === null) {
      setState({ url: null, isLegacy: false });
      return;
    }
    // 先按原图显示，转换是异步的（要读图片尺寸）
    setState({ url, isLegacy: false });
    void (async () => {
      const img = await loadSkinImage(url);
      if (cancelled || img === null) return;
      if (!isLegacySkinSize(img.naturalWidth, img.naturalHeight)) return;
      const converted = convertLegacySkinToModern(img);
      if (cancelled || converted === null) return;
      setState({ url: converted, isLegacy: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

/**
 * Skin 面板（启动器风格选择器 + 内置编辑器）：
 * - 选择器：左侧大 3D 预览 + Drag to rotate + 编辑皮肤入口；
 *   右侧「已保存皮肤 / 默认皮肤」卡片网格；底部演示账号横幅
 * - 编辑器：沿用原有颜色表单 / 2D 贴图 / 预设 / 导出能力
 */
export function SkinPreviewPanel() {
  const {
    spec: storeSpec,
    setSpec: storeSetSpec,
    files,
  } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec, files: s.files }), shallow);

  // 无项目 spec 时用本地演示数据兜底，保证选择器直接可见可玩
  const [demoSpec, setDemoSpec] = useState<SkinSpec>(DEMO_SKIN);
  const spec = (storeSpec as unknown as SkinSpec | null) ?? demoSpec;
  const setSpec = useCallback(
    (v: SkinSpec) => {
      if (storeSpec) storeSetSpec(v as unknown as Parameters<typeof storeSetSpec>[0]);
      else setDemoSpec(v);
    },
    [storeSpec, storeSetSpec],
  );

  // 3D viewer canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  // 动画/控制状态
  const [animation, setAnimation] = useState<AnimationType>('walking');
  const [autoRotate, setAutoRotate] = useState(true);
  const [paused, setPaused] = useState(false);

  // 3D 预览背景（固定深色，突出角色）
  const bgColor = '#1a1a1a';

  // 选择器 / 编辑器视图切换
  const [view, setView] = useState<'selector' | 'editor'>('selector');
  const [selectedId, setSelectedId] = useState<string>('Steve');
  const [savedOpen, setSavedOpen] = useState(true);
  const [defaultOpen, setDefaultOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [savedSkins, setSavedSkins] = useState<SavedSkin[]>(() => loadSavedSkins());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // v1.3 本地皮肤广场：搜索 / 收藏 / URL 导入
  const FAVORITES_KEY = 'mc-creator-skin-favorites';
  const [galleryQuery, setGalleryQuery] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      const arr = JSON.parse(raw ?? '[]') as unknown;
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const [galleryUrl, setGalleryUrl] = useState('');
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  const toggleFavorite = useCallback(
    (id: string) => {
      setFavorites((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        try {
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [FAVORITES_KEY],
  );

  const addSavedDataUrl = useCallback((dataUrl: string, name: string) => {
    const item: SavedSkin = {
      id: `saved-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name,
      model: 'classic',
      dataUrl,
      createdAt: Date.now(),
    };
    setSavedSkins((prev) => {
      const next = [item, ...prev].slice(0, 20);
      try {
        localStorage.setItem(SAVED_SKINS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setSelectedId(item.id);
  }, []);

  const importFromUrl = useCallback(async () => {
    const url = galleryUrl.trim();
    if (!url) return;
    setGalleryError(null);
    setGalleryBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.includes('png') && !/\.png(\?|$)/i.test(url)) {
        throw new Error('仅支持 PNG 皮肤文件');
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(blob);
      });
      const img = await loadSkinImage(dataUrl);
      const normalized = img ? normalizeSkinPng(img) : null;
      if (!normalized) throw new Error('非 64x64 / 64x32 皮肤，已拒绝');
      const name =
        url
          .split('/')
          .pop()
          ?.split('?')[0]
          ?.replace(/\.png$/i, '') || 'url-skin';
      addSavedDataUrl(normalized, name.slice(0, 32));
      setGalleryUrl('');
    } catch (e) {
      setGalleryError(
        e instanceof Error ? e.message : '导入失败（可能是跨域限制，请改用本地 PNG 导入）',
      );
    } finally {
      setGalleryBusy(false);
    }
  }, [galleryUrl, addSavedDataUrl]);

  // ===== 新增：部位可见性控制 =====
  const [visibleParts, setVisibleParts] = useState<Set<BodyPartId>>(
    new Set([
      'head',
      'headOverlay',
      'body',
      'bodyOverlay',
      'rightArm',
      'rightArmOverlay',
      'leftArm',
      'leftArmOverlay',
      'rightLeg',
      'rightLegOverlay',
      'leftLeg',
      'leftLegOverlay',
    ]),
  );
  const togglePartVisibility = useCallback((partId: BodyPartId) => {
    setVisibleParts((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) {
        next.delete(partId);
      } else {
        next.add(partId);
      }
      return next;
    });
  }, []);

  // 3D 直绘：绘制/旋转模式切换 + 2D 编辑器引用（落笔走 2D 同一套工具/镜像）
  const [paintMode, setPaintMode] = useState(false);
  const pixelEditorRef = useRef<SkinPixelEditorHandle | null>(null);

  // v1.3：编辑器页签（皮肤/披风）+ 披风纹理 + 导出状态
  const [editorTab, setEditorTab] = useState<'skin' | 'cape'>('skin');
  const [capeTextureUrl, setCapeTextureUrl] = useState<string | null>(null);
  const capeEditorRef = useRef<CapeEditorHandle | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);

  // 从 files 找皮肤 PNG（路径是 ${playerName}.png）
  // 注意：useMemo/useCallback 必须在 early return 之前调用，否则 hooks 数量会随 spec 变化
  const skinUrl = useMemo(() => {
    if (!spec) return null;
    const skinSpec = spec as unknown as SkinSpec;
    const file = files.find((f) => f.path === `${skinSpec.playerName}.png`);
    if (!file) return null;
    return `data:image/png;base64,${file.content}`;
  }, [files, spec]);

  // 九款官方皮肤的纹理 URL：Steve / Alex 用游戏原文件，其余程序化绘制
  const skinTextures = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of DEFAULT_SKINS) {
      if (d.file) {
        const u = officialSkinUrl(d.file);
        if (u) {
          m.set(d.name, u);
          continue;
        }
      }
      try {
        m.set(
          d.name,
          paintSkinTexture(d.colors, d.model, {
            hairStyle: d.hairStyle,
            eyeColor: d.eyeColor,
            beard: d.beard,
            mouth: d.mouth,
            top: d.top,
            trimColor: d.trimColor,
            cuffColor: d.cuffColor,
            metalArm: d.metalArm,
          }),
        );
      } catch {
        /* 忽略单款失败 */
      }
    }
    return m;
  }, []);

  // 当前配色的即时纹理（编辑器演示模式回退用）
  const liveTextureUrl = useMemo(() => {
    if (!spec) return null;
    const s = spec as unknown as SkinSpec;
    const active = DEFAULT_SKINS.find((d) => d.name === selectedId);
    try {
      return paintSkinTexture(
        {
          skinColor: s.skinColor,
          hairColor: s.hairColor,
          shirtColor: s.shirtColor,
          pantsColor: s.pantsColor,
          shoesColor: s.shoesColor,
        },
        s.model,
        {
          hairStyle: active?.hairStyle ?? 'short',
          eyeColor: active?.eyeColor ?? '#4a4ad8',
          beard: active ? active.beard : selectedId === 'Steve',
          top: active?.top ?? 'tee',
          trimColor: active?.trimColor,
          cuffColor: active?.cuffColor,
          metalArm: active?.metalArm,
        },
      );
    } catch {
      return null;
    }
  }, [spec, selectedId]);

  // 当前配色与某款官方预设完全一致时，编辑器直接载入官方原图
  // （而非程序化重绘），保证所见即官方文件本身
  const matchedOfficial = useMemo(() => {
    const s = spec as unknown as SkinSpec;
    const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    return (
      DEFAULT_SKINS.find(
        (d) =>
          d.file &&
          d.model === s.model &&
          eq(d.colors.skinColor, s.skinColor) &&
          eq(d.colors.hairColor, s.hairColor) &&
          eq(d.colors.shirtColor, s.shirtColor) &&
          eq(d.colors.pantsColor, s.pantsColor) &&
          eq(d.colors.shoesColor, s.shoesColor),
      ) ?? null
    );
  }, [spec]);
  const officialUrl = matchedOfficial ? (skinTextures.get(matchedOfficial.name) ?? null) : null;

  // 编辑器 3D 预览纹理：已选上传皮肤优先（别人做的 PNG 也能改），
  // 其次官方原图（配色与预设一致时），否则跟随当前配色即时绘制，最后回退项目文件 PNG
  const rawEditorSkinUrl =
    savedSkins.find((x) => x.id === selectedId)?.dataUrl ??
    officialUrl ??
    liveTextureUrl ??
    skinUrl;
  const editorSkin = useModernSkinUrl(rawEditorSkinUrl);
  const editorSkinUrl = editorSkin.url;

  // 像素编辑器纹理（落笔即同步 3D）；spec/所选变化时失效回退到 editorSkinUrl
  const [pixelTextureUrl, setPixelTextureUrl] = useState<string | null>(null);
  // v2.0 版本恢复：用 nonce 强制编辑器重挂载，并以历史纹理为初始值
  const [historyNonce, setHistoryNonce] = useState(0);
  const [historyRestoreUrl, setHistoryRestoreUrl] = useState<string | null>(null);
  // v2.0 披风版本恢复（与皮肤相互隔离）
  const [capeHistoryNonce, setCapeHistoryNonce] = useState(0);
  const [capeHistoryRestoreUrl, setCapeHistoryRestoreUrl] = useState<string | null>(null);
  const pixelKey = useMemo(
    () =>
      [
        spec.playerName,
        spec.model,
        spec.skinColor,
        spec.hairColor,
        spec.shirtColor,
        spec.pantsColor,
        spec.shoesColor,
        selectedId,
      ].join('|'),
    [spec, selectedId],
  );
  useEffect(() => {
    setPixelTextureUrl(null);
    setHistoryRestoreUrl(null);
    setCapeHistoryRestoreUrl(null);
  }, [pixelKey]);

  // 像素编辑保存：写回项目文件（base64 PNG）
  const savePixelSkin = useCallback(
    async (dataUrl: string) => {
      const b64 = dataUrl.includes(',') ? (dataUrl.split(',')[1] ?? '') : dataUrl;
      if (!b64) return;
      const path = `${spec.playerName}.png`;
      const st = useModStore.getState();
      if (!st.files.some((f) => f.path === path)) {
        st.setFiles([...st.files, { path, content: b64 }]);
      }
      try {
        await st.forceWriteFile(path, b64);
      } catch (e) {
        console.error('[Skin] save pixel texture failed:', e);
      }
    },
    [spec.playerName],
  );

  // v1.3：披风保存：写回项目文件（cape-<playerName>.png）
  const saveCape = useCallback(
    async (dataUrl: string) => {
      const b64 = dataUrl.includes(',') ? (dataUrl.split(',')[1] ?? '') : dataUrl;
      if (!b64) return;
      const path = `cape-${spec.playerName}.png`;
      const st = useModStore.getState();
      if (!st.files.some((f) => f.path === path)) {
        st.setFiles([...st.files, { path, content: b64 }]);
      }
      try {
        await st.forceWriteFile(path, b64);
      } catch (e) {
        console.error('[Cape] save cape texture failed:', e);
      }
    },
    [spec.playerName],
  );

  // v1.3：统一导出（皮肤 PNG / 披风 PNG / 资源包 / GLTF）
  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, []);

  const handleExport = useCallback(
    async (kind: 'skin-png' | 'cape-png' | 'resourcepack' | 'gltf') => {
      try {
        setExportBusy(kind);
        const skinUrl = pixelTextureUrl ?? editorSkinUrl;
        if (!skinUrl && kind !== 'cape-png') return;
        if (kind === 'skin-png' && skinUrl) {
          const blob = await ExportEngine.exportPng(skinUrl);
          downloadBlob(blob, `${spec.playerName}-skin.png`);
        } else if (kind === 'cape-png' && capeTextureUrl) {
          const blob = await ExportEngine.exportPng(capeTextureUrl);
          downloadBlob(blob, `cape-${spec.playerName}.png`);
        } else if (kind === 'resourcepack' && skinUrl) {
          const blob = (await ExportEngine.export(
            'resourcepack',
            skinUrl,
            capeTextureUrl
              ? {
                  capeDataUrl: capeTextureUrl,
                  meta: {
                    packFormat: 15,
                    description: `MC Creator Skin Pack - ${spec.playerName}`,
                  },
                }
              : {
                  meta: {
                    packFormat: 15,
                    description: `MC Creator Skin Pack - ${spec.playerName}`,
                  },
                },
          )) as Blob;
          downloadBlob(blob, `${spec.playerName}-resourcepack.zip`);
        } else if (kind === 'gltf' && skinUrl) {
          const dataUrl = (await ExportEngine.export(
            'gltf',
            skinUrl,
            capeTextureUrl ? { capeDataUrl: capeTextureUrl } : {},
          )) as string;
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `${spec.playerName}-skin.gltf`;
          a.click();
        }
      } catch (e) {
        console.error('[Export] failed:', e);
      } finally {
        setExportBusy(null);
      }
    },
    [pixelTextureUrl, editorSkinUrl, capeTextureUrl, spec.playerName, downloadBlob],
  );

  // 选择器大预览：已保存皮肤用上传原图，否则用所选官方纹理（Steve 兜底）
  const selectedSaved = savedSkins.find((x) => x.id === selectedId) ?? null;
  const bigPreview = useModernSkinUrl(
    selectedSaved?.dataUrl ?? skinTextures.get(selectedId) ?? skinTextures.get('Steve') ?? null,
  );
  const bigPreviewUrl = bigPreview.url;
  const bigPreviewModel = bigPreview.isLegacy
    ? // legacy 只有 Steve 模型（见 core/skin/png.ts），用 slim 的 UV 画它会错位
      'classic'
    : (DEFAULT_SKINS.find((d) => d.name === selectedId)?.model ?? spec.model);

  // v1.3 广场过滤：名称搜索 + 仅看收藏
  const galleryQ = galleryQuery.trim().toLowerCase();
  const filteredSaved = savedSkins.filter((s) => {
    if (showFavoritesOnly && !favorites.includes(s.id)) return false;
    if (!galleryQ) return true;
    return s.name.toLowerCase().includes(galleryQ) || s.id.toLowerCase().includes(galleryQ);
  });
  const filteredDefaults = DEFAULT_SKINS.filter((d) => {
    if (showFavoritesOnly && !favorites.includes(d.name)) return false;
    if (!galleryQ) return true;
    return d.name.toLowerCase().includes(galleryQ);
  });

  const persistSaved = useCallback((list: SavedSkin[]) => {
    setSavedSkins(list);
    try {
      localStorage.setItem(SAVED_SKINS_KEY, JSON.stringify(list.slice(0, 20)));
    } catch {
      /* 配额不足时静默跳过 */
    }
  }, []);

  const applyPreset = useCallback(
    (preset: DefaultSkin) => {
      if (!spec) return;
      const skinSpec = spec as unknown as SkinSpec;
      const updated = { ...skinSpec, ...preset.colors, model: preset.model };
      setSpec(updated as unknown as typeof spec);
      setSelectedId(preset.name);
    },
    [spec, setSpec],
  );

  const selectSaved = useCallback((s: SavedSkin) => {
    setSelectedId(s.id);
  }, []);

  const addSavedFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList).filter(
      (f) => f.type === 'image/png' || /\.png$/i.test(f.name),
    );
    if (arr.length === 0) return;
    arr.slice(0, 5).forEach((f) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const raw = String(reader.result ?? '');
        if (!raw.startsWith('data:image')) return;
        const img = await loadSkinImage(raw);
        const dataUrl = img ? normalizeSkinPng(img) : null;
        // 非 64x64 / 64x32 直接拒绝，避免贴图错位
        if (!dataUrl) return;
        const item: SavedSkin = {
          id: `saved-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          name: f.name.replace(/\.png$/i, ''),
          model: 'classic',
          dataUrl,
          createdAt: Date.now(),
        };
        setSavedSkins((prev) => {
          const next = [item, ...prev].slice(0, 20);
          try {
            localStorage.setItem(SAVED_SKINS_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
        setSelectedId(item.id);
      };
      reader.readAsDataURL(f);
    });
  }, []);

  const removeSaved = useCallback(
    (id: string) => {
      const next = savedSkins.filter((s) => s.id !== id);
      persistSaved(next);
      if (selectedId === id) {
        setSelectedId('Steve');
      }
    },
    [savedSkins, selectedId, persistSaved],
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

  const skin = spec;

  const updateField = <K extends keyof SkinSpec>(key: K, value: SkinSpec[K]) => {
    const updated = { ...skin, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  // ===== 选择器视图（启动器风格） =====
  if (view === 'selector') {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Body：左大预览 + 右皮肤库 */}
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* 左：大 3D 预览 */}
          <div
            className="flex flex-1 flex-col items-center justify-center gap-2 p-4"
            style={{ backgroundColor: bgColor }}
          >
            {bigPreviewUrl ? (
              <PanelErrorBoundary label="3D 预览">
                <SkinViewer3D
                  canvasRef={canvasRef}
                  viewerRef={viewerRef}
                  skinUrl={bigPreviewUrl}
                  model={bigPreviewModel}
                  animation={animation}
                  autoRotate={autoRotate}
                  paused={paused}
                />
              </PanelErrorBoundary>
            ) : (
              <div className="flex h-64 w-48 items-center justify-center rounded-mc border border-dashed border-mc-border text-xs text-mc-mute">
                暂无皮肤预览
              </div>
            )}
            {/* 动画控制条 */}
            <div className="flex flex-wrap items-center justify-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2/80 px-2 py-1">
              {ANIMATIONS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAnimation(a.id)}
                  className={
                    'rounded-mc px-2 py-0.5 text-[10px] font-medium transition-colors ' +
                    (animation === a.id
                      ? 'bg-mc-accent/30 text-mc-accent'
                      : 'text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text')
                  }
                >
                  {a.label}
                </button>
              ))}
              <span className="mx-1 h-3 w-px bg-mc-border" />
              <button
                onClick={() => setAutoRotate(!autoRotate)}
                className={
                  'flex items-center gap-0.5 rounded-mc px-1.5 py-0.5 text-[10px] transition-colors ' +
                  (autoRotate
                    ? 'bg-mc-accent/20 text-mc-accent'
                    : 'text-mc-dim hover:bg-mc-surface-3')
                }
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
            <div className="text-[10px] text-mc-mute">拖拽旋转 · 滚轮缩放</div>
            <button
              onClick={() => setView('editor')}
              className="flex items-center gap-1 rounded-mc border border-mc-accent bg-mc-accent/20 px-3 py-1.5 text-xs font-medium text-mc-accent hover:bg-mc-accent/30"
            >
              <Pencil className="h-3.5 w-3.5" /> 编辑皮肤
            </button>
          </div>

          {/* 右：皮肤库（导入 + 已保存 + 默认） */}
          <div
            className="flex w-full flex-col gap-3 overflow-y-auto border-t border-mc-border p-3 md:w-[380px] md:border-l md:border-t-0"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) addSavedFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,image/png"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addSavedFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className={
                'flex items-center justify-center gap-1 rounded-mc border border-dashed px-2 py-2 text-xs transition-colors ' +
                (dragOver
                  ? 'border-mc-accent bg-mc-accent/10 text-mc-accent'
                  : 'border-mc-border text-mc-dim hover:border-mc-accent hover:text-mc-text')
              }
            >
              <Plus className="h-3.5 w-3.5" /> 导入 PNG（可拖拽到此处）
            </button>

            {/* v1.3 本地皮肤广场：搜索 + 收藏过滤 + URL 导入 */}
            <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={galleryQuery}
                  onChange={(e) => setGalleryQuery(e.target.value)}
                  placeholder="搜索皮肤名称…"
                  className="min-w-0 flex-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1 text-[11px] text-mc-text placeholder:text-mc-mute"
                />
                <button
                  onClick={() => setShowFavoritesOnly((v) => !v)}
                  title="仅看收藏"
                  className={`rounded-mc border px-2 py-1 text-[11px] transition-colors ${
                    showFavoritesOnly
                      ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                      : 'border-mc-border bg-mc-surface-3 text-mc-dim hover:text-mc-text'
                  }`}
                >
                  ★ 收藏
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="url"
                  value={galleryUrl}
                  onChange={(e) => setGalleryUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void importFromUrl();
                  }}
                  placeholder="粘贴皮肤 PNG 直链后回车导入…"
                  className="min-w-0 flex-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1 text-[11px] text-mc-text placeholder:text-mc-mute"
                />
                <button
                  onClick={() => void importFromUrl()}
                  disabled={galleryBusy || !galleryUrl.trim()}
                  className="rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {galleryBusy ? '导入中…' : '导入'}
                </button>
              </div>
              {galleryError && <div className="mt-1 text-[11px] text-red-400">{galleryError}</div>}
            </div>

            {/* 已保存皮肤 */}
            <div>
              <button
                onClick={() => setSavedOpen((v) => !v)}
                className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-mc-dim"
              >
                <ChevronDown
                  className={'h-3 w-3 transition-transform ' + (savedOpen ? '' : '-rotate-90')}
                />
                已保存皮肤 ({filteredSaved.length}/{savedSkins.length})
              </button>
              {savedOpen &&
                (filteredSaved.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1">
                    {filteredSaved.map((s) => (
                      <div
                        key={s.id}
                        className={
                          'relative flex flex-col items-center gap-1 rounded-mc border px-1 py-1.5 ' +
                          (selectedId === s.id
                            ? 'border-mc-accent bg-mc-surface-3'
                            : 'border-mc-border bg-mc-surface-2')
                        }
                      >
                        <button
                          onClick={() => selectSaved(s)}
                          title={s.name}
                          className="flex flex-col items-center gap-1"
                        >
                          <TextureThumb url={s.dataUrl} model={s.model} />
                          <span className="max-w-full truncate text-[10px] text-mc-dim">
                            {s.name}
                          </span>
                        </button>
                        {selectedId === s.id && (
                          <Check className="absolute left-1 top-1 h-3 w-3 text-mc-accent" />
                        )}
                        <button
                          onClick={() => toggleFavorite(s.id)}
                          className={`absolute bottom-1 left-1 text-[12px] leading-none ${favorites.includes(s.id) ? 'text-mc-accent' : 'text-mc-mute hover:text-mc-accent'}`}
                          title={favorites.includes(s.id) ? '取消收藏' : '收藏'}
                        >
                          {favorites.includes(s.id) ? '★' : '☆'}
                        </button>
                        <button
                          onClick={() => removeSaved(s.id)}
                          className="absolute right-1 top-1 text-mc-mute hover:text-red-400"
                          title="删除"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-mc-mute">
                    {savedSkins.length === 0
                      ? '暂无已保存皮肤，可导入 PNG'
                      : '没有匹配的皮肤，换个关键词或关闭收藏过滤试试'}
                  </div>
                ))}
            </div>

            {/* 默认皮肤 */}
            <div>
              <button
                onClick={() => setDefaultOpen((v) => !v)}
                className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-mc-dim"
              >
                <ChevronDown
                  className={'h-3 w-3 transition-transform ' + (defaultOpen ? '' : '-rotate-90')}
                />
                默认皮肤 ({filteredDefaults.length}/{DEFAULT_SKINS.length})
              </button>
              {defaultOpen &&
                (filteredDefaults.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1">
                    {filteredDefaults.map((d) => {
                      const thumbUrl = skinTextures.get(d.name);
                      const fav = favorites.includes(d.name);
                      return (
                        <div
                          key={d.name}
                          className={
                            'relative flex flex-col items-center gap-1 rounded-mc border px-1 py-1.5 hover:border-mc-accent ' +
                            (selectedId === d.name
                              ? 'border-mc-accent bg-mc-surface-3'
                              : 'border-mc-border bg-mc-surface-2')
                          }
                        >
                          <button
                            onClick={() => applyPreset(d)}
                            className="flex flex-col items-center gap-1"
                            title={'应用 ' + d.name}
                          >
                            {thumbUrl ? (
                              <TextureThumb url={thumbUrl} model={d.model} />
                            ) : (
                              <span className="text-[10px] text-mc-mute">无缩略图</span>
                            )}
                            <span className="text-[10px] text-mc-dim">{d.name}</span>
                          </button>
                          {selectedId === d.name && (
                            <Check className="absolute left-1 top-1 h-3 w-3 text-mc-accent" />
                          )}
                          <button
                            onClick={() => toggleFavorite(d.name)}
                            className={`absolute bottom-1 left-1 text-[12px] leading-none ${fav ? 'text-mc-accent' : 'text-mc-mute hover:text-mc-accent'}`}
                            title={fav ? '取消收藏' : '收藏'}
                          >
                            {fav ? '★' : '☆'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-mc-mute">没有匹配的默认皮肤</div>
                ))}
            </div>
          </div>
        </div>

        {/* 底部演示账号横幅 */}
        <div className="flex items-center gap-2 border-t border-mc-border px-4 py-2 text-[11px] text-mc-mute">
          <User className="h-3 w-3" />
          <span>
            {spec.playerName} ·{' '}
            {spec.model === 'slim' ? 'Alex 模型 (3px 臂)' : 'Steve 模型 (4px 臂)'}
          </span>
          <span className="ml-auto">点击「编辑皮肤」进入像素 / 3D 编辑器</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-1.5">
        <button
          onClick={() => setView('selector')}
          className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text hover:border-mc-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回选择
        </button>
        <span className="text-[11px] text-mc-mute">正在编辑：{skin.playerName}</span>
      </div>
      {/* Body：左右分栏 */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* 左：3D 编辑器 */}
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-4"
          style={{ backgroundColor: bgColor }}
        >
          {editorSkinUrl ? (
            <div>
              {/* 绘制/旋转切换（工具/颜色/镜像复用右侧 2D 编辑器） */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-mc border border-mc-border bg-mc-surface-2/80 px-2 py-1.5 w-full max-w-[400px]">
                <button
                  onClick={() => setPaintMode((v) => !v)}
                  className={
                    'flex items-center gap-1 rounded-mc px-2 py-1 text-[11px] transition-colors ' +
                    (paintMode
                      ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                      : 'border-mc-border bg-mc-surface-2 text-mc-dim hover:text-mc-text')
                  }
                  title={paintMode ? '切换到旋转模式' : '切换到绘制模式'}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>{paintMode ? '绘制中' : '绘制'}</span>
                </button>
                <span className="text-[10px] text-mc-mute">
                  {paintMode ? '左键落笔 / 右键旋转 / 滚轮缩放' : '左键旋转 / 滚轮缩放'}
                </span>
              </div>

              {/* 3D 预览（官方 skinview3d 渲染，直绘拾取落笔到 2D，v1.3 支持披风） */}
              <PanelErrorBoundary label="3D 编辑预览">
                <SkinViewer3D
                  canvasRef={canvasRef}
                  viewerRef={viewerRef}
                  skinUrl={pixelTextureUrl ?? editorSkinUrl}
                  model={skin.model}
                  animation={animation}
                  autoRotate={autoRotate}
                  paused={paused}
                  paintMode={paintMode}
                  pixelEditorRef={pixelEditorRef}
                  capeEditorRef={capeEditorRef}
                  visibleParts={visibleParts}
                  capeUrl={capeTextureUrl}
                />
              </PanelErrorBoundary>
            </div>
          ) : (
            <div>
              {/* 动画控制条 */}
              <div className="flex flex-wrap items-center justify-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2/80 px-2 py-1">
                {ANIMATIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAnimation(a.id)}
                    className={
                      'rounded-mc px-2 py-0.5 text-[10px] font-medium transition-colors ' +
                      (animation === a.id
                        ? 'bg-mc-accent/30 text-mc-accent'
                        : 'text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text')
                    }
                  >
                    {a.label}
                  </button>
                ))}
                <span className="mx-1 h-3 w-px bg-mc-border" />
                <button
                  onClick={() => setAutoRotate(!autoRotate)}
                  className={
                    'flex items-center gap-0.5 rounded-mc px-1.5 py-0.5 text-[10px] transition-colors ' +
                    (autoRotate
                      ? 'bg-mc-accent/20 text-mc-accent'
                      : 'text-mc-dim hover:bg-mc-surface-3')
                  }
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
          )}
        </div>

        {/* 右：像素编辑器 + 披风 + 预设（内容超出视口时整列滚动，避免编辑器被压到 0 高） */}
        <div className="flex min-h-0 w-full flex-col overflow-y-auto border-t border-mc-border p-3 md:w-[560px] md:border-l md:border-t-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEditorTab('skin')}
                className={`rounded-mc px-2 py-1 text-xs font-bold uppercase tracking-wider ${
                  editorTab === 'skin'
                    ? 'bg-mc-accent/20 text-mc-accent'
                    : 'text-mc-dim hover:text-mc-text'
                }`}
              >
                像素编辑器 (64x64)
              </button>
              <button
                onClick={() => setEditorTab('cape')}
                className={`rounded-mc px-2 py-1 text-xs font-bold uppercase tracking-wider ${
                  editorTab === 'cape'
                    ? 'bg-mc-accent/20 text-mc-accent'
                    : 'text-mc-dim hover:text-mc-text'
                }`}
              >
                披风 (64x32)
              </button>
            </div>
            <div className="text-[10px] text-mc-mute">落笔即同步 3D</div>
          </div>
          {/* 编辑器区：shrink-0 不参与压缩，列滚动承载超长内容 */}
          <div className="shrink-0">
            {editorTab === 'skin' ? (
              <PanelErrorBoundary label="皮肤像素编辑器">
                <SkinPixelEditor
                  ref={pixelEditorRef}
                  key={`${pixelKey}|${historyNonce}`}
                  initialUrl={historyRestoreUrl ?? pixelTextureUrl ?? editorSkinUrl}
                  onChange={setPixelTextureUrl}
                  onSave={savePixelSkin}
                />
              </PanelErrorBoundary>
            ) : (
              <PanelErrorBoundary label="披风编辑器">
                <CapeEditor
                  ref={capeEditorRef}
                  key={`cape-${pixelKey}|${capeHistoryNonce}`}
                  initialUrl={capeHistoryRestoreUrl ?? capeTextureUrl}
                  onChange={setCapeTextureUrl}
                  onSave={saveCape}
                />
              </PanelErrorBoundary>
            )}
          </div>

          {/* 部位可见性控制 */}
          <BodyPartVisibilityPanel
            visibleParts={visibleParts}
            onToggle={togglePartVisibility}
            model={skin.model}
          />

          {/* 预设皮肤 */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-mc-dim">
              <Sparkles className="h-3 w-3" /> 预设皮肤
            </div>
            <div className="grid grid-cols-3 gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() =>
                    applyPreset(
                      DEFAULT_SKINS.find((d) => d.name === p.name) ?? {
                        name: p.name,
                        model: skin.model,
                        colors: p.colors,
                        hairStyle: 'short',
                        eyeColor: '#4a4ad8',
                        beard: false,
                        top: 'tee',
                      },
                    )
                  }
                  className={
                    'flex flex-col items-center gap-1 rounded-mc border px-1 py-1.5 hover:border-mc-accent ' +
                    (matchedOfficial?.name === p.name
                      ? 'border-mc-accent bg-mc-surface-3'
                      : 'border-mc-border bg-mc-surface-2')
                  }
                  title={'应用 ' + p.name + ' 预设'}
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

          {/* v1.3 导出套件 */}
          <div className="mt-3">
            <ExportPanel
              skinUrl={pixelTextureUrl ?? editorSkinUrl}
              capeUrl={capeTextureUrl}
              playerName={skin.playerName}
              getViewerCanvas={() => canvasRef.current}
            />
          </div>

          {/* v2.0 版本历史 */}
          <div className="mt-3">
            <SkinHistoryPanel
              playerName={skin.playerName}
              getCurrentDataUrl={() => pixelTextureUrl ?? editorSkinUrl ?? null}
              onRestore={(url) => {
                setHistoryRestoreUrl(url);
                setPixelTextureUrl(url);
                setHistoryNonce((n) => n + 1);
              }}
            />
          </div>

          {/* v2.0 披风版本历史（存储与皮肤隔离） */}
          <div className="mt-3">
            <SkinHistoryPanel
              playerName={skin.playerName}
              scope="cape"
              title="披风版本历史"
              getCurrentDataUrl={() => capeTextureUrl ?? null}
              onRestore={(url) => {
                setCapeHistoryRestoreUrl(url);
                setCapeTextureUrl(url);
                setCapeHistoryNonce((n) => n + 1);
              }}
            />
          </div>

          {/* v2.0 协作（BroadcastChannel 同机多窗口） */}
          <div className="mt-3">
            <CollabPanel
              docId={skin.playerName}
              playerName={skin.playerName}
              getSnapshot={() => ({
                skinDataUrl: pixelTextureUrl ?? editorSkinUrl ?? null,
                capeDataUrl: capeTextureUrl,
              })}
              onRemoteSnapshot={(snap) => {
                if (snap.skinDataUrl) {
                  setHistoryRestoreUrl(snap.skinDataUrl);
                  setPixelTextureUrl(snap.skinDataUrl);
                  setHistoryNonce((n) => n + 1);
                }
                if (snap.capeDataUrl) {
                  setCapeHistoryRestoreUrl(snap.capeDataUrl);
                  setCapeTextureUrl(snap.capeDataUrl);
                  setCapeHistoryNonce((n) => n + 1);
                }
              }}
            />
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
            disabled={!editorSkinUrl}
            className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title={editorSkinUrl ? '导出 3D 预览截图为 PNG' : '需要先有皮肤 PNG'}
          >
            <Camera className="h-3 w-3" /> 导出 3D 截图
          </button>
          <span className="mx-1 h-4 w-px bg-mc-border" />
          <button
            onClick={() => void handleExport('skin-png')}
            disabled={!pixelTextureUrl && !editorSkinUrl}
            className="rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title="导出皮肤 PNG（64x64，含表层合成）"
          >
            {exportBusy === 'skin-png' ? '导出中…' : '皮肤 PNG'}
          </button>
          <button
            onClick={() => void handleExport('cape-png')}
            disabled={!capeTextureUrl}
            className="rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title={capeTextureUrl ? '导出披风 PNG（64x32）' : '先在披风页签绘制披风'}
          >
            {exportBusy === 'cape-png' ? '导出中…' : '披风 PNG'}
          </button>
          <button
            onClick={() => void handleExport('resourcepack')}
            disabled={!pixelTextureUrl && !editorSkinUrl}
            className="rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title="一键生成资源包（含 steve/alex 皮肤 + 披风 + pack.mcmeta）"
          >
            {exportBusy === 'resourcepack' ? '打包中…' : '资源包 ZIP'}
          </button>
          <button
            onClick={() => void handleExport('gltf')}
            disabled={!pixelTextureUrl && !editorSkinUrl}
            className="rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title="导出 GLTF 模型（含皮肤纹理内嵌）"
          >
            {exportBusy === 'gltf' ? '导出中…' : 'GLTF 模型'}
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
              { value: 'classic', label: 'Classic (Steve, 4px 臂)' },
              { value: 'slim', label: 'Slim (Alex, 3px 臂)' },
            ]}
            onChange={(v) => updateField('model', v as 'classic' | 'slim')}
          />
        </FieldGroup>

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
  );
}

// ===== 3D 子组件（官方 skinview3d 渲染 + 直绘拾取）=====

type SkinPartName = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
const SKIN_PARTS: SkinPartName[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

interface SkinViewer3DProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  viewerRef: React.MutableRefObject<SkinViewer | null>;
  skinUrl: string;
  model: SkinSpec['model'];
  animation: AnimationType;
  autoRotate: boolean;
  paused: boolean;
  /** 绘制模式：左键在模型上落笔（左键旋转禁用，右键仍可旋转） */
  paintMode?: boolean;
  /** 2D 像素编辑器的绘制接口（工具/颜色/镜像复用 2D 状态） */
  pixelEditorRef?: { current: SkinPixelEditorHandle | null };
  /** v1.3 披风编辑器的绘制接口（披风 3D 直绘复用披风 2D 状态） */
  capeEditorRef?: { current: CapeEditorHandle | null };
  /** 部位可见性：直接驱动官方模型的 inner/outer 图层显隐 */
  visibleParts?: Set<BodyPartId>;
  /** v1.3 披风纹理（null 则隐藏披风） */
  capeUrl?: string | null;
}

function SkinViewer3D({
  canvasRef,
  viewerRef,
  skinUrl,
  model,
  animation,
  autoRotate,
  paused,
  paintMode,
  pixelEditorRef,
  capeEditorRef,
  visibleParts,
  capeUrl,
}: SkinViewer3DProps) {
  const draggingRef = useRef(false);
  const capeDraggingRef = useRef(false);

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

  // 动画切换（绘制模式下冻结姿态，方便落笔；退出恢复所选动画）
  useEffect(() => {
    if (!viewerRef.current) return;
    if (paintMode) {
      viewerRef.current.animation = null;
      return;
    }
    const animDef = ANIMATIONS.find((a) => a.id === animation);
    if (animDef) {
      viewerRef.current.animation = animDef.factory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation, paintMode]);

  // 自动旋转切换（绘制模式下暂停自转）
  useEffect(() => {
    if (!viewerRef.current) return;
    viewerRef.current.autoRotate = paintMode ? false : autoRotate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRotate, paintMode]);

  // 暂停/继续动画
  useEffect(() => {
    if (!viewerRef.current?.animation) return;
    viewerRef.current.animation.paused = paused;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // 绘制模式：左键禁用旋转（右键仍旋转，滚轮缩放不受影响）；退出恢复默认
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (paintMode) {
      viewer.controls.mouseButtons.LEFT = null;
      viewer.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    } else {
      viewer.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      viewer.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
      viewer.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    }
  }, [paintMode]);

  // 部位可见性：直接驱动官方模型的 inner（底层）/outer（表层）显隐
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !visibleParts) return;
    const skin = viewer.playerObject.skin;
    const parts = {
      head: skin.head,
      body: skin.body,
      rightArm: skin.rightArm,
      leftArm: skin.leftArm,
      rightLeg: skin.rightLeg,
      leftLeg: skin.leftLeg,
    };
    (Object.keys(parts) as SkinPartName[]).forEach((name) => {
      const part = parts[name];
      part.innerLayer.visible = visibleParts.has(name);
      part.outerLayer.visible = visibleParts.has(`${name}Overlay` as BodyPartId);
    });
  }, [visibleParts, skinUrl, model]);

  // v1.3 披风：有纹理则加载，无则隐藏
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (capeUrl) {
      void Promise.resolve(viewer.loadCape(capeUrl)).catch(() => {
        /* 披风加载失败时静默忽略 */
      });
    } else {
      viewer.resetCape();
    }
  }, [capeUrl]);

  // 射线拾取：返回纹理像素坐标 + 命中的图层 + 部位键（flipY 默认 true，故 y 翻转）
  // v1.3：披风网格命中时返回 isCape，坐标按 64x32 映射
  const pick = (clientX: number, clientY: number) => {
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;
    if (!viewer || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, viewer.camera);
    // 披风优先：披风在身体背面，命中时直接走披风编辑器
    if (capeUrl) {
      try {
        const capeMesh = viewer.playerObject.cape.cape;
        if (capeMesh.visible !== false) {
          const capeHits = raycaster.intersectObject(capeMesh, false);
          for (const hit of capeHits) {
            if (!hit.uv) continue;
            const x = Math.max(0, Math.min(63, Math.floor(hit.uv.x * 64)));
            const y = Math.max(0, Math.min(31, 31 - Math.floor(hit.uv.y * 32)));
            return { x, y, overlay: false, partKey: 'cape', isCape: true as const };
          }
        }
      } catch {
        /* 披风拾取失败时回退皮肤拾取 */
      }
    }
    const skin = viewer.playerObject.skin;
    const targets: THREE.Object3D[] = [];
    const tags: Array<{ overlay: boolean; partKey: string }> = [];
    for (const name of SKIN_PARTS) {
      const part = skin[name];
      if (!visibleParts || visibleParts.has(name)) {
        targets.push(part.innerLayer);
        tags.push({ overlay: false, partKey: `${name}:b` });
      }
      if (!visibleParts || visibleParts.has(`${name}Overlay` as BodyPartId)) {
        targets.push(part.outerLayer);
        tags.push({ overlay: true, partKey: `${name}:o` });
      }
    }
    if (targets.length === 0) return null;
    const hits = raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      const tag = tags[targets.indexOf(hit.object)];
      if (!tag || !hit.uv) continue;
      const x = Math.max(0, Math.min(63, Math.floor(hit.uv.x * 64)));
      const y = Math.max(0, Math.min(63, 63 - Math.floor(hit.uv.y * 64)));
      return { x, y, overlay: tag.overlay, partKey: tag.partKey, isCape: false as const };
    }
    return null;
  };

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={320}
      className="rounded-mc border border-mc-border"
      style={paintMode ? { cursor: 'crosshair', touchAction: 'none' } : undefined}
      onPointerDown={(e) => {
        if (!paintMode || e.button !== 0) return;
        const hit = pick(e.clientX, e.clientY);
        if (!hit) return;
        e.preventDefault();
        if (hit.isCape) {
          capeDraggingRef.current = true;
          capeEditorRef?.current?.paintStart(hit.x, hit.y);
        } else {
          draggingRef.current = true;
          pixelEditorRef?.current?.paintStart(hit.x, hit.y, hit.overlay, hit.partKey);
        }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!paintMode) return;
        if (capeDraggingRef.current) {
          const hit = pick(e.clientX, e.clientY);
          if (!hit || !hit.isCape) return;
          capeEditorRef?.current?.paintMove(hit.x, hit.y);
          return;
        }
        if (!draggingRef.current) return;
        const hit = pick(e.clientX, e.clientY);
        if (!hit || hit.isCape) return;
        pixelEditorRef?.current?.paintMove(hit.x, hit.y, hit.overlay, hit.partKey);
      }}
      onPointerUp={() => {
        if (!paintMode) return;
        if (capeDraggingRef.current) {
          capeDraggingRef.current = false;
          capeEditorRef?.current?.paintEnd();
          return;
        }
        if (!draggingRef.current) return;
        draggingRef.current = false;
        pixelEditorRef?.current?.paintEnd();
      }}
      onPointerLeave={() => {
        if (!paintMode) return;
        if (capeDraggingRef.current) {
          capeDraggingRef.current = false;
          capeEditorRef?.current?.paintEnd();
          return;
        }
        if (!draggingRef.current) return;
        draggingRef.current = false;
        pixelEditorRef?.current?.paintEnd();
      }}
      onPointerCancel={() => {
        if (!paintMode) return;
        if (capeDraggingRef.current) {
          capeDraggingRef.current = false;
          capeEditorRef?.current?.paintEnd();
          return;
        }
        if (!draggingRef.current) return;
        draggingRef.current = false;
        pixelEditorRef?.current?.paintEnd();
      }}
      onContextMenu={(e) => {
        if (paintMode) e.preventDefault();
      }}
    />
  );
}

// ===== 选择器缩略图：2D 正面合成（与 3D 所见一致） =====

function TextureThumb({ url, model }: { url: string; model: SkinSpec['model'] }) {
  const thumbRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas || !url) return;
    const img = new Image();
    img.onload = () => drawTextureThumb(canvas, img, model);
    img.src = url;
  }, [url, model]);
  return <canvas ref={thumbRef} className="h-8 w-auto" style={{ imageRendering: 'pixelated' }} />;
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
