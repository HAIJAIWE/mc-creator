import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  Undo2,
  Redo2,
  Download,
  Upload,
  Trash2,
  Plus,
  HelpCircle,
} from 'lucide-react';
import { CAPE_WIDTH, CAPE_HEIGHT, type CapeEditorHandle } from './SkinPixelEditor';
import { useToasts, ToastStack } from './toast';
import { ShortcutsHelp } from './ShortcutsHelp';

const HISTORY_LIMIT = 50;
const ZOOMS = [6, 8, 12] as const;

const DEFAULT_PALETTE = [
  '#ffffff',
  '#c8c8c8',
  '#8a8a8a',
  '#3a3a3a',
  '#141414',
  '#e8b07d',
  '#c89870',
  '#9c6b4a',
  '#5a3a28',
  '#2a1a12',
  '#d97b2e',
  '#e8d878',
  '#7a5aa8',
  '#1a1a1a',
  '#2ba8a0',
  '#4a8aff',
  '#4040c8',
  '#5aa85a',
  '#e84a4a',
  '#d89030',
];

const CUSTOM_PALETTE_KEY = 'mc-creator-cape-custom-palette';

function loadCustomPalette(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTE_KEY);
    const arr = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(arr) ? arr.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

type CapeTool = 'pencil' | 'eraser' | 'fill' | 'picker';
type CapeMirror = 'off' | 'horizontal';

interface CapeEditorProps {
  initialUrl: string | null;
  onChange: (dataUrl: string) => void;
  onSave: (dataUrl: string) => void;
}

