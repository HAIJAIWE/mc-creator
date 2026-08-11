import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import type { Generator } from '../types.js';
import {
  ResourcePackSpec,
  MC_VERSIONS,
  getResourcePackFormatForMcVersion,
} from '@mc-creator/shared';
import type {
  ResourcePackSpec as ResourcePackSpecType,
  TextureOverrideEntry,
  ModelEntry,
  FontEntry,
  SoundEntry,
} from '@mc-creator/shared';
import {
  createBuffer,
  encodePng,
  fillSolid,
  fillGradient,
  fillCheckerboard,
  hexToRgb,
} from '../../utils/png-encoder.js';

/**
 * P2 dogfood：路径段消毒，防止路径穿越和特殊字符注入。
 * 复用 datapack-generator 的同一策略。
 */
function sanitizePathSegment(segment: string): string {
  if (!segment) return 'unknown';
  const parts = segment.split('/').filter((p) => p && p !== '..' && p !== '.');
  if (parts.length === 0) return 'unknown';
  const sanitized = parts
    .map((p) => p.toLowerCase().replace(/[^a-z0-9_.-]/g, '_'))
    .filter(Boolean)
    .join('/');
  return sanitized || 'unknown';
}

/**
 * 资源包生成器（P14）。
 * 生成 pack.mcmeta + 贴图覆盖 + 模型覆盖 + 语言文件 + 字体定义 + 音效占位。
 * PNG/OGG 二进制以 base64 编码存入 FileNode.content。
 * 资源包是 JSON+资源驱动，不需要编译。
 */
export class ResourcePackGenerator implements Generator {
  readonly type = 'resource_pack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    // 运行时校验：确保 ctx.spec 是合法 ResourcePackSpec
    const spec = ResourcePackSpec.parse(ctx.spec as unknown as ResourcePackSpecType);

    const files: FileNode[] = [];
    const warnings: string[] = ['PNG/OGG 文件已 base64 编码，写入磁盘时需 decode'];

    // 1. pack.mcmeta（pack_format 按 MC 版本自动映射，资源包格式表与数据包不同）
    const packFormat = getResourcePackFormatForMcVersion(ctx.mcVersion) ?? spec.packFormat;
    if (packFormat !== spec.packFormat) {
      warnings.push(
        `已按 MC 版本 ${ctx.mcVersion} 将 pack_format 从 ${spec.packFormat} 调整为 ${packFormat}（pack.mcmeta 与目标版本匹配）`,
      );
    }
    files.push(this.generatePackMcmeta(spec, packFormat));

    // 2. 贴图覆盖（写入 assets/minecraft/textures/<path>.png）
    const ns = sanitizePathSegment(spec.namespace);
    for (const entry of spec.textureOverrides ?? []) {
      files.push(this.generateTextureOverridePng(entry));
    }

    // 3. 模型覆盖（写入 assets/minecraft/models/<path>.json）
    for (const entry of spec.models ?? []) {
      files.push(this.generateModelJson(entry));
    }

    // 4 & 5. 语言文件
    files.push(this.generateLangFile('en_us', spec.langEnUs ?? {}));
    files.push(this.generateLangFile('zh_cn', spec.langZhCn ?? {}));

    // 6. 字体贴图 PNG（assets/<namespace>/textures/font/<id>.png）
    for (const entry of spec.fonts ?? []) {
      files.push(this.generateFontTexturePng(ns, entry));
    }

    // 7. 字体定义 JSON（assets/<namespace>/font/<namespace>.json）
    if ((spec.fonts ?? []).length > 0) {
      files.push(this.generateFontJson(ns, spec.fonts ?? []));
    }

    // 8. 音效 ogg 文件（assets/<namespace>/sounds/<id>.ogg）
    for (const entry of spec.sounds ?? []) {
      files.push(this.generateSoundOgg(ns, entry));
    }

    // 9. sounds.json（assets/<namespace>/sounds.json）
    if ((spec.sounds ?? []).length > 0) {
      files.push(this.generateSoundsJson(ns, spec.sounds ?? []));
    }

