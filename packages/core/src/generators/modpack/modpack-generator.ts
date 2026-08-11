import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type { ModpackSpec } from '@mc-creator/shared';

/**
 * 整合包生成器（路线图第 4 阶段）。
 * 生成 Modrinth 或 CurseForge 格式的整合包文件。
 * 整合包是 JSON 驱动，不需要编译。
 */
export class ModpackGenerator implements Generator {
  readonly type = 'modpack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = ctx.spec as unknown as ModpackSpec;
    const files: FileNode[] = [];

    if (spec.format === 'modrinth') {
      files.push(this.generateModrinthIndex(spec));
    } else {
      files.push(this.generateCurseForgeManifest(spec));
      files.push(this.generateModlistHtml(spec));
    }

    // 生成 overrides 目录占位（README 说明）
    files.push({
      path: 'overrides/README.txt',
      content: `此目录存放整合包的配置文件覆盖。\n整合包: ${spec.packName} v${spec.packVersion}\nMC: ${spec.mcVersion} / ${spec.loader} ${spec.loaderVersion}\n`,
    });

    // P10 新增：写入用户声明的 overrides 文件（path 加 overrides/ 前缀）
    for (const ov of spec.overrides ?? []) {
      files.push({
        path: `overrides/${ov.path}`,
        content: ov.content,
      });
    }

    // P10 新增：写入 serverOverrides 文件（path 加 server-overrides/ 前缀）
    for (const ov of spec.serverOverrides ?? []) {
      files.push({
        path: `server-overrides/${ov.path}`,
        content: ov.content,
      });
    }

    return {
      files,
      warnings: spec.mods.length === 0 ? ['警告：整合包未包含任何 mod'] : [],
      buildCmd: '', // 整合包不需要编译
    };
  }

  /** Modrinth 格式：modrinth.index.json */
  private generateModrinthIndex(spec: ModpackSpec): FileNode {
    const index: Record<string, unknown> = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: spec.packVersion,
      name: spec.packName,
      files: spec.mods.map((m) => ({
        path: `mods/${m.fileName}`,
        hashes: m.projectId ? { sha1: m.versionId } : {}, // 简化：用 versionId 作为 hash
        downloads: m.downloadUrl
          ? [m.downloadUrl]
          : [`modrinth://mod/${m.projectId}/${m.versionId}`],
        fileSize: m.fileSize ?? 0,
      })),
      dependencies: {
        minecraft: spec.mcVersion,
        [spec.loader]: spec.loaderVersion,
      },
    };

    // P10 新增：credits / launchMessage（仅在非空时写入，避免污染输出）
    if (spec.credits) {
      index.credits = spec.credits;
    }
    if (spec.launchMessage) {
      index.launchMessage = spec.launchMessage;
    }

    return {
      path: 'modrinth.index.json',
      content: JSON.stringify(index, null, 2),
    };
  }

  /** CurseForge 格式：manifest.json */
  private generateCurseForgeManifest(spec: ModpackSpec): FileNode {
    const manifest: Record<string, unknown> = {
      minecraft: {
        version: spec.mcVersion,
        modLoaders: [
          {
            id: `${spec.loader}-${spec.loaderVersion}`,
            primary: true,
          },
        ],
      },
      manifestType: 'minecraftModpack',
      manifestVersion: 1,
      name: spec.packName,
      version: spec.packVersion,
      author: spec.author,
      files: spec.mods.map((m) => ({
        projectID: Number(m.projectId) || 0,
        fileID: Number(m.versionId) || 0,
        required: true,
      })),
      overrides: 'overrides',
    };

    // P10 新增：credits / launchMessage 写入自定义字段（CurseForge 格式无原生支持）
    if (spec.credits) {
      manifest.credits = spec.credits;
    }
    if (spec.launchMessage) {
      manifest.launchMessage = spec.launchMessage;
    }

    return {
      path: 'manifest.json',
      content: JSON.stringify(manifest, null, 2),
    };
  }

  /** CurseForge 格式：modlist.html */
  private generateModlistHtml(spec: ModpackSpec): FileNode {
    const items = spec.mods.map((m) => `<li>${m.name}</li>`).join('\n');
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${spec.packName} - Mod List</title></head>
<body>
<h1>${spec.packName}</h1>
<ul>
${items}
</ul>
</body>
</html>`;

    return {
      path: 'modlist.html',
      content: html,
    };
  }
}
