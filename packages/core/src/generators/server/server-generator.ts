import type { FileNode, GeneratorContext, GenerationResult, Loader, McVersion } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import { ServerSpec } from '@mc-creator/shared';
import type { ServerSpec as ServerSpecType, OpEntry, WhitelistEntry } from '@mc-creator/shared';

/**
 * 服务器配置生成器（P8）。
 * 生成 server.properties、eula.txt、启动脚本、ops.json、whitelist.json、
 * mods/modlist.txt、README.txt 等服务器运行所需文件。
 */
export class ServerGenerator implements Generator {
  readonly type = 'server';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = ['1.21.1', '1.21.11'];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    // 运行时校验：确保 ctx.spec 是合法 ServerSpec
    const spec = ServerSpec.parse(ctx.spec as unknown as ServerSpecType);

    const files: FileNode[] = [];
    files.push(this.generateServerProperties(spec));
    files.push(this.generateEula(spec));
    files.push(this.generateStartBat(spec));
    files.push(this.generateStartSh(spec));
    files.push(this.generateOpsJson(spec));
    files.push(this.generateWhitelistJson(spec));
    files.push(this.generateModlist(spec));
    files.push(this.generateReadme(spec));

    return {
      files,
      warnings: [],
      buildCmd: 'java -jar server.jar',
    };
  }

  /** server.properties：标准 Java properties 格式 */
  private generateServerProperties(spec: ServerSpecType): FileNode {
    const lines: string[] = [];

    const props: Record<string, string> = {
      'server-name': spec.serverName,
      'motd': spec.motd,
      'max-players': String(spec.maxPlayers),
      'server-port': String(spec.port),
      'gamemode': spec.gamemode,
      'difficulty': spec.difficulty,
      'level-name': spec.levelName,
      'pvp': String(spec.pvp),
      'online-mode': String(spec.onlineMode),
      'white-list': String(spec.whitelist),
      'enforce-whitelist': String(spec.enforceWhitelist),
      'view-distance': String(spec.viewDistance),
      'simulation-distance': String(spec.simulationDistance),
      'allow-flight': String(spec.allowFlight),
      'allow-nether': String(spec.allowNether),
      'allow-end': String(spec.allowEnd),
      'spawn-animals': String(spec.spawnAnimals),
      'spawn-npcs': String(spec.spawnNpcs),
      'spawn-monsters': String(spec.spawnMonsters),
      'generate-structures': String(spec.generateStructures),
    };

    if (spec.levelSeed !== undefined) {
      props['level-seed'] = spec.levelSeed;
    }

    // 合并额外属性
    for (const [k, v] of Object.entries(spec.extraProperties ?? {})) {
      props[k] = typeof v === 'boolean' ? String(v) : String(v);
    }

    for (const [k, v] of Object.entries(props)) {
      lines.push(`${k}=${v}`);
    }

    return {
      path: 'server.properties',
      content: lines.join('\n') + '\n',
    };
  }

  /** eula.txt */
  private generateEula(spec: ServerSpecType): FileNode {
    return {
      path: 'eula.txt',
      content: `eula=${spec.eula}\n`,
    };
  }

  /** start.bat：Windows 启动脚本 */
  private generateStartBat(spec: ServerSpecType): FileNode {
    return {
      path: 'start.bat',
      content: `@echo off\njava -Xmx${spec.maxMemory} -Xms${spec.startMemory} -jar server.jar nogui\npause\n`,
    };
  }

  /** start.sh：Unix 启动脚本 */
  private generateStartSh(spec: ServerSpecType): FileNode {
    return {
      path: 'start.sh',
      content: `#!/bin/sh\njava -Xmx${spec.maxMemory} -Xms${spec.startMemory} -jar server.jar nogui\n`,
    };
  }

  /** ops.json */
  private generateOpsJson(spec: ServerSpecType): FileNode {
    const ops: OpEntry[] = spec.ops ?? [];
    const arr = ops.map((o) => ({
      name: o.name,
      level: o.level,
      uuid: '',
      xuid: '',
    }));
    return {
      path: 'ops.json',
      content: JSON.stringify(arr, null, 2),
    };
  }

  /** whitelist.json */
  private generateWhitelistJson(spec: ServerSpecType): FileNode {
    const entries: WhitelistEntry[] = spec.whitelistEntries ?? [];
    const arr = entries.map((w) => ({
      name: w.name,
      uuid: w.uuid ?? '',
    }));
    return {
      path: 'whitelist.json',
      content: JSON.stringify(arr, null, 2),
    };
  }

  /** mods/modlist.txt */
  private generateModlist(spec: ServerSpecType): FileNode {
    const mods = spec.mods ?? [];
    const lines = mods.map((m) => `${m.id} ${m.version} ${m.source}`);
    return {
      path: 'mods/modlist.txt',
      content: lines.length > 0 ? lines.join('\n') + '\n' : '',
    };
  }

  /** README.txt */
  private generateReadme(spec: ServerSpecType): FileNode {
    return {
      path: 'README.txt',
      content: `服务器配置说明\n========================\n服务器名: ${spec.serverName}\nMC 版本: ${spec.mcVersion}\n端口: ${spec.port}\n\n请将本目录下所有文件放到服务器目录中，然后运行 start.bat (Windows) 或 start.sh (Unix) 启动服务器。\n注意：首次启动前请确认 eula.txt 中已同意 EULA。\n`,
    };
  }
}