    return {
      files,
      warnings,
      buildCmd: 'echo 资源包无需编译',
    };
  }

  /** pack.mcmeta */
  private generatePackMcmeta(spec: ResourcePackSpecType, packFormat: number): FileNode {
    return {
      path: 'pack.mcmeta',
      content: JSON.stringify(
        {
          pack: {
            pack_format: packFormat,
            description: spec.packDescription || spec.packName,
          },
        },
        null,
        2,
      ),
    };
  }

  /** 贴图覆盖 PNG（assets/minecraft/textures/<path>.png） */
  private generateTextureOverridePng(entry: TextureOverrideEntry): FileNode {
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
      path: `assets/minecraft/textures/${sanitizePathSegment(entry.path)}.png`,
      content: png.toString('base64'),
    };
  }

  /** 模型 JSON（assets/minecraft/models/<path>.json） */
  private generateModelJson(entry: ModelEntry): FileNode {
    let content: string;
    if (entry.json && entry.json.trim().length > 0) {
      // 直接使用自定义 json（解析后重新序列化保证格式合法）
      try {
        content = JSON.stringify(JSON.parse(entry.json), null, 2);
      } catch {
        // 解析失败时原样输出
        content = entry.json;
      }
    } else if (entry.autoCubeAll) {
      // 自动生成 cube_all 模型
      // textureName 优先；为空则取 path basename（最后一段）
      const texName = entry.textureName || entry.path.split('/').pop() || entry.path;
      content = JSON.stringify(
        {
          parent: 'minecraft:block/cube_all',
          textures: {
            all: `minecraft:block/${texName}`,
          },
        },
        null,
        2,
      );
    } else {
      // autoCubeAll=false 且无 json：输出空对象占位
      content = '{}';
    }

    return {
      path: `assets/minecraft/models/${sanitizePathSegment(entry.path)}.json`,
      content,
    };
  }

  /** 语言文件（assets/minecraft/lang/<lang>.json） */
  private generateLangFile(lang: string, dict: Record<string, string>): FileNode {
    return {
      path: `assets/minecraft/lang/${lang}.json`,
      content: JSON.stringify(dict, null, 2),
    };
  }

  /** 字体贴图 PNG（assets/<namespace>/textures/font/<id>.png，纯色 #FFFFFF 填充） */
  private generateFontTexturePng(namespace: string, entry: FontEntry): FileNode {
    const buf = createBuffer(entry.width, entry.height);
    const [r, g, b] = hexToRgb('#FFFFFF');
    fillSolid(buf, r, g, b);
    const png = encodePng(buf);
    return {
      path: `assets/${namespace}/textures/font/${sanitizePathSegment(entry.id)}.png`,
      content: png.toString('base64'),
    };
  }

  /** 字体定义 JSON（assets/<namespace>/font/<namespace>.json） */
  private generateFontJson(namespace: string, fonts: FontEntry[]): FileNode {
    const providers = fonts.map((f) => ({
      type: 'bitmap',
      file: `${namespace}:font/${f.id}.png`,
      height: 8,
      ascent: 7,
      chars: [f.char],
    }));
    return {
      path: `assets/${namespace}/font/${namespace}.json`,
      content: JSON.stringify({ providers }, null, 2),
    };
  }

  /** 音效 ogg 文件（assets/<namespace>/sounds/<id>.ogg） */
  private generateSoundOgg(namespace: string, entry: SoundEntry): FileNode {
    // 如果 data 为空，生成空字符串占位文件；否则 data 已是 base64 编码，直接存入
    return {
      path: `assets/${namespace}/sounds/${sanitizePathSegment(entry.id)}.ogg`,
      content: entry.data || '',
    };
  }

  /** sounds.json（assets/<namespace>/sounds.json） */
  private generateSoundsJson(namespace: string, sounds: SoundEntry[]): FileNode {
    const obj: Record<string, unknown> = {};
    for (const s of sounds) {
      const eventKey = s.event || s.id;
      obj[eventKey] = {
        sounds: [
          {
            name: `${namespace}:${s.id}`,
            volume: s.volume,
            pitch: s.pitch,
            stream: s.stream,
          },
        ],
        replace: false,
      };
    }
    return {
      path: `assets/${namespace}/sounds.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }
}
