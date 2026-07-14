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
});
