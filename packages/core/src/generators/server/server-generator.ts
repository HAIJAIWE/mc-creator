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

    // 一键部署：云服务器 install.sh + 本地 install.bat
    files.push(this.generateInstallSh(spec));
    files.push(this.generateInstallBat(spec));

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

  /**
   * 一键部署脚本（云服务器 Linux，24h 在线）：
   * 1. 安装 Java 21
   * 2. 按 serverType 下载服务端（vanilla/paper/fabric）
   * 3. 放入配置文件
   * 4. systemd 服务开机自启（重启不掉线）
   */
  private generateInstallSh(spec: ServerSpecType): FileNode {
    // 按 serverType 生成下载服务端的 shell 片段
    let downloadCmd: string;
    if (spec.serverType === 'paper') {
      downloadCmd = `echo "下载 Paper 服务端 (${shellEscape(spec.serverVersion)})..."
PAPER_API="https://api.papermc.io/v2/projects/paper/versions/${shellEscape(spec.serverVersion)}/builds"
PAPER_BUILD=$(curl -s "$PAPER_API" | grep -o '"build":[0-9]*' | tail -1 | cut -d: -f2)
curl -o "\${jarName}" "\${PAPER_API}/\${PAPER_BUILD}/downloads/paper-${shellEscape(spec.serverVersion)}-\${PAPER_BUILD}.jar"`;
    } else if (spec.serverType === 'fabric') {
      downloadCmd = `echo "下载 Fabric 服务端 (${shellEscape(spec.serverVersion)})..."
curl -o fabric-installer.jar "https://maven.fabricmc.net/net/fabricmc/fabric-installer/latest/fabric-installer.jar"
java -jar fabric-installer.jar server -mcversion ${shellEscape(spec.serverVersion)} -dir . -loader latest
mv fabric-server-launch.jar "\${jarName}" 2>/dev/null || true`;
    } else {
      downloadCmd = `echo "下载 Vanilla 服务端 (${shellEscape(spec.serverVersion)})..."
MANIFEST=$(curl -s https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)
URL=$(echo "$MANIFEST" | python3 -c "import sys,json; d=json.load(sys.stdin); v=[x for x in d['versions'] if x['id']=='${shellEscape(spec.serverVersion)}'][0]; import urllib.request; print(json.load(urllib.request.urlopen(v['url']))['downloads']['server']['url'])")
curl -o "\${jarName}" "$URL"`;
    }

    const content = `#!/bin/bash
set -e
# ============================================
# MC Creator 一键部署脚本（云服务器，24h 在线）
# 用法: bash install.sh
# ============================================
SERVER_DIR="${shellEscape(spec.serviceDir)}"
SERVER_USER="${shellEscape(spec.serviceUser)}"
jarName="${shellEscape(spec.jarName)}"
MC_VERSION="${shellEscape(spec.serverVersion)}"

echo "=== [1/4] 安装 Java 21 ==="
if ! command -v java &>/dev/null || ! java -version 2>&1 | grep -q "21"; then
  apt-get update -y
  apt-get install -y openjdk-21-jre-headless curl python3 || {
    # Ubuntu 22.04 默认源可能无 21，装 17 兜底（1.21 需要 21，提示手动装）
    apt-get install -y openjdk-17-jre-headless
    echo "警告: 未找到 Java 21，已装 17。1.21+ 服务端需要 Java 21，请手动: apt install openjdk-21-jre-headless"
  }
fi

echo "=== [2/4] 创建目录并下载服务端 ==="
mkdir -p "$SERVER_DIR"
cd "$SERVER_DIR"

if [ ! -f "$jarName" ]; then
${downloadCmd
  .split('\n')
  .map((l) => '  ' + l)
  .join('\n')}
else
  echo "$jarName 已存在，跳过下载"
fi

echo "=== [3/4] 复制配置文件 ==="
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp -f "$SCRIPT_DIR"/server.properties "$SCRIPT_DIR"/eula.txt "$SCRIPT_DIR"/ops.json "$SCRIPT_DIR"/whitelist.json "$SERVER_DIR"/ 2>/dev/null || true
cp -f "$SCRIPT_DIR"/mods/modlist.txt "$SERVER_DIR"/mods/ 2>/dev/null || true

echo "=== [4/4] 安装 systemd 服务（开机自启） ==="
cat > /etc/systemd/system/minecraft.service << 'EOF'
[Unit]
Description=Minecraft Server
After=network.target

[Service]
Type=simple
User=${shellEscape(spec.serviceUser)}
WorkingDirectory=${shellEscape(spec.serviceDir)}
ExecStart=${shellEscape(spec.javaPath || 'java')} -Xmx${shellEscape(spec.maxMemory)} -Xms${shellEscape(spec.startMemory)} -jar "${shellEscape(spec.jarName)}" nogui
Restart=${spec.restartOnCrash ? 'on-failure' : 'no'}
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable minecraft
systemctl restart minecraft

echo ""
echo "=============================================="
echo "部署完成！服务器已启动并设为开机自启（24h 在线）"
echo "查看状态: systemctl status minecraft"
echo "查看日志: journalctl -u minecraft -f"
echo "玩家连接: 你的公网IP:${spec.port}"
echo "=============================================="
`;
    return { path: 'install.sh', content };
  }

  /**
   * 一键部署脚本（Windows 本地，局域网联机）：
   * 1. 检查 Java
   * 2. 按 serverType 下载服务端
   * 3. 提示运行 start.bat 开服
   */
  private generateInstallBat(spec: ServerSpecType): FileNode {
    let downloadCmd: string;
    if (spec.serverType === 'paper') {
      downloadCmd = `echo 下载 Paper 服务端 (%MC_VERSION%)...
powershell -Command "Invoke-WebRequest -Uri 'https://api.papermc.io/v2/projects/paper/versions/%MC_VERSION%/builds' -OutFile paper_builds.json"
for /f "delims=" %%i in ('powershell -Command "(Get-Content paper_builds.json | ConvertFrom-Json).builds[-1].build"') do set BUILD=%%i
powershell -Command "Invoke-WebRequest -Uri ('https://api.papermc.io/v2/projects/paper/versions/%MC_VERSION%/builds/' + $env:BUILD + '/downloads/paper-%MC_VERSION%-' + $env:BUILD + '.jar') -OutFile %JAR%"
del paper_builds.json`;
    } else if (spec.serverType === 'fabric') {
      downloadCmd = `echo 下载 Fabric 服务端 (%MC_VERSION%)...
powershell -Command "Invoke-WebRequest -Uri 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/latest/fabric-installer.jar' -OutFile fabric-installer.jar"
java -jar fabric-installer.jar server -mcversion %MC_VERSION% -dir . -loader latest
echo Fabric 安装完成`;
    } else {
      downloadCmd = `echo 下载 Vanilla 服务端 (%MC_VERSION%)...
powershell -Command "$m=(Invoke-WebRequest 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json' -UseBasicParsing).Content | ConvertFrom-Json; $v=$m.versions | Where-Object { $_.id -eq '%MC_VERSION%' }; $url=(Invoke-WebRequest $v.url -UseBasicParsing).Content | ConvertFrom-Json; Invoke-WebRequest $url.downloads.server.url -OutFile '%JAR%'"`;
    }

    const content = `@echo off
REM ============================================
REM MC Creator 一键部署脚本（Windows 本地，局域网联机）
REM 用法: 双击 install.bat
REM ============================================
setlocal
set JAR=${shellEscape(spec.jarName)}
set MC_VERSION=${shellEscape(spec.serverVersion)}

echo === [1/3] 检查 Java ===
java -version 2>nul || (
  echo 未检测到 Java，请先安装 Java 21:
  echo   https://adoptium.net/temurin/releases/?version=21
  pause
  exit /b 1
)

echo === [2/3] 下载服务端 ===
if exist "%JAR%" (
  echo %JAR% 已存在，跳过下载
) else (
${downloadCmd
  .split('\n')
  .map((l) => '  ' + l)
  .join('\n')}
)

echo === [3/3] 完成 ===
echo.
echo 服务器文件已就绪。现在运行 start.bat 即可开服。
echo 局域网玩家连接: 本机IP:${spec.port}
echo 查看本机IP: ipconfig（找 IPv4 地址）
echo.
pause
`;
    return { path: 'install.bat', content };
  }
}
