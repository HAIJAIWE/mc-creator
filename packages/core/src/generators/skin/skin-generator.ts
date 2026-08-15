import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import type { Generator } from '../types.js';
import { SkinSpec, MC_VERSIONS } from '@mc-creator/shared';
import type { SkinSpec as SkinSpecType } from '@mc-creator/shared';
import {
  createBuffer,
  encodePng,
  toBase64,
  setPixel,
  hexToRgb,
  fillSolid,
  type PixelBuffer,
} from '../../utils/png-encoder.js';

/**
 * 皮肤生成器（P9）。
 * 生成 64x64 Minecraft 皮肤 PNG（base64 编码到 FileNode.content）。
 * 皮肤是资源文件，不需要编译。
 */
export class SkinGenerator implements Generator {
  readonly type = 'skin';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    // 运行时校验：确保 ctx.spec 是合法 SkinSpec
    const spec = SkinSpec.parse(ctx.spec as unknown as SkinSpecType);

    const files: FileNode[] = [];
    const skinPng = this.generateSkinPng(spec);
    files.push({
      path: `${spec.playerName}.png`,
      content: toBase64(skinPng),
    });

    if (spec.generatePreview) {
      const previewPng = this.generatePreviewPng(spec);
      files.push({
        path: 'preview.png',
        content: toBase64(previewPng),
      });
    }

    return {
      files,
      warnings: ['PNG 文件已 base64 编码，写入磁盘时需 decode'],
      buildCmd: 'echo 皮肤无需编译',
    };
  }

  /** 生成 64x64 皮肤 PNG */
  private generateSkinPng(spec: SkinSpecType): Uint8Array {
    const buf = createBuffer(64, 64);
    const [sr, sg, sb] = hexToRgb(spec.skinColor);
    const [hr, hg, hb] = hexToRgb(spec.hairColor);
    const [shr, shg, shb] = hexToRgb(spec.shirtColor);
    const [pr, pg, pb] = hexToRgb(spec.pantsColor);
    const [or, og, ob] = hexToRgb(spec.shoesColor);

    // 经典/slim 手臂宽度差异
    const armWidth = spec.model === 'slim' ? 3 : 4;

    // 头部（8x8）位于 (8,8)
    this.fillRect(buf, 8, 8, 8, 8, sr, sg, sb);
    // 头发：头部顶部一行
    this.fillRect(buf, 8, 8, 8, 1, hr, hg, hb);

    // 身体（8x12）位于 (20,20)
    this.fillRect(buf, 20, 20, 8, 12, shr, shg, shb);

    // 右臂（armWidth x 12）位于 (44,20)，末端用 skinColor（手）
    this.fillRect(buf, 44, 20, armWidth, 12, shr, shg, shb);
    this.fillRect(buf, 44, 20 + 12 - 1, armWidth, 1, sr, sg, sb); // 手（底部一行）

    // 左臂镜像位于 (36,52)
    this.fillRect(buf, 36, 52, armWidth, 12, shr, shg, shb);
    this.fillRect(buf, 36, 52 + 12 - 1, armWidth, 1, sr, sg, sb);

    // 右腿（4x12）位于 (4,20)，脚部用 shoesColor
    this.fillRect(buf, 4, 20, 4, 12, pr, pg, pb);
    this.fillRect(buf, 4, 20 + 12 - 2, 4, 2, or, og, ob); // 鞋（底部两行）

    // 左腿镜像位于 (20,52)
    this.fillRect(buf, 20, 52, 4, 12, pr, pg, pb);
    this.fillRect(buf, 20, 52 + 12 - 2, 4, 2, or, og, ob);

    return encodePng(buf);
  }

  /** 生成预览图（64x64，用纯色简化展示各部位） */
  private generatePreviewPng(spec: SkinSpecType): Uint8Array {
    const buf = createBuffer(64, 64);
    const [shr, shg, shb] = hexToRgb(spec.shirtColor);
    fillSolid(buf, shr, shg, shb);
    return encodePng(buf);
  }

  /** 矩形填充 */
  private fillRect(
    buf: PixelBuffer,
    x0: number,
    y0: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
  ): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        setPixel(buf, x, y, r, g, b, 255);
      }
    }
  }
}
