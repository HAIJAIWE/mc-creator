import type { FileNode, GeneratorContext, GenerationResult, Loader, McVersion } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import { TextureSpec } from '@mc-creator/shared';
import type { TextureSpec as TextureSpecType, TextureEntry } from '@mc-creator/shared';
import {
  createBuffer,
  encodePng,
  fillSolid,
  fillGradient,
  fillCheckerboard,
  hexToRgb,
} from '../../utils/png-encoder.js';

/**
 * 材质包生成器（P9）。
 * 生成 pack.mcmeta、语言文件和材质 PNG（base64 编码到 FileNode.content）。
 * 材质包是 JSON+资源驱动，不需要编译。
 */
export class TextureGenerator implements Generator {
  readonly type = 'texture';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = ['1.21.1', '1.21.11'];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    // 运行时校验：确保 ctx.spec 是合法 TextureSpec
    const spec = TextureSpec.parse(ctx.spec as unknown as TextureSpecType);

    const files: FileNode[] = [];
    files.push(this.generatePackMcmeta(spec));
    files.push(this.generateLangFile(spec, 'zh_cn'));
    files.push(this.generateLangFile(spec, 'en_us'));

    for (const entry of spec.textures) {
      files.push(this.generateTexturePng(spec.modId, entry));
    }

    return {
      files,
      warnings: ['PNG 文件已 base64 编码，写入磁盘时需 decode'],
      buildCmd: 'echo 材质包无需编译',
    };
  }

  /** pack.mcmeta */
  private generatePackMcmeta(spec: TextureSpecType): FileNode {
    return {
      path: 'pack.mcmeta',
      content: JSON.stringify({
        pack: {
          pack_format: spec.packFormat,
          description: spec.packDescription || spec.packName,
        },
      }, null, 2),
    };
  }

  /** 语言文件（空占位） */
  private generateLangFile(spec: TextureSpecType, lang: string): FileNode {
    return {
      path: `assets/${spec.modId}/lang/${lang}.json`,
      content: '{}',
    };
  }

  /** 单个材质 PNG（base64） */
  private generateTexturePng(modId: string, entry: TextureEntry): FileNode {
    const buf = createBuffer(entry.width, entry.height);
    const [r, g, b] = hexToRgb(entry.color);

    if (entry.checkerboard) {
      // 浅一档色：每通道 +40，封顶 255
      const lr = Math.min(255, r + 40);
      const lg = Math.min(255, g + 40);
      const lb = Math.min(255, b + 40);
      fillCheckerboard(buf, r, g, b, lr, lg, lb, 1);
    } else if (entry.gradientTo) {
      const [r2, g2, b2] = hexToRgb(entry.gradientTo);
      fillGradient(buf, r, g, b, r2, g2, b2);
    } else {
      fillSolid(buf, r, g, b);
    }

    const png = encodePng(buf);
    return {
      path: `assets/${modId}/textures/${entry.type}/${entry.id}.png`,
      content: png.toString('base64'),
    };
  }
}