/** 简单洪水填充（64x32，支持水平镜像） */
function simpleFloodFill(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
  mirror: CapeMirror,
): void {
  const w = CAPE_WIDTH;
  const h = CAPE_HEIGHT;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const si = (sy * w + sx) * 4;
  const tr = d[si] ?? 0;
  const tg = d[si + 1] ?? 0;
  const tb = d[si + 2] ?? 0;
  const ta = d[si + 3] ?? 0;
  const fr = parseInt(color.slice(1, 3), 16);
  const fg = parseInt(color.slice(3, 5), 16);
  const fb = parseInt(color.slice(5, 7), 16);
  if (tr === fr && tg === fg && tb === fb && ta === 255) return;

  const seeds: Array<[number, number]> = [[sx, sy]];
  if (mirror === 'horizontal') {
    const mx = w - 1 - sx;
    if (mx !== sx) seeds.push([mx, sy]);
  }

  for (const [seedX, seedY] of seeds) {
    const mi = (seedY * w + seedX) * 4;
    const mr = d[mi] ?? 0;
    const mg = d[mi + 1] ?? 0;
    const mb = d[mi + 2] ?? 0;
    const ma = d[mi + 3] ?? 0;
    const stack: Array<[number, number]> = [[seedX, seedY]];
    const seen = new Uint8Array(w * h);
    const match = (x: number, y: number): boolean => {
      const i = (y * w + x) * 4;
      return d[i] === mr && d[i + 1] === mg && d[i + 2] === mb && d[i + 3] === ma;
    };
    while (stack.length > 0) {
      const [x, y] = stack.pop() as [number, number];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (seen[y * w + x] === 1 || !match(x, y)) continue;
      seen[y * w + x] = 1;
      const i = (y * w + x) * 4;
      d[i] = fr;
      d[i + 1] = fg;
      d[i + 2] = fb;
      d[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export const CapeEditor = forwardRef<CapeEditorHandle, CapeEditorProps>(function CapeEditor(
  { initialUrl, onChange, onSave }: CapeEditorProps,
  ref,
) {
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [tool, setTool] = useState<CapeTool>('pencil');
  const [color, setColor] = useState('#2ba8a0');
  const [brushSize, setBrushSize] = useState(1);
  const [mirrorMode, setMirrorMode] = useState<CapeMirror>('off');
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState<number>(8);
  const [ready, setReady] = useState(false);
  const [customColors, setCustomColors] = useState<string[]>(() => loadCustomPalette());
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
  const [touchMid, setTouchMid] = useState<{ x: number; y: number } | null>(null);

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const [showHelp, setShowHelp] = useState(false);

  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const painting3DRef = useRef(false);
  const last3DRef = useRef<{ x: number; y: number } | null>(null);
  const painted3DRef = useRef(false);

  const activeCtx = useCallback((): CanvasRenderingContext2D | null => {
    return offscreenRef.current?.getContext('2d') ?? null;
  }, []);

  const redraw = useCallback(() => {
    const view = viewRef.current;
    const canvas = offscreenRef.current;
    if (!view || !canvas) return;
    const z = view.width / CAPE_WIDTH;
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const cell = Math.max(4, Math.floor(z / 2));
    for (let y = 0; y < view.height; y += cell) {
      for (let x = 0; x < view.width; x += cell) {
        ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? '#2a2a2a' : '#222222';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.drawImage(canvas, 0, 0, view.width, view.height);
    if (showGrid && z >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < CAPE_WIDTH; i++) {
        ctx.moveTo(i * z + 0.5, 0);
        ctx.lineTo(i * z + 0.5, view.height);
      }
      for (let i = 1; i < CAPE_HEIGHT; i++) {
        ctx.moveTo(0, i * z + 0.5);
        ctx.lineTo(view.width, i * z + 0.5);
      }
      ctx.stroke();
    }
  }, [showGrid]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = CAPE_WIDTH;
    canvas.height = CAPE_HEIGHT;
    offscreenRef.current = canvas;
    if (!initialUrl) {
      setReady(true);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setReady(true);
        return;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, CAPE_WIDTH, CAPE_HEIGHT);
      ctx.drawImage(img, 0, 0, CAPE_WIDTH, CAPE_HEIGHT);
      setReady(true);
    };
    img.onerror = () => setReady(true);
    img.src = initialUrl;
  }, [initialUrl]);

  const compositeDataUrl = useCallback((): string => {
    const c = document.createElement('canvas');
    c.width = CAPE_WIDTH;
    c.height = CAPE_HEIGHT;
    const ctx = c.getContext('2d');
    if (!ctx || !offscreenRef.current) return '';
    ctx.drawImage(offscreenRef.current, 0, 0);
    return c.toDataURL('image/png');
  }, []);

  const snapshot = useCallback((): string | null => {
    if (!offscreenRef.current) return null;
    return offscreenRef.current.toDataURL();
  }, []);

  const pushHistory = useCallback(() => {
    const shot = snapshot();
    if (!shot) return;
    setUndoStack((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), shot]);
    setRedoStack([]);
  }, [snapshot]);

  const restoreShot = useCallback(
    (shot: string) => {
      if (!offscreenRef.current) return;
      const ctx = offscreenRef.current.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, CAPE_WIDTH, CAPE_HEIGHT);
        ctx.drawImage(img, 0, 0);
        redraw();
      };
      img.src = shot;
    },
    [redraw],
  );

  const emit = useCallback(() => {
    const url = compositeDataUrl();
    if (url) onChange(url);
  }, [compositeDataUrl, onChange]);

  const rememberColor = useCallback((c: string) => {
    setRecentColors((prev) => [c, ...prev.filter((x) => x !== c)].slice(0, 12));
  }, []);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const shot = prev[prev.length - 1] as string;
      const cur = snapshot();
      if (cur) setRedoStack((r) => [...r.slice(-(HISTORY_LIMIT - 1)), cur]);
      restoreShot(shot);
      return prev.slice(0, -1);
    });
  }, [snapshot, restoreShot]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const shot = prev[prev.length - 1] as string;
      const cur = snapshot();
      if (cur) setUndoStack((u) => [...u.slice(-(HISTORY_LIMIT - 1)), cur]);
      restoreShot(shot);
      return prev.slice(0, -1);
    });
  }, [snapshot, restoreShot]);

  // 带反馈的操作封装
  const handleSave = useCallback(() => {
    const url = compositeDataUrl();
    if (!url) {
      pushToast('没有可保存的披风', 'error');
      return;
    }
    onSave(url);
    pushToast('披风已保存到项目', 'success');
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

  const dab = useCallback(
    (ctx: CanvasRenderingContext2D, x: number, y: number) => {
      const n = brushSize;
      const half = Math.floor(n / 2);
      if (tool === 'eraser') {
        ctx.clearRect(x - half, y - half, n, n);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x - half, y - half, n, n);
      }
      if (mirrorMode === 'horizontal') {
        const mx = CAPE_WIDTH - 1 - x;
        if (mx !== x) {
          if (tool === 'eraser') {
            ctx.clearRect(mx - half, y - half, n, n);
          } else {
            ctx.fillStyle = color;
            ctx.fillRect(mx - half, y - half, n, n);
          }
        }
      }
    },
    [tool, color, brushSize, mirrorMode],
  );

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

  const handleFloodFill = useCallback(
    (ctx: CanvasRenderingContext2D, sx: number, sy: number) => {
      simpleFloodFill(ctx, sx, sy, color, mirrorMode);
    },
    [color, mirrorMode],
  );

  const pickAt = useCallback((x: number, y: number) => {
    const ctx = offscreenRef.current?.getContext('2d');
    if (!ctx || x < 0 || y < 0 || x >= CAPE_WIDTH || y >= CAPE_HEIGHT) return;
    const d = ctx.getImageData(x, y, 1, 1).data;
    if ((d[3] ?? 0) === 0) return;
    const hex = `#${(((d[0] ?? 0) << 16) | ((d[1] ?? 0) << 8) | (d[2] ?? 0)).toString(16).padStart(6, '0')}`;
    setColor(hex);
  }, []);

  const eventPos = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const view = viewRef.current;
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * CAPE_WIDTH);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * CAPE_HEIGHT);
    if (x < 0 || y < 0 || x >= CAPE_WIDTH || y >= CAPE_HEIGHT) return null;
    return { x, y };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) return;
      if (tool === 'picker') {
        const p = eventPos(e);
        if (p) pickAt(p.x, p.y);
        return;
      }
      const p = eventPos(e);
      const ctx = activeCtx();
      if (!p || !ctx) return;
      pushHistory();
      paintingRef.current = true;
      lastRef.current = p;
      if (tool === 'pencil' || tool === 'eraser') {
        dab(ctx, p.x, p.y);
        redraw();
      } else if (tool === 'fill') {
        handleFloodFill(ctx, p.x, p.y);
        redraw();
        paintingRef.current = false;
        rememberColor(color);
        emit();
      }
    },
    [
      tool,
      activeCtx,
      eventPos,
      pushHistory,
      dab,
      handleFloodFill,
      redraw,
      rememberColor,
      emit,
      pickAt,
      color,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent) => {
      const p = eventPos(e);
      if (p) setHoverInfo(p);
      if (!paintingRef.current) return;
      const ctx = activeCtx();
      if (!p || !ctx) return;
      if (tool === 'pencil' || tool === 'eraser') {
        const last = lastRef.current ?? p;
        strokeLine(ctx, last.x, last.y, p.x, p.y);
        lastRef.current = p;
        redraw();
      }
    },
    [eventPos, activeCtx, tool, strokeLine, redraw],
  );

  const handlePointerUp = useCallback(() => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    lastRef.current = null;
    if (tool === 'pencil' || tool === 'eraser') {
      rememberColor(color);
      emit();
    }
  }, [tool, rememberColor, color, emit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (
        (mod && e.key.toLowerCase() === 'y') ||
        (mod && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod) return;
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'p':
          setTool('pencil');
          break;
        case 'e':
          setTool('eraser');
          break;
        case 'f':
          setTool('fill');
          break;
        case 'i':
          setTool('picker');
          break;
        case 'm':
          setMirrorMode((v) => (v === 'off' ? 'horizontal' : 'off'));
          break;
        case 'g':
          setShowGrid((v) => !v);
          break;
        default:
          break;
      }
    },
    [handleUndo, handleRedo],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const next = Math.max(2, Math.min(16, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      setZoom(Math.round(next));
    },
    [zoom],
  );

  // 触摸：双指捏合缩放 + 双指拖拽平移；单指落笔走 Pointer 事件
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const touches = Array.from(e.touches);
      const [t1, t2] = touches;
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      setTouchStartDist(dist);
      setTouchMid({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && touchStartDist !== null) {
        e.preventDefault();
        const touches = Array.from(e.touches);
        const [t1, t2] = touches;
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const scale = dist / (touchStartDist || 1);
        setZoom(Math.round(Math.max(2, Math.min(16, zoom * scale))));
        setTouchStartDist(dist);
        const mid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
        if (touchMid) {
          const dx = mid.x - touchMid.x;
          const dy = mid.y - touchMid.y;
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        }
        setTouchMid(mid);
      }
    },
    [zoom, touchStartDist, touchMid],
  );

  const handleTouchEnd = useCallback(() => {
    setTouchStartDist(null);
    setTouchMid(null);
  }, []);

  const handleDownload = useCallback(() => {
    const url = compositeDataUrl();
    if (!url) {
      pushToast('没有可导出的披风', 'error');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cape.png';
    a.click();
    pushToast('已导出 cape.png', 'success');
  }, [compositeDataUrl, pushToast]);

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
          pushHistory();
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, CAPE_WIDTH, CAPE_HEIGHT);
          ctx.drawImage(img, 0, 0, CAPE_WIDTH, CAPE_HEIGHT);
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

  const handleClear = useCallback(() => {
    const ctx = activeCtx();
    if (!ctx) return;
    pushHistory();
    ctx.clearRect(0, 0, CAPE_WIDTH, CAPE_HEIGHT);
    redraw();
    emit();
    pushToast('已清空披风', 'info');
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

  useImperativeHandle(
    ref,
    () => ({
      loadCape(dataUrl: string) {
        if (!offscreenRef.current) return;
        const ctx = offscreenRef.current.getContext('2d');
        if (!ctx) return;
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, CAPE_WIDTH, CAPE_HEIGHT);
          ctx.drawImage(img, 0, 0, CAPE_WIDTH, CAPE_HEIGHT);
          redraw();
        };
        img.src = dataUrl;
      },
      getCapeDataUrl() {
        return compositeDataUrl();
      },
      clearCape() {
        const ctx = activeCtx();
        if (!ctx) return;
        pushHistory();
        ctx.clearRect(0, 0, CAPE_WIDTH, CAPE_HEIGHT);
        redraw();
        emit();
      },
      paintStart(x: number, y: number) {
        if (tool === 'picker') {
          pickAt(x, y);
          return;
        }
        const ctx = activeCtx();
        if (!ctx || x < 0 || y < 0 || x >= CAPE_WIDTH || y >= CAPE_HEIGHT) return;
        pushHistory();
        painting3DRef.current = true;
        painted3DRef.current = false;
        last3DRef.current = { x, y };
        if (tool === 'pencil' || tool === 'eraser') {
          dab(ctx, x, y);
          painted3DRef.current = true;
          redraw();
        } else if (tool === 'fill') {
          handleFloodFill(ctx, x, y);
          painted3DRef.current = true;
          redraw();
          rememberColor(color);
          emit();
        } else {
          dab(ctx, x, y);
          painted3DRef.current = true;
          redraw();
        }
      },
      paintMove(x: number, y: number) {
        if (!painting3DRef.current) return;
        if (tool !== 'pencil' && tool !== 'eraser') return;
        const ctx = activeCtx();
        if (!ctx || x < 0 || y < 0 || x >= CAPE_WIDTH || y >= CAPE_HEIGHT) return;
        const last = last3DRef.current ?? { x, y };
        strokeLine(ctx, last.x, last.y, x, y);
        last3DRef.current = { x, y };
        painted3DRef.current = true;
        redraw();
      },
      paintEnd() {
        if (!painting3DRef.current && !painted3DRef.current) return;
        painting3DRef.current = false;
        last3DRef.current = null;
        if (painted3DRef.current) {
          painted3DRef.current = false;
          rememberColor(color);
          emit();
        }
      },
    }),
    [
      activeCtx,
      pushHistory,
      redraw,
      emit,
      compositeDataUrl,
      tool,
      pickAt,
      dab,
      handleFloodFill,
      strokeLine,
      rememberColor,
      color,
    ],
  );

  const tools: Array<{ id: CapeTool; label: string; icon: React.ReactNode; key: string }> = [
    { id: 'pencil', label: '画笔', icon: <Pencil className="h-3.5 w-3.5" />, key: 'P' },
    { id: 'eraser', label: '橡皮', icon: <Eraser className="h-3.5 w-3.5" />, key: 'E' },
    { id: 'fill', label: '填充', icon: <PaintBucket className="h-3.5 w-3.5" />, key: 'F' },
    { id: 'picker', label: '取色', icon: <Pipette className="h-3.5 w-3.5" />, key: 'I' },
  ];

  const sizeW = CAPE_WIDTH * zoom;
  const sizeH = CAPE_HEIGHT * zoom;

  return (
    <div
      className="flex h-full flex-col gap-2 overflow-y-auto p-3"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="flex flex-wrap items-center gap-1">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
            className={`flex items-center gap-1 rounded-mc border px-2 py-1 text-[11px] transition-colors ${
              tool === t.id
                ? 'border-mc-accent bg-mc-accent/20 text-mc-text'
                : 'border-mc-border bg-mc-surface-2 text-mc-dim hover:text-mc-text'
            }`}
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
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleRedo}
          disabled={redoStack.length === 0}
          title="重做 (Ctrl+Y)"
          className="rounded-mc border border-mc-border bg-mc-surface-2 p-1.5 text-mc-dim hover:text-mc-text disabled:opacity-40"
        >
          <Redo2 className="h-3.5 w-3.5" />
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

      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => setBrushSize(n)}
            title={`笔刷 ${n}px`}
            className={`rounded-mc border px-1.5 py-1 ${
              brushSize === n
                ? 'border-mc-accent bg-mc-accent/20 text-mc-text'
                : 'border-mc-border bg-mc-surface-2 text-mc-dim'
            }`}
          >
            {n}px
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-mc-border" />
        <button
          onClick={() => setMirrorMode((v) => (v === 'off' ? 'horizontal' : 'off'))}
          title="水平镜像 (M)"
          className={`rounded-mc border px-2 py-1 ${
            mirrorMode !== 'off'
              ? 'border-mc-accent bg-mc-accent/20 text-mc-text'
              : 'border-mc-border bg-mc-surface-2 text-mc-dim'
          }`}
        >
          {mirrorMode === 'off' ? '镜像关' : '水平镜'}
        </button>
        <button
          onClick={() => setShowGrid((v) => !v)}
          title="像素网格 (G)"
          className={`rounded-mc border px-2 py-1 ${
            showGrid
              ? 'border-mc-accent bg-mc-accent/20 text-mc-text'
              : 'border-mc-border bg-mc-surface-2 text-mc-dim'
          }`}
        >
          网格
        </button>
        <span className="mx-1 h-4 w-px bg-mc-border" />
        {ZOOMS.map((z) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            className={`rounded-mc border px-1.5 py-1 ${
              zoom === z
                ? 'border-mc-accent bg-mc-accent/20 text-mc-text'
                : 'border-mc-border bg-mc-surface-2 text-mc-dim'
            }`}
          >
            {z}x
          </button>
        ))}
      </div>

      <div className="flex justify-center overflow-auto rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
        {!ready ? (
          <div className="flex h-40 items-center justify-center text-xs text-mc-mute">
            载入披风…
          </div>
        ) : (
          <canvas
            ref={viewRef}
            width={sizeW}
            height={sizeH}
            style={{
              width: sizeW,
              height: sizeH,
              imageRendering: 'pixelated',
              cursor: 'crosshair',
              touchAction: 'none',
              transform: `translate(${pan.x}px, ${pan.y}px)`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onContextMenu={(e) => e.preventDefault()}
            tabIndex={0}
            role="application"
            aria-label="披风像素画布 64x32"
          />
        )}
      </div>

      <div className="flex items-center gap-4 px-2 py-1.5 text-[11px] text-mc-mute bg-mc-surface-2/60 rounded-mc border-t border-mc-border">
        <span>{hoverInfo ? `X: ${hoverInfo.x} Y: ${hoverInfo.y}` : 'X: - Y: -'}</span>
        <span className="mx-2">|</span>
        <span style={{ color }}>■</span>
        <span>{color}</span>
        <span className="mx-2">|</span>
        <span>镜像: {mirrorMode === 'off' ? '关' : '水平'}</span>
        <span className="mx-2">|</span>
        <span>缩放: {zoom}x</span>
      </div>

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
      <div>
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
            <div className="mb-1 mt-2 text-[10px] uppercase tracking-wider text-mc-mute">
              自定义
            </div>
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleSave} className="mc-btn-primary !px-2.5 !py-1 !text-[11px]">
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
          onClick={handleClear}
          title="清空披风"
          className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-dim hover:text-mc-text"
        >
          <Trash2 className="h-3 w-3" /> 清空
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
        披风尺寸 64x32。快捷键：P 画笔 · E 橡皮 · F 填充 · I 取色 · M 镜像 · G 网格 · Ctrl+Z/Y
        撤销重做 · ? 帮助 · 双指捏合缩放/平移。
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} variant="cape" />
    </div>
  );
});
