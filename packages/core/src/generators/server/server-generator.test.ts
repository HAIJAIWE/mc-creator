import { describe, it, expect } from 'vitest';
import { ServerGenerator } from './server-generator.js';
import type { GeneratorContext, ServerSpec } from '@mc-creator/shared';

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
    const result = await gen.generate(makeCtx({
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
    }));

    expect(result.files).toHaveLength(8);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'README.txt',
      'eula.txt',
      'mods/modlist.txt',
      'ops.json',
      'server.properties',
      'start.bat',
      'start.sh',
      'whitelist.json',
    ]);
  });

  it('server.properties 包含正确的键值对', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'My Server',
      maxPlayers: 20,
      port: 25565,
      gamemode: 'survival',
      difficulty: 'normal',
      pvp: true,
      onlineMode: true,
    }));
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
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      ops: [{ name: 'Admin', level: 4 }, { name: 'Mod', level: 2 }],
    }));
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
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      whitelistEntries: [
        { name: 'Player1', uuid: 'uuid-1' },
        { name: 'Player2' },
      ],
    }));
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
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      startMemory: '2G',
      maxMemory: '4G',
    }));
    const bat = result.files.find((f) => f.path === 'start.bat');
    const sh = result.files.find((f) => f.path === 'start.sh');
    expect(bat).toBeDefined();
    expect(sh).toBeDefined();
    expect(bat!.content).toContain('@echo off');
    expect(bat!.content).toContain('java -Xmx4G -Xms2G -jar server.jar nogui');
    expect(bat!.content).toContain('pause');
    expect(sh!.content).toContain('#!/bin/sh');
    expect(sh!.content).toContain('java -Xmx4G -Xms2G -jar server.jar nogui');
  });

  it('空配置（最小 Spec）不崩溃且生成 8 个文件', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'Minimal',
    }));
    expect(result.files).toHaveLength(8);
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
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      extraProperties: {
        'resource-pack': 'https://example.com/pack.zip',
        'max-build-height': 256,
        'enable-command-block': true,
      },
    }));
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
    // 总共仍为 8 个文件
    expect(result.files).toHaveLength(8);
  });

  it("deployTarget='systemd' 生成 minecraft.service + install-systemd.sh", async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'Srv',
      deployTarget: 'systemd',
    }));
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual(['deploy/install-systemd.sh', 'deploy/minecraft.service']);
    // 总共 8 + 2
    expect(result.files).toHaveLength(10);
  });

  it("deployTarget='docker' 生成 Dockerfile + docker-compose.yml + build-docker.sh", async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'Srv',
      deployTarget: 'docker',
    }));
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual([
      'deploy/Dockerfile',
      'deploy/build-docker.sh',
      'deploy/docker-compose.yml',
    ]);
    // 总共 8 + 3
    expect(result.files).toHaveLength(11);
  });

  it("deployTarget='both' 生成全部 5 个部署文件", async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'Srv',
      deployTarget: 'both',
    }));
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual([
      'deploy/Dockerfile',
      'deploy/build-docker.sh',
      'deploy/docker-compose.yml',
      'deploy/install-systemd.sh',
      'deploy/minecraft.service',
    ]);
    // 总共 8 + 5
    expect(result.files).toHaveLength(13);
  });

  it('backupInterval=6 生成 backup.sh + backup-cron', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'Srv',
      backupInterval: 6,
    }));
    const deployFiles = result.files.filter((f) => f.path.startsWith('deploy/'));
    const paths = deployFiles.map((f) => f.path).sort();
    expect(paths).toEqual(['deploy/backup-cron', 'deploy/backup.sh']);
    // backup-cron 包含正确的间隔
    const cron = result.files.find((f) => f.path === 'deploy/backup-cron');
    expect(cron!.content).toContain('0 */6 * * *');
    // 总共 8 + 2
    expect(result.files).toHaveLength(10);
  });

  it('backupInterval=0（默认）不生成 backup 相关文件', async () => {
    const result = await gen.generate(makeCtx({ serverName: 'S' }));
    expect(result.files.find((f) => f.path === 'deploy/backup.sh')).toBeUndefined();
    expect(result.files.find((f) => f.path === 'deploy/backup-cron')).toBeUndefined();
  });

  it('systemd service 文件包含正确的 ExecStart 和 User', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'MyServer',
      deployTarget: 'systemd',
      javaPath: '/usr/bin/java',
      jarName: 'paper.jar',
      startMemory: '2G',
      maxMemory: '6G',
      serviceUser: 'mcadmin',
      serviceDir: '/srv/mc',
      restartOnCrash: false,
    }));
    const svc = result.files.find((f) => f.path === 'deploy/minecraft.service');
    expect(svc).toBeDefined();
    const content = svc!.content;
    expect(content).toContain('Description=Minecraft Server (MyServer)');
    expect(content).toContain('User=mcadmin');
    expect(content).toContain('WorkingDirectory=/srv/mc');
    expect(content).toContain('ExecStart=/usr/bin/java -Xmx6G -Xms2G -jar paper.jar nogui');
    expect(content).toContain('Restart=no');
  });

  it('systemd restartOnCrash=true 时 Restart=on-failure', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      deployTarget: 'systemd',
      restartOnCrash: true,
    }));
    const svc = result.files.find((f) => f.path === 'deploy/minecraft.service');
    expect(svc!.content).toContain('Restart=on-failure');
  });

  it('Dockerfile EXPOSE 端口正确', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      deployTarget: 'docker',
      port: 25570,
      maxMemory: '8G',
      startMemory: '4G',
      jarName: 'fabric.jar',
    }));
    const df = result.files.find((f) => f.path === 'deploy/Dockerfile');
    expect(df).toBeDefined();
    const content = df!.content;
    expect(content).toContain('FROM eclipse-temurin:21-jre');
    expect(content).toContain('EXPOSE 25570');
    expect(content).toContain('ENV JAVA_OPTS="-Xmx8G -Xms4G"');
    expect(content).toContain('java $JAVA_OPTS -jar fabric.jar nogui');
  });

  it('docker-compose restart 和 mem_limit 受配置控制', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'ComposeSrv',
      deployTarget: 'docker',
      port: 25590,
      maxRamPercent: 75,
      restartOnCrash: false,
    }));
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
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      deployTarget: 'docker',
      restartOnCrash: true,
    }));
    const dc = result.files.find((f) => f.path === 'deploy/docker-compose.yml');
    expect(dc!.content).toContain('restart: unless-stopped');
  });

  it('install-systemd.sh 内容正确', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      deployTarget: 'systemd',
      serviceUser: 'mcuser',
      serviceDir: '/opt/mc',
    }));
    const sh = result.files.find((f) => f.path === 'deploy/install-systemd.sh');
    expect(sh).toBeDefined();
    const content = sh!.content;
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('useradd -r -m -d /opt/mc mcuser || true');
    expect(content).toContain('mkdir -p /opt/mc');
    expect(content).toContain('cp -r ./* /opt/mc/');
    expect(content).toContain('chown -R mcuser:mcuser /opt/mc');
    expect(content).toContain('cp deploy/minecraft.service /etc/systemd/system/');
    expect(content).toContain('systemctl daemon-reload');
    expect(content).toContain('systemctl enable minecraft');
  });

  it('build-docker.sh 内容正确', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'DockerSrv',
      deployTarget: 'docker',
    }));
    const sh = result.files.find((f) => f.path === 'deploy/build-docker.sh');
    expect(sh).toBeDefined();
    const content = sh!.content;
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('docker build -t minecraft-DockerSrv -f deploy/Dockerfile .');
    expect(content).toContain('docker compose -f deploy/docker-compose.yml up -d');
  });

  it('backup.sh 内容正确', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'S',
      backupInterval: 12,
      serviceDir: '/opt/mc',
    }));
    const sh = result.files.find((f) => f.path === 'deploy/backup.sh');
    expect(sh).toBeDefined();
    const content = sh!.content;
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"');
    expect(content).toContain('cp -r /opt/mc/* "$BACKUP_DIR/"');
    expect(content).toContain('ls -dt /backups/* | tail -n +8 | xargs rm -rf');
  });

  it('both + backupInterval 同时生成 7 个 deploy 文件', async () => {
    const result = await gen.generate(makeCtx({
      serverName: 'Full',
      deployTarget: 'both',
      backupInterval: 3,
    }));
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
    // 总共 8 + 7
    expect(result.files).toHaveLength(15);
  });
});
