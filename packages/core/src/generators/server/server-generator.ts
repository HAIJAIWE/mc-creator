import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import type { Generator } from '../types.js';
import { ServerSpec } from '@mc-creator/shared';
import type { ServerSpec as ServerSpecType, OpEntry, WhitelistEntry } from '@mc-creator/shared';

/**
 * 服务器配置生成器（P8）。
 * 生成 server.properties、eula.txt、启动脚本、ops.json、whitelist.json、
 * mods/modlist.txt、README.txt 等服务器运行所需文件。
 */

/**
 * P2 dogfood：Shell 参数安全转义，防止命令注入。
 * 移除危险的 shell 元字符（; | & $ ` " < > \n \r），保留基本路径字符。
 * 注意：括号在引号包裹的参数中无特殊含义，须保留（如 "C:\Program Files (x86)\..."）。
 */
function shellEscape(s: string): string {
  return s.replace(/[;&|`$"<>!\n\r]/g, '');
}
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

    // P17：部署脚本生成
    const deployFiles = this.generateDeployFiles(spec);
    files.push(...deployFiles);

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
      motd: spec.motd,
      'max-players': String(spec.maxPlayers),
      'server-port': String(spec.port),
      gamemode: spec.gamemode,
      difficulty: spec.difficulty,
      'level-name': spec.levelName,
      pvp: String(spec.pvp),
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
      content: `@echo off\n"${shellEscape(spec.javaPath || 'java')}" -Xmx${shellEscape(spec.maxMemory)} -Xms${shellEscape(spec.startMemory)} -jar "${shellEscape(spec.jarName)}" nogui\npause\n`,
    };
  }

  /** start.sh：Unix 启动脚本 */
  private generateStartSh(spec: ServerSpecType): FileNode {
    return {
      path: 'start.sh',
      content: `#!/bin/sh\n"${shellEscape(spec.javaPath || 'java')}" -Xmx${shellEscape(spec.maxMemory)} -Xms${shellEscape(spec.startMemory)} -jar "${shellEscape(spec.jarName)}" nogui\n`,
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

  /** P17：根据 deployTarget 和 backupInterval 生成部署脚本 */
  private generateDeployFiles(spec: ServerSpecType): FileNode[] {
    const files: FileNode[] = [];
    const needSystemd = spec.deployTarget === 'systemd' || spec.deployTarget === 'both';
    const needDocker = spec.deployTarget === 'docker' || spec.deployTarget === 'both';

    if (needSystemd) {
      files.push(this.generateSystemdService(spec));
      files.push(this.generateInstallSystemdSh(spec));
    }
    if (needDocker) {
      files.push(this.generateDockerfile(spec));
      files.push(this.generateDockerCompose(spec));
      files.push(this.generateBuildDockerSh(spec));
    }
    if (spec.backupInterval > 0) {
      files.push(this.generateBackupSh(spec));
      files.push(this.generateBackupCron(spec));
    }
    return files;
  }

  /** deploy/minecraft.service — systemd unit 文件 */
  private generateSystemdService(spec: ServerSpecType): FileNode {
    const restart = spec.restartOnCrash ? 'on-failure' : 'no';
    const content = `[Unit]
Description=Minecraft Server (${shellEscape(spec.serverName)})
After=network.target

[Service]
Type=simple
User=${shellEscape(spec.serviceUser)}
WorkingDirectory=${shellEscape(spec.serviceDir)}
ExecStart="${shellEscape(spec.javaPath || 'java')}" -Xmx${shellEscape(spec.maxMemory)} -Xms${shellEscape(spec.startMemory)} -jar "${shellEscape(spec.jarName)}" nogui
Restart=${restart}
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
    return { path: 'deploy/minecraft.service', content };
  }

  /** deploy/install-systemd.sh — systemd 安装脚本 */
  private generateInstallSystemdSh(spec: ServerSpecType): FileNode {
    const user = shellEscape(spec.serviceUser);
    const dir = shellEscape(spec.serviceDir);
    const content = `#!/bin/bash
set -e
# 创建用户
useradd -r -m -d "${dir}" "${user}" || true
# 创建目录
mkdir -p "${dir}"
# 复制文件
cp -r ./* "${dir}/"
# 设置权限
chown -R "${user}:${user}" "${dir}"
# 安装 service
cp deploy/minecraft.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable minecraft
echo "安装完成。运行: systemctl start minecraft"
`;
    return { path: 'deploy/install-systemd.sh', content };
  }

  /** deploy/Dockerfile */
  private generateDockerfile(spec: ServerSpecType): FileNode {
    const content = `FROM eclipse-temurin:21-jre
WORKDIR /server
COPY . .
EXPOSE ${spec.port}
ENV JAVA_OPTS="-Xmx${shellEscape(spec.maxMemory)} -Xms${shellEscape(spec.startMemory)}"
CMD ["sh", "-c", "java $JAVA_OPTS -jar ${shellEscape(spec.jarName)} nogui"]
`;
    return { path: 'deploy/Dockerfile', content };
  }

  /** deploy/docker-compose.yml */
  private generateDockerCompose(spec: ServerSpecType): FileNode {
    const restart = spec.restartOnCrash ? 'unless-stopped' : 'no';
    const content = `version: '3.8'
services:
  minecraft:
    build: ..
    container_name: ${shellEscape(spec.serverName)}
    ports:
      - "${spec.port}:${spec.port}"
    volumes:
      - ./data:/server
    restart: ${restart}
    mem_limit: ${spec.maxRamPercent}%
    environment:
      - EULA=true
`;
    return { path: 'deploy/docker-compose.yml', content };
  }

  /** deploy/build-docker.sh — Docker 构建启动脚本 */
  private generateBuildDockerSh(spec: ServerSpecType): FileNode {
    const content = `#!/bin/bash
set -e
docker build -t minecraft-${shellEscape(spec.serverName)} -f deploy/Dockerfile .
docker compose -f deploy/docker-compose.yml up -d
echo "Docker 部署完成。查看日志: docker compose -f deploy/docker-compose.yml logs -f"
`;
    return { path: 'deploy/build-docker.sh', content };
  }

  /** deploy/backup.sh — 备份脚本 */
  private generateBackupSh(spec: ServerSpecType): FileNode {
    const src = shellEscape(spec.serviceDir || '.');
    const content = `#!/bin/bash
BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r "${src}"/* "$BACKUP_DIR/"
# 保留最近 7 个备份
ls -dt /backups/* | tail -n +8 | xargs rm -rf
echo "备份完成: $BACKUP_DIR"
`;
    return { path: 'deploy/backup.sh', content };
  }

  /** deploy/backup-cron — cron 定时任务 */
  private generateBackupCron(spec: ServerSpecType): FileNode {
    const content = `0 */${spec.backupInterval} * * * ${shellEscape(spec.serviceUser)} /path/to/deploy/backup.sh >> /var/log/minecraft-backup.log 2>&1
`;
    return { path: 'deploy/backup-cron', content };
  }
}
