import { vi } from 'vitest';

/**
 * jsdom 没有 canvas 2D 上下文：这里装一个「记录型」桩，让测试能断言
 * 「画布到底画没画」，而不是只断言内部 state。
 *
 * 用法：
 *   const stub = installCanvasStub();
 *   ...
 *   stub.recorded.find((r) => r.canvas === view)?.ctx.__calls.fillRect
 *   stub.imageConstructions()   // new Image() 的次数
 *   stub.restore();
 */
export interface CanvasCtxCalls {
  [method: string]: unknown[][];
}

export interface CanvasCtxStub {
  __calls: CanvasCtxCalls;
  [key: string]: unknown;
}

export interface RecordedCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasCtxStub;
}

export interface CanvasStub {
  /** 按获取上下文的顺序记录每次 getContext('2d') */
  recorded: RecordedCanvas[];
  /** 该桩安装期间 new Image() 的次数（用来抓「重复载入初始纹理」） */
  imageConstructions: () => number;
  restore: () => void;
}

export interface CanvasStubOptions {
  /** FakeImage 的 naturalWidth，默认 64 */
  naturalWidth?: number;
  /** FakeImage 的 naturalHeight，默认 64 */
  naturalHeight?: number;
  /** toDataURL 的返回值 */
  dataUrl?: string;
}

interface StubGlobals {
  Image?: typeof Image;
  getContext: typeof HTMLCanvasElement.prototype.getContext;
  toDataURL: typeof HTMLCanvasElement.prototype.toDataURL;
}

function makeCtx(canvas: HTMLCanvasElement): CanvasCtxStub {
  const calls: CanvasCtxCalls = {};
  const target: Record<string, unknown> = {
    canvas,
    filter: 'none',
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    __calls: calls,
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      // 没显式实现的方法都记一次调用：测试只需要知道「画了没有」
      const fn = (...args: unknown[]) => {
        (calls[prop] ??= []).push(args);
        return undefined;
      };
      t[prop] = fn;
      return fn;
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  }) as CanvasCtxStub;
}

/** 安装记录型 canvas 桩；务必在 afterEach 调用 restore() */
export function installCanvasStub(options: CanvasStubOptions = {}): CanvasStub {
  const { naturalWidth = 64, naturalHeight = 64, dataUrl = 'data:image/png;base64,AAAA' } = options;
  const imgWidth = naturalWidth;
  const imgHeight = naturalHeight;

  let imageConstructions = 0;
  const recorded: RecordedCanvas[] = [];
  const ctxByCanvas = new WeakMap<HTMLCanvasElement, CanvasCtxStub>();

  const saved: StubGlobals = {
    Image: globalThis.Image,
    getContext: HTMLCanvasElement.prototype.getContext,
    toDataURL: HTMLCanvasElement.prototype.toDataURL,
  };

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = imgWidth;
    naturalHeight = imgHeight;
    width = imgWidth;
    height = imgHeight;
    constructor() {
      imageConstructions += 1;
    }
    set src(_value: string) {
      // 模拟真实图片的异步 onload
      queueMicrotask(() => this.onload?.());
    }
  }

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ): CanvasRenderingContext2D | null {
    if (type !== '2d') return null;
    let ctx = ctxByCanvas.get(this);
    if (!ctx) {
      ctx = makeCtx(this);
      ctxByCanvas.set(this, ctx);
      recorded.push({ canvas: this, ctx });
    }
    return ctx as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.toDataURL = () => dataUrl;
  vi.stubGlobal('Image', FakeImage);

  return {
    recorded,
    imageConstructions: () => imageConstructions,
    restore() {
      HTMLCanvasElement.prototype.getContext = saved.getContext;
      HTMLCanvasElement.prototype.toDataURL = saved.toDataURL;
      if (saved.Image) vi.stubGlobal('Image', saved.Image);
      else vi.unstubAllGlobals();
    },
  };
}
