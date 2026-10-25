import { describe, it, expect } from 'vitest';
import { ServerGenerator } from './server-generator.js';
import type { GeneratorContext, ServerSpec } from '@mc-creator/shared';
import { FABRIC_INSTALLER_PINNED_VERSION } from '@mc-creator/shared';

function makeCtx(spec: Partial<ServerSpec>): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.1',
    modId: 'test_server',
    spec: {
      modId: 'test_server',
      version: '1.0.0',
      name: 'Test',
      description: '',
      items: [],
      blocks: [],
      ...spec,
    } as any,
    projectPath: '',
  };
}

describe('ServerGenerator', () => {
  const gen = new ServerGenerator();

  it('生成完整配置时生成全部 8 个文件', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'My Server',
        mcVersion: '1.21.1',
        motd: 'Hello World',
        maxPlayers: 30,
        port: 25566,
        gamemode: 'creative',
        difficulty: 'hard',
        levelName: 'myworld',
        levelSeed: '12345',
        pvp: false,
        onlineMode: false,
        whitelist: true,
        enforceWhitelist: true,
        viewDistance: 12,
        simulationDistance: 8,
        allowFlight: true,
        allowNether: false,
        allowEnd: false,
        spawnAnimals: false,
        spawnNpcs: false,
        spawnMonsters: false,
        generateStructures: false,
        ops: [{ name: 'Admin', level: 4 }],
        whitelistEntries: [{ name: 'Player1', uuid: 'abc-123' }],
        mods: [
          { id: 'sodium', version: '0.5.0', source: 'modrinth' },
          { id: 'fabric-api', version: '0.100.0', source: 'modrinth' },
        ],
        eula: true,
        startMemory: '2G',
        maxMemory: '6G',
      }),
    );

    expect(result.files).toHaveLength(10);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'README.txt',
      'eula.txt',
      'install.bat',
      'install.sh',
      'mods/modlist.txt',
      'ops.json',
      'server.properties',
      'start.bat',
      'start.sh',
      'whitelist.json',
    ]);
  });

  it('server.properties 包含正确的键值对', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'My Server',
        maxPlayers: 20,
        port: 25565,
        gamemode: 'survival',
        difficulty: 'normal',
        pvp: true,
        onlineMode: true,
      }),
    );
    const props = result.files.find((f) => f.path === 'server.properties');
    expect(props).toBeDefined();
    const content = props!.content;
    expect(content).toContain('max-players=20');
    expect(content).toContain('server-port=25565');
    expect(content).toContain('gamemode=survival');
    expect(content).toContain('difficulty=normal');
    expect(content).toContain('pvp=true');
    expect(content).toContain('online-mode=true');
  });

  it('ops.json 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        ops: [
          { name: 'Admin', level: 4 },
          { name: 'Mod', level: 2 },
        ],
      }),
    );
    const ops = result.files.find((f) => f.path === 'ops.json');
    expect(ops).toBeDefined();
    const parsed = JSON.parse(ops!.content);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Admin');
    expect(parsed[0].level).toBe(4);
    expect(parsed[0].uuid).toBe('');
    expect(parsed[0].xuid).toBe('');
    expect(parsed[1].name).toBe('Mod');
    expect(parsed[1].level).toBe(2);
  });

  it('whitelist.json 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        whitelistEntries: [{ name: 'Player1', uuid: 'uuid-1' }, { name: 'Player2' }],
      }),
    );
    const wl = result.files.find((f) => f.path === 'whitelist.json');
    expect(wl).toBeDefined();
    const parsed = JSON.parse(wl!.content);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Player1');
    expect(parsed[0].uuid).toBe('uuid-1');
    expect(parsed[1].name).toBe('Player2');
    expect(parsed[1].uuid).toBe('');
  });

  it('start.bat / start.sh 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        startMemory: '2G',
        maxMemory: '4G',
      }),
    );
    const bat = result.files.find((f) => f.path === 'start.bat');
    const sh = result.files.find((f) => f.path === 'start.sh');
    expect(bat).toBeDefined();
    expect(sh).toBeDefined();
    expect(bat!.content).toContain('@echo off');
    expect(bat!.content).toContain('"java" -Xmx4G -Xms2G -jar "server.jar" nogui');
    expect(bat!.content).toContain('pause');
    expect(sh!.content).toContain('#!/bin/sh');
    expect(sh!.content).toContain('"java" -Xmx4G -Xms2G -jar "server.jar" nogui');
  });

  it('空配置（最小 Spec）不崩溃且生成 10 个文件', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'Minimal',
      }),
    );
    expect(result.files).toHaveLength(10);
    const props = result.files.find((f) => f.path === 'server.properties');
    expect(props).toBeDefined();
    // 默认值
    expect(props!.content).toContain('max-players=20');
    expect(props!.content).toContain('server-port=25565');
    expect(props!.content).toContain('gamemode=survival');

    const ops = result.files.find((f) => f.path === 'ops.json');
    expect(JSON.parse(ops!.content)).toEqual([]);

    const wl = result.files.find((f) => f.path === 'whitelist.json');
    expect(JSON.parse(wl!.content)).toEqual([]);

    const modlist = result.files.find((f) => f.path === 'mods/modlist.txt');
    expect(modlist!.content).toBe('');
  });

  it('extraProperties 被合并到 server.properties', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        extraProperties: {
          'resource-pack': 'https://example.com/pack.zip',
          'max-build-height': 256,
          'enable-command-block': true,
        },
      }),
    );
    const props = result.files.find((f) => f.path === 'server.properties');
    expect(props).toBeDefined();
    const content = props!.content;
    expect(content).toContain('resource-pack=https://example.com/pack.zip');
    expect(content).toContain('max-build-height=256');
    expect(content).toContain('enable-command-block=true');
  });

  it('buildCmd 为 java -jar server.jar', async () => {
    const result = await gen.generate(makeCtx({ serverName: 'S' }));
    expect(result.buildCmd).toBe('java -jar server.jar');
  });

  it("deployTarget='none'（默认）不生成 deploy/ 文件", async () => {
    const result = await gen.generate(makeCtx({ serverName: 'S' }));
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    expect(deployFiles).toHaveLength(0);
    // 基础 10 个 + 无 deploy 文件
    expect(result.files).toHaveLength(10);
  });

  it('一键部署: 生成 install.sh（云服务器）与 install.bat（本地）', async () => {
    const result = await gen.generate(
      makeCtx({ serverName: 'Srv', serverType: 'vanilla', serverVersion: '1.21.1' }),
    );
    const sh = result.files.find((f) => f.path === 'install.sh');
    expect(sh).toBeDefined();
    expect(sh!.content).toContain('openjdk-21-jre-headless');
    expect(sh!.content).toContain('systemctl enable minecraft');
    expect(sh!.content).toContain('piston-meta.mojang.com');
    expect(sh!.content).toContain('MC_VERSION="1.21.1"');

    const bat = result.files.find((f) => f.path === 'install.bat');
    expect(bat).toBeDefined();
    expect(bat!.content).toContain('start.bat');
    expect(bat!.content).toContain('set MC_VERSION=1.21.1');
  });

  it('一键部署: serverType=paper 走 PaperMC **v3**（v2 已 410 Gone）', async () => {
    const result = await gen.generate(
      makeCtx({ serverName: 'Srv', serverType: 'paper', serverVersion: '1.21.1' }),
    );
    const sh = result.files.find((f) => f.path === 'install.sh');
    const bat = result.files.find((f) => f.path === 'install.bat');

    // ⚠️ 这一条原来只断言 toContain('api.papermc.io') —— **钉了域名、没钉版本**，
    // 所以端点整体下线（v2 → 410 Gone）时它照样绿，而生成的 install.sh/install.bat
    // 已经变成必然失败的死链。这与 MEMORY §7.16「断言里引用被测常量 = 自洽性绿」
    // 是同一个病的另一面：这里不是常量，是**只断言了不变量的一半**。
    // 现在钉死：必须是 v3 的 fill 域，且**不得出现**已下线的 v2 路径。
    for (const [name, f] of [
      ['install.sh', sh],
      ['install.bat', bat],
    ] as const) {
      expect(f, name).toBeDefined();
      expect(f!.content, name).toContain('fill.papermc.io/v3');
      expect(f!.content, name).not.toContain('api.papermc.io');
      // 必须走 builds/latest：最新 build 由服务端决定，脚本不自己挑
      expect(f!.content, name).toContain('/builds/latest');
      // 必须直接取服务端给的下载 URL，而不是自己拼 URL
      expect(f!.content, name).toContain('server:default');
    }

    // 死链的真正危害是「静默损坏」：curl / Invoke-WebRequest 不带 -f / -ErrorAction
    // 时，HTTP 错误页会被当成 jar 写进磁盘，表现为「装完了但启动报 jar 损坏」。
    // shell 侧用 curl -fL，batch 侧用 Invoke-RestMethod + 显式判空并 exit 1。
    expect(sh!.content).toMatch(/curl -fL -o/);
    expect(bat!.content).toContain('Invoke-RestMethod');
    expect(bat!.content).toContain('exit 1');

    // 取不到下载地址时必须明确失败，不能拼出空版本号的畸形 URL 继续跑。
    // ⚠️ 这里必须断言**整个守卫块**而不是单独 toContain('exit 1')：
    // install.bat 侧的 PowerShell 单行里也有 exit 1，只查子串会被旁路 ——
    // 实测把守卫条件改成 `if false` 时该断言照样 GREEN（假绿）。
    expect(sh!.content).toMatch(/if \[ -z "\$PAPER_URL" \]; then[\s\S]*?exit 1[\s\S]*?fi/);
    // batch 侧同理：判空与 exit 1 必须同处一条 -Command
    expect(bat!.content).toMatch(/if \(-not \$u\) \{[^}]*exit 1/);
    // 绝不能出现自己拼 URL 的痕迹（旧实现会拼出 /builds/$PAPER_BUILD/... ）
    expect(sh!.content).not.toMatch(/\/builds\/\$\{?PAPER_BUILD/);
    expect(bat!.content).not.toMatch(/\/downloads\/paper-/);
  });

  it('一键部署: serverType=fabric 下载 fabric-installer（**具体版本号**，非 latest 死链）', async () => {
    const result = await gen.generate(
      makeCtx({ serverName: 'Srv', serverType: 'fabric', serverVersion: '1.21.1' }),
    );
    const sh = result.files.find((f) => f.path === 'install.sh');
    const bat = result.files.find((f) => f.path === 'install.bat');

    // ⚠️ 这条原来只断言 toContain('maven.fabricmc.net') + 一段命令文本 ——
    // **钉了域名、没钉版本**，所以 `.../fabric-installer/latest/fabric-installer.jar`
    // 这个实测 404 的死链照样绿（MEMORY §7.18「只钉了一半的不变量」）。
    for (const [name, f] of [
      ['install.sh', sh],
      ['install.bat', bat],
    ] as const) {
      expect(f, name).toBeDefined();
      // 必须是 <版本>/<artifact>-<版本>.jar 的形态，且版本号是具体数字版本
      expect(f!.content, name).toMatch(
        /fabric-installer\/(\d+\.\d+\.\d+)\/fabric-installer-\1\.jar/,
      );
      // 绝不能出现 latest 目录（maven 没有这个版本目录，实测 404）
      expect(f!.content, name).not.toContain('fabric-installer/latest/');
      // 版本号必须与钉住的常量一致（改了要显式改常量 + 过 CI 巡检）
      expect(f!.content, name).toContain(FABRIC_INSTALLER_PINNED_VERSION);
      // 下载必须带失败标志，否则 HTTP 错误页会被写进 jar（表现为「jar 损坏」）
      expect(f!.content, name).toMatch(
        /curl -fL -o fabric-installer\.jar|Invoke-RestMethod -Uri .* -OutFile fabric-installer\.jar/,
      );
    }

    // `-loader latest` 是 Fabric CLI 的**参数**（合法），与 URL 里的 latest 无关 ——
    // 这条必须仍在，防止把上面修的死链「顺手」把 CLI 参数也改了。
    expect(sh!.content).toContain('-loader latest');
    expect(bat!.content).toContain('-loader latest');
    expect(sh!.content).toContain('fabric-installer.jar server -mcversion');
  });
  it('审查修复: install.sh 创建服务用户 + 精确 Java 检测 + 配置缺失警告', async () => {
    const result = await gen.generate(makeCtx({ serverName: 'Srv' }));
    const sh = result.files.find((f) => f.path === 'install.sh');
    // 用户创建
    expect(sh!.content).toContain('useradd -r -m -d "$SERVER_DIR" "$SERVER_USER"');
    // 精确 Java 21 检测（避免 17 误判）
    expect(sh!.content).toContain(`grep -qE '"21.`);
    // 配置缺失警告
    expect(sh!.content).toContain('未在脚本目录找到配置文件');
  });

  it('审查修复: install.bat Paper 分支不跨进程传值（取 URL 与下载同在一条 PowerShell 内）', async () => {
    const result = await gen.generate(
      makeCtx({ serverName: 'Srv', serverType: 'paper', serverVersion: '1.21.1' }),
    );
    const bat = result.files.find((f) => f.path === 'install.bat');
    // 原机制是 `for /f` 取出 build 号、再 `'%%i'` 直拼进第二条 PowerShell 命令，
    // 以避免用 $env:BUILD 跨进程传值（那条修复的意图是对的）。
    // 改走 v3 builds/latest 后**跨进程变量整个不需要了** —— 直接在同一条
    // PowerShell 里取到 url 并下载，比原机制更强，所以这里钉的是**意图**
    // （不得用环境变量跨进程传值、不得再有 for /f 取值中转），而不是废弃的机制。
    expect(bat!.content).not.toContain('$env:BUILD');
    expect(bat!.content).not.toContain('for /f');
    expect(bat!.content).not.toContain('%%i');
    // 取 url 与下载必须在同一条 -Command 里（否则又变成跨进程传值）
    const cmdLines = bat!.content.split('\n').filter((l) => l.includes('-Command'));
    expect(cmdLines.length).toBeGreaterThan(0);
    for (const line of cmdLines) {
      // 每条 PowerShell 命令要么不含 paper 下载，要么取 url 与下载在同一句里
      if (line.includes('builds/latest')) {
        expect(line).toContain('Invoke-WebRequest');
        expect(line).toMatch(/\$u=/);
      }
    }
  });
  it("deployTarget='systemd' 生成 minecraft.service + install-systemd.sh", async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'Srv',
        deployTarget: 'systemd',
      }),
    );
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual(['deploy/install-systemd.sh', 'deploy/minecraft.service']);
    // 总共 10 + 2
    expect(result.files).toHaveLength(12);
  });

  it("deployTarget='docker' 生成 Dockerfile + docker-compose.yml + build-docker.sh", async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'Srv',
        deployTarget: 'docker',
      }),
    );
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual([
      'deploy/Dockerfile',
      'deploy/build-docker.sh',
      'deploy/docker-compose.yml',
    ]);
    // 总共 10 + 3
    expect(result.files).toHaveLength(13);
  });

  it("deployTarget='both' 生成全部 5 个部署文件", async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'Srv',
        deployTarget: 'both',
      }),
    );
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual([
      'deploy/Dockerfile',
      'deploy/build-docker.sh',
      'deploy/docker-compose.yml',
      'deploy/install-systemd.sh',
      'deploy/minecraft.service',
    ]);
    // 总共 10 + 5
    expect(result.files).toHaveLength(15);
  });

  it('backupInterval=6 生成 backup.sh + backup-cron', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'Srv',
        backupInterval: 6,
      }),
    );
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual(['deploy/backup-cron', 'deploy/backup.sh']);
    // backup-cron 包含正确的间隔
    const cron = result.files.find((f) => f.path === 'deploy/backup-cron');
    expect(cron!.content).toContain('0 */6 * * *');
    // 总共 10 + 2
    expect(result.files).toHaveLength(12);
  });

  it('backupInterval=0（默认）不生成 backup 相关文件', async () => {
    const result = await gen.generate(makeCtx({ serverName: 'S' }));
    expect(result.files.find((f) => f.path === 'deploy/backup.sh')).toBeUndefined();
    expect(result.files.find((f) => f.path === 'deploy/backup-cron')).toBeUndefined();
  });

  it('systemd service 文件包含正确的 ExecStart 和 User', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'MyServer',
        deployTarget: 'systemd',
        javaPath: '/usr/bin/java',
        jarName: 'paper.jar',
        startMemory: '2G',
        maxMemory: '6G',
        serviceUser: 'mcadmin',
        serviceDir: '/srv/mc',
        restartOnCrash: false,
      }),
    );
    const svc = result.files.find((f) => f.path === 'deploy/minecraft.service');
    expect(svc).toBeDefined();
    const content = svc!.content;
    expect(content).toContain('Description=Minecraft Server (MyServer)');
    expect(content).toContain('User=mcadmin');
    expect(content).toContain('WorkingDirectory=/srv/mc');
    expect(content).toContain('ExecStart="/usr/bin/java" -Xmx6G -Xms2G -jar "paper.jar" nogui');
    expect(content).toContain('Restart=no');
  });

  it('systemd restartOnCrash=true 时 Restart=on-failure', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        deployTarget: 'systemd',
        restartOnCrash: true,
      }),
    );
    const svc = result.files.find((f) => f.path === 'deploy/minecraft.service');
    expect(svc!.content).toContain('Restart=on-failure');
  });

  it('Dockerfile EXPOSE 端口正确', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        deployTarget: 'docker',
        port: 25570,
        maxMemory: '8G',
        startMemory: '4G',
        jarName: 'fabric.jar',
      }),
    );
    const df = result.files.find((f) => f.path === 'deploy/Dockerfile');
    expect(df).toBeDefined();
    const content = df!.content;
    expect(content).toContain('FROM eclipse-temurin:21-jre');
    expect(content).toContain('EXPOSE 25570');
    expect(content).toContain('ENV JAVA_OPTS="-Xmx8G -Xms4G"');
    expect(content).toContain('java $JAVA_OPTS -jar fabric.jar nogui');
  });

  it('docker-compose restart 和 mem_limit 受配置控制', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'ComposeSrv',
        deployTarget: 'docker',
        port: 25590,
        maxRamPercent: 75,
        restartOnCrash: false,
      }),
    );
    const dc = result.files.find((f) => f.path === 'deploy/docker-compose.yml');
    expect(dc).toBeDefined();
    const content = dc!.content;
    expect(content).toContain('container_name: ComposeSrv');
    expect(content).toContain('"25590:25590"');
    expect(content).toContain('restart: no');
    expect(content).toContain('mem_limit: 75%');
    expect(content).toContain('- EULA=true');
  });

  it('docker-compose restartOnCrash=true 时 restart: unless-stopped', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        deployTarget: 'docker',
        restartOnCrash: true,
      }),
    );
    const dc = result.files.find((f) => f.path === 'deploy/docker-compose.yml');
    expect(dc!.content).toContain('restart: unless-stopped');
  });

  it('install-systemd.sh 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        deployTarget: 'systemd',
        serviceUser: 'mcuser',
        serviceDir: '/opt/mc',
      }),
    );
    const sh = result.files.find((f) => f.path === 'deploy/install-systemd.sh');
    expect(sh).toBeDefined();
    const content = sh!.content;
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('useradd -r -m -d "/opt/mc" "mcuser" || true');
    expect(content).toContain('mkdir -p "/opt/mc"');
    expect(content).toContain('cp -r ./* "/opt/mc/"');
    expect(content).toContain('chown -R "mcuser:mcuser" "/opt/mc"');
    expect(content).toContain('cp deploy/minecraft.service /etc/systemd/system/');
    expect(content).toContain('systemctl daemon-reload');
    expect(content).toContain('systemctl enable minecraft');
  });

  it('build-docker.sh 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'DockerSrv',
        deployTarget: 'docker',
      }),
    );
    const sh = result.files.find((f) => f.path === 'deploy/build-docker.sh');
    expect(sh).toBeDefined();
    const content = sh!.content;
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('docker build -t minecraft-DockerSrv -f deploy/Dockerfile .');
    expect(content).toContain('docker compose -f deploy/docker-compose.yml up -d');
  });

  it('backup.sh 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'S',
        backupInterval: 12,
        serviceDir: '/opt/mc',
      }),
    );
    const sh = result.files.find((f) => f.path === 'deploy/backup.sh');
    expect(sh).toBeDefined();
    const content = sh!.content;
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"');
    expect(content).toContain('cp -r "/opt/mc"/* "$BACKUP_DIR/"');
    expect(content).toContain('ls -dt /backups/* | tail -n +8 | xargs rm -rf');
  });

  it('both + backupInterval 同时生成 7 个 deploy 文件', async () => {
    const result = await gen.generate(
      makeCtx({
        serverName: 'Full',
        deployTarget: 'both',
        backupInterval: 3,
      }),
    );
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    expect(deployFiles).toHaveLength(7);
    expect(deployFiles.map((f) => f.path).sort()).toEqual([
      'deploy/Dockerfile',
      'deploy/backup-cron',
      'deploy/backup.sh',
      'deploy/build-docker.sh',
      'deploy/docker-compose.yml',
      'deploy/install-systemd.sh',
      'deploy/minecraft.service',
    ]);
    // 总共 10 + 7
    expect(result.files).toHaveLength(17);
  });
});
