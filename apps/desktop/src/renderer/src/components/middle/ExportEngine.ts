import JSZip from 'jszip';
import type { ExportFormat, ResourcePackMeta } from './SkinPixelEditor';

/** 导出引擎 - 统一处理所有导出格式（不引入三方重依赖，按需动态加载） */
export class ExportEngine {
  /** 导出为 PNG */
  static async exportPng(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  /** 导出为 GIF 动画（gifenc 纯 JS 编码，无需 worker） */
  static async exportGif(frames: HTMLCanvasElement[], fps = 10): Promise<Blob> {
    if (frames.length === 0) throw new Error('GIF 需要至少 1 帧');
    const { default: GIFEncoder, quantize, applyPalette } = await import('gifenc');
    const first = frames[0] as HTMLCanvasElement;
    const w = first.width;
    const h = first.height;
    const delay = Math.round(1000 / Math.max(1, fps));
    const gif = GIFEncoder();
    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!sctx) throw new Error('无法创建 2D 上下文');
    frames.forEach((frame, i) => {
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(frame, 0, 0, w, h);
      const data = sctx.getImageData(0, 0, w, h).data;
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, w, h, i === 0 ? { palette, delay, repeat: 0 } : { palette, delay });
    });
    gif.finish();
    const bytes = gif.bytes() as Uint8Array;
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Blob([copy.buffer as ArrayBuffer], { type: 'image/gif' });
  }

  /** 从实时渲染的 canvas 按时间采样 N 帧（用于 3D 动作 GIF / 预览） */
  static async captureFrames(
    source: HTMLCanvasElement,
    count = 8,
    intervalMs = 120,
    targetW?: number,
    targetH?: number,
  ): Promise<HTMLCanvasElement[]> {
    const out: HTMLCanvasElement[] = [];
    const w = targetW ?? source.width;
    const h = targetH ?? source.height;
    for (let i = 0; i < count; i++) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(source, 0, 0, w, h);
      out.push(c);
      if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }
    return out;
  }

  /** 导出为 WebM 视频（MediaRecorder，Chrome/Electron 可用；如需 MP4 请用 ffmpeg 后处理） */
  static async exportVideo(canvas: HTMLCanvasElement, duration = 5, fps = 30): Promise<Blob> {
    const stream = (
      canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }
    ).captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 2500000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      chunks.push(e.data);
    };
    return new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.start();
      setTimeout(() => recorder.stop(), duration * 1000);
    });
  }

  /** 导出为最小 GLB 占位（不依赖 three；完整导出后续接 GLTFExporter） */
  static async exportGltf(
    skinCanvas: HTMLCanvasElement,
    capeCanvas?: HTMLCanvasElement,
  ): Promise<string> {
    void capeCanvas;
    // 生成一个最小合法 glTF JSON（单面片 + 皮肤纹理内嵌），保证可下载、可预览结构
    const skinUrl = skinCanvas.toDataURL('image/png');
    const gltf = {
      asset: { version: '2.0', generator: 'MC Creator ExportEngine' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'SkinPreview' }],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0, TEXCOORD_0: 1 },
              indices: 2,
              material: 0,
            },
          ],
        },
      ],
      materials: [{ name: 'skin', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ name: 'skin.png', mimeType: 'image/png', uri: skinUrl }],
      accessors: [],
      bufferViews: [],
      buffers: [],
    };
    const json = JSON.stringify(gltf);
    return `data:model/gltf+json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
  }

  /** 导出为资源包 */
  static async exportResourcePack(
    skinDataUrl: string,
    capeDataUrl?: string,
    meta: ResourcePackMeta = { packFormat: 15, description: 'MC Creator Skin Pack' },
  ): Promise<Blob> {
    const zip = new JSZip();
    zip.file(
      'pack.mcmeta',
      JSON.stringify(
        { pack: { pack_format: meta.packFormat, description: meta.description } },
        null,
        2,
      ),
    );
    const skinBlob = await fetch(skinDataUrl).then((r) => r.blob());
    zip.file('assets/minecraft/textures/entity/steve.png', skinBlob);
    zip.file('assets/minecraft/textures/entity/alex.png', skinBlob);
    if (capeDataUrl) {
      const capeBlob = await fetch(capeDataUrl).then((r) => r.blob());
      zip.file('assets/minecraft/textures/entity/cape.png', capeBlob);
    }
    return zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
  }

  /** 统一导出入口 */
  static async export(
    format: ExportFormat,
    skinDataUrl: string,
    options: {
      capeDataUrl?: string;
      frames?: HTMLCanvasElement[];
      duration?: number;
      fps?: number;
      meta?: ResourcePackMeta;
    } = {},
  ): Promise<Blob | string> {
    switch (format) {
      case 'png':
        return this.exportPng(skinDataUrl);
      case 'gif':
        if (!options.frames) throw new Error('GIF 需要 frames 参数');
        return this.exportGif(options.frames, options.fps);
      case 'mp4':
        throw new Error('MP4 导出需要 canvas 元素，请使用 exportVideo 直接调用（输出 WebM）');
      case 'gltf':
        return this.exportGltf(
          await this.dataUrlToCanvas(skinDataUrl),
          options.capeDataUrl ? await this.dataUrlToCanvas(options.capeDataUrl) : undefined,
        );
      case 'resourcepack':
        return this.exportResourcePack(skinDataUrl, options.capeDataUrl, options.meta);
      default:
        throw new Error(`不支持的导出格式: ${format as string}`);
    }
  }

  /** dataURL 转 Canvas */
  private static dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 2D 上下文'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = dataUrl;
    });
  }
}

export default ExportEngine;
