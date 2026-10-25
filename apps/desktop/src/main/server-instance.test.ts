// @vitest-environment node
/**
 * 原版服务端实例创建（把 server.jar 变成可启动的实例）。
 *
 * 三件容易做错的事，各有用例：
 *  1. **不代用户同意 EULA** —— `eula.txt` 默认 `eula=false`，只有显式 `acceptEula=true` 才写 `eula=true`
 *  2. **properties 值转义** —— `motd` 带换行/等号/冒号/井号会凭空插出别的配置项
 *  3. **jar 优先硬链接** —— 62 MB 的 jar 逐个实例复制既慢又占地，链接不成再退回复制
 *
 * 根目录与内核对齐：`<userData>/mc-creator/servers/<serverId>`（不是启动器的 `mc-launcher/`）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createVanillaServerInstance,
  isEulaAccepted,
  propertiesEscape,
} from './server-instance.js';

describe('server-instance · 原版服务端实例创建', () => {
  let serversRoot: string;
  let jarPath: string;

  beforeEach(() => {
    serversRoot = mkdtempSync(join(tmpdir(), 'srv-inst-'));
    jarPath = join(serversRoot, '..', 'fake-server.jar');
    // 用一个小 jar 当测试样本
    const { writeFileSync, mkdirSync } = require('node:fs');
    mkdirSync(join(serversRoot, '..'), { recursive: true });
    writeFileSync(jarPath, 'fake server jar content');
  });
  afterEach(() => {
    rmSync(serversRoot, { recursive: true, force: true });
    rmSync(jarPath, { force: true });
  });

  describe('propertiesEscape · server.properties 值转义', () => {
    it('换行变空格（防凭空插入新配置行）', () => {
      expect(propertiesEscape('line1\nline2')).toBe('line1 line2');
      expect(propertiesEscape('a\r\nb')).toBe('a b');
    });
    it('等号、冒号、井号前加反斜杠', () => {
      expect(propertiesEscape('a=b')).toBe('a\\=b');
      expect(propertiesEscape('k:v')).toBe('k\\:v');
      expect(propertiesEscape('#comment')).toBe('\\#comment');
    });
    it('反斜杠先转义', () => {
      expect(propertiesEscape('\\')).toBe('\\\\');
      expect(propertiesEscape('a\\b')).toBe('a\\\\b');
    });
    it('组合：motd 带换行与等号', () => {
      // 这是最容易被利用注入的场景：用户输入 "Hello\nmotd=hacked"
      const escaped = propertiesEscape('Hello\nmotd=hacked');
      expect(escaped).toBe('Hello motd\\=hacked');
      expect(escaped).not.toContain('\n');
      expect(escaped).not.toContain('motd=hacked');
    });
  });

  describe('createVanillaServerInstance · 创建实例', () => {
    /** 每个测试里现构建 opts，避免闭包捕获到 beforeEach 之前的 undefined。 */
    const makeOpts = (over: Record<string, unknown> = {}) => ({
      serversRoot,
      serverId: 'test-server',
      jarPath,
      ...over,
    });

    it('默认写 eula=false —— 不代用户同意 EULA', async () => {
      const r = await createVanillaServerInstance(makeOpts());
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      expect(r.eulaAccepted).toBe(false);
      const eula = readFileSync(join(serversRoot, 'test-server', 'eula.txt'), 'utf-8');
      expect(eula).toBe('eula=false\n');
    });

    it('acceptEula=true 时写 eula=true', async () => {
      const r = await createVanillaServerInstance(makeOpts({ acceptEula: true }));
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      expect(r.eulaAccepted).toBe(true);
      const eula = readFileSync(join(serversRoot, 'test-server', 'eula.txt'), 'utf-8');
      expect(eula).toBe('eula=true\n');
    });

    it('记录 MC 版本元数据，列表不必拿实例名冒充版本号', async () => {
      const r = await createVanillaServerInstance(makeOpts({ versionId: '26.3' }));
      expect(r.ok).toBe(true);
      const version = readFileSync(
        join(serversRoot, 'test-server', '.mc-creator-version'),
        'utf-8',
      );
      expect(version.trim()).toBe('26.3');
    });

    it('motd 带换行与等号 → 被转义，不凭空插入配置', async () => {
      await createVanillaServerInstance(makeOpts({ motd: 'Hello\nworld=123\n:colon#hash' }));
      const props = readFileSync(join(serversRoot, 'test-server', 'server.properties'), 'utf-8');
      // motd 行存在且转义正确：换行→空格，等号/冒号/井号被反斜杠转义
      expect(props).toContain('motd=Hello world\\=123 \\:colon\\#hash');
      // 没有产生第二行 "world=123"（否则会被解析成另一个配置项）
      expect(props.split('\n').filter((l) => l.startsWith('world='))).toHaveLength(0);
      // # 被转义为 \#，所以原始的 #hash 不会被当成注释
      // （这一断言改为检查 # 被转义了，而不是检查字符串不存在）
      expect(props).toContain('\\#hash');
    });

    it('jar 优先硬链接（链接不成再复制）', async () => {
      const r = await createVanillaServerInstance(makeOpts());
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      expect(r.jarLinked).toBe(true);
      const dest = join(serversRoot, 'test-server', 'server.jar');
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf-8')).toBe('fake server jar content');
    });

    it('重名 → 拒绝，不覆盖已有实例', async () => {
      await createVanillaServerInstance(makeOpts());
      const r2 = await createVanillaServerInstance(makeOpts());
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error).toContain('服务端已存在');
    });

    it('serverId 带路径穿越 → 被拒', async () => {
      const r = await createVanillaServerInstance(makeOpts({ serverId: '../../evil' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('serverId 非法');
    });

    it('jar 不存在 → 被拒', async () => {
      const r = await createVanillaServerInstance(
        makeOpts({ serverId: 'no-jar', jarPath: '/does/not/exist.jar' }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('服务端 jar 不存在');
    });

    it('serversRoot 不存在 → 被拒', async () => {
      const r = await createVanillaServerInstance(
        makeOpts({ serversRoot: '/does/not/exist/servers' }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('服务端根目录不存在');
    });

    it('maxPlayers 非法 → 被拒', async () => {
      const r = await createVanillaServerInstance(makeOpts({ maxPlayers: 5000 }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('最大在线人数非法');
    });

    it('端口非法 → 被拒', async () => {
      const r = await createVanillaServerInstance(makeOpts({ port: 70000 }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('端口非法');
    });

    it('子目录 plugins/world/logs/config 全部建好，且有 .gitkeep', async () => {
      await createVanillaServerInstance(makeOpts());
      for (const sub of ['plugins', 'world', 'logs', 'config']) {
        expect(existsSync(join(serversRoot, 'test-server', sub))).toBe(true);
        expect(existsSync(join(serversRoot, 'test-server', sub, '.gitkeep'))).toBe(true);
      }
    });
  });

  describe('isEulaAccepted · 实例是否已接受 EULA', () => {
    it('eula=true → true', () => {
      const dir = mkdtempSync(join(tmpdir(), 'eula-'));
      require('node:fs').writeFileSync(join(dir, 'eula.txt'), 'eula=true\n');
      expect(isEulaAccepted(dir)).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    });
    it('eula=false → false', () => {
      const dir = mkdtempSync(join(tmpdir(), 'eula-'));
      require('node:fs').writeFileSync(join(dir, 'eula.txt'), 'eula=false\n');
      expect(isEulaAccepted(dir)).toBe(false);
      rmSync(dir, { recursive: true, force: true });
    });
    it('文件不存在 / 无法读 → false（保守）', () => {
      expect(isEulaAccepted('/does/not/exist')).toBe(false);
    });
  });
});
