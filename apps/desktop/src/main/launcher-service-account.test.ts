import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`ENC(${s})`, 'utf-8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf-8');
      return s.startsWith('ENC(') && s.endsWith(')') ? s.slice(4, -1) : '';
    },
  },
}));

import { spawn } from 'node:child_process';
import {
  DEFAULT_THIRD_PARTY_SKIN_API,
  LauncherService,
  type VersionDetail,
} from './launcher-service.js';
import {
  ComplianceDeniedError,
  RISK_NOTICE,
  RISK_NOTICE_VERSION,
  ThirdPartyAuthGate,
} from './compliance-gate.js';

/**
 * launcher-service 的账户接缝测试：
 * 1. 正版凭据（§5.8）—— UUID/username/accessToken/userType 全部取自 profile；
 * 2. 离线模式（§1.2 第 2 条）—— 不传凭据时行为与改造前**完全一致**；
 * 3. 第三方认证站闸门（§1.2 / §19）—— `enableThirdPartyAuth` fail-closed。
 *
 * 既有的 `launcher-service.test.ts` **未被修改**（那里断言的
 * `installSkinSupport` 行为一字未动），本文件是新增的旁路覆盖。
 *
 * spawn 通过构造参数注入（`LauncherServiceDeps.spawn`）而不是 mock 模块：
 * `vi.mock('node:child_process')` 在本仓 vitest 2.1 上会静默失效，
 * 导致测试真的去起 java 进程（实测 pid 变成真实 pid）。
 */

const DETAIL: VersionDetail = {
  id: '26.2',
  assets: '26',
  assetsUrl: '',
  clientUrl: 'https://launcher.mojang.com/client.jar',
  libraryUrls: [],
};

const CREDENTIALS = {
  username: 'jeb_',
  uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
  accessToken: 'MC-ACCESS-TOKEN-canary-0123456789abcdef',
  userType: 'msa' as const,
};

/** 记录 spawn 的实参，绝不真的起进程。 */
const spawned: { cmd: string; args: string[] }[] = [];
const fakeSpawn = ((cmd: string, args: string[]) => {
  spawned.push({ cmd, args });
  return { pid: 4242, on: () => undefined } as unknown as ReturnType<typeof spawn>;
}) as unknown as typeof spawn;

/** 不触发真实下载的假 fetch（所有 jar 命中都返回假字节）。 */
function offlineFetch(): typeof fetch {
  return (async (url: string) => {
    if (url.includes('api.modrinth.com')) {
      return new Response(
        JSON.stringify([
          {
            files: [{ url: 'https://cdn.modrinth.com/data/csl/csl.jar', filename: 'csl.jar' }],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('.jar')) {
      return new Response(Buffer.from('jar-data'), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

/** 路径存在性（断言「闸门在写盘之前就拒绝了」用）。 */
async function exists(p: string): Promise<boolean> {
  return import('node:fs/promises').then((f) =>
    f
      .access(p)
      .then(() => true)
      .catch(() => false),
  );
}

async function seedClient(dir: string): Promise<void> {
  // 注意必须传 offlineFetch：默认参数是**真实** fetch，会打到 Mojang。
  await new LauncherService(dir, offlineFetch(), { spawn: fakeSpawn }).downloadClient(DETAIL);
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}

function makeService(dir: string, thirdPartyAuth?: ThirdPartyAuthGate): LauncherService {
  return new LauncherService(dir, offlineFetch(), {
    spawn: fakeSpawn,
    ...(thirdPartyAuth === undefined ? {} : { thirdPartyAuth }),
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'launcher-acct-'));
  spawned.length = 0;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('launchGame · 正版模式（§5.8）', () => {
  it('UUID 用 profile 的真实 UUID（**不是** randomUUID）、userType=msa', async () => {
    const dir = join(tmpDir, 'genuine');
    await seedClient(dir);
    const res = await makeService(dir).launchGame(DETAIL, {
      username: 'ignored-offline-name',
      memory: '2G',
      gameDir: join(dir, 'game'),
      credentials: CREDENTIALS,
    });
    expect(res.pid).toBe(4242);
    const { args } = spawned[0]!;
    expect(argValue(args, '--uuid')).toBe('853c80ef-3c37-49fd-aa49-938b674adae6');
    expect(argValue(args, '--username')).toBe('jeb_');
    expect(argValue(args, '--accessToken')).toBe(CREDENTIALS.accessToken);
    expect(argValue(args, '--userType')).toBe('msa');
  });

  it('UUID 带连字符（原样透传 profile 的 id）', async () => {
    const dir = join(tmpDir, 'dashed');
    await seedClient(dir);
    await makeService(dir).launchGame(DETAIL, {
      username: 'x',
      memory: '2G',
      gameDir: join(dir, 'game'),
      credentials: CREDENTIALS,
    });
    expect(argValue(spawned[0]!.args, '--uuid')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('⚠️ 不混用「正版 UUID + 0 号 token」（那会被服务端判为伪造会话）', async () => {
    const dir = join(tmpDir, 'nomix');
    await seedClient(dir);
    await makeService(dir).launchGame(DETAIL, {
      username: 'x',
      memory: '2G',
      gameDir: join(dir, 'game'),
      credentials: CREDENTIALS,
    });
    const { args } = spawned[0]!;
    const uuid = argValue(args, '--uuid');
    const token = argValue(args, '--accessToken');
    expect(uuid === CREDENTIALS.uuid).not.toBe(token === '0');
  });

  it('正版模式下 spawn 的可执行文件与内存参数不变（未改动底层启动方式）', async () => {
    const dir = join(tmpDir, 'spawn');
    await seedClient(dir);
    await makeService(dir).launchGame(DETAIL, {
      username: 'x',
      memory: '4G',
      gameDir: join(dir, 'game'),
      credentials: CREDENTIALS,
    });
    const call = spawned[0]!;
    expect(call.cmd).toBe('java');
    expect(call.args[0]).toBe('-Xmx4G');
    expect(call.args[1]).toBe('-Xms4G');
    expect(call.args).toContain('net.minecraft.client.main.Main');
  });
});

describe('launchGame · 离线模式（§1.2 第 2 条：仅开发/测试）', () => {
  it('不传 credentials → accessToken=0、userType=legacy、UUID 随机', async () => {
    const dir = join(tmpDir, 'offline');
    await seedClient(dir);
    await makeService(dir).launchGame(DETAIL, {
      username: 'Steve',
      memory: '2G',
      gameDir: join(dir, 'game'),
    });
    const { args } = spawned[0]!;
    expect(argValue(args, '--accessToken')).toBe('0');
    expect(argValue(args, '--userType')).toBe('legacy');
    expect(argValue(args, '--username')).toBe('Steve');
    expect(argValue(args, '--uuid')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('两次离线启动的 UUID 不同（确认是随机而不是固定值）', async () => {
    const dir = join(tmpDir, 'offline2');
    await seedClient(dir);
    const svc = makeService(dir);
    await svc.launchGame(DETAIL, { username: 'Steve', memory: '2G', gameDir: join(dir, 'g') });
    await svc.launchGame(DETAIL, { username: 'Steve', memory: '2G', gameDir: join(dir, 'g') });
    expect(argValue(spawned[0]!.args, '--uuid')).not.toBe(argValue(spawned[1]!.args, '--uuid'));
  });

  it('credentials.username 为空时回落到 opts.username（不留空用户名）', async () => {
    const dir = join(tmpDir, 'fallback');
    await seedClient(dir);
    await makeService(dir).launchGame(DETAIL, {
      username: 'FallbackName',
      memory: '2G',
      gameDir: join(dir, 'game'),
      credentials: { ...CREDENTIALS, username: '' },
    });
    expect(argValue(spawned[0]!.args, '--username')).toBe('FallbackName');
  });

  it('客户端未下载时仍先抛「客户端未下载」（凭据不改变这个前置检查）', async () => {
    const svc = makeService(join(tmpDir, 'missing'));
    await expect(
      svc.launchGame(DETAIL, {
        username: 'x',
        memory: '2G',
        gameDir: '',
        credentials: CREDENTIALS,
      }),
    ).rejects.toThrow('客户端未下载');
    expect(spawned).toHaveLength(0);
  });
});

describe('enableThirdPartyAuth · §1.2 / §19 合规闸门', () => {
  it('未注入闸门 → fail-closed 拒绝（fail-closed ≠ 放行）', async () => {
    const svc = makeService(join(tmpDir, 'nogate'));
    await expect(
      svc.enableThirdPartyAuth('26.2', DEFAULT_THIRD_PARTY_SKIN_API),
    ).rejects.toBeInstanceOf(ComplianceDeniedError);
  });

  it('闸门默认关闭（enabled 未开）→ 拒绝，且**不写任何配置**', async () => {
    const dir = join(tmpDir, 'closed');
    const gate = new ThirdPartyAuthGate({
      confirm: async () => true,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    const svc = makeService(dir, gate);
    await expect(
      svc.enableThirdPartyAuth('26.2', DEFAULT_THIRD_PARTY_SKIN_API),
    ).rejects.toMatchObject({ reason: 'disabled_by_default' });
    expect(await exists(join(dir, 'game', '26.2', 'config', 'CustomSkinLoader'))).toBe(false);
  });

  it('enabled 但用户未确认 → 拒绝，且不写配置', async () => {
    const dir = join(tmpDir, 'unconfirmed');
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: async () => false,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    const svc = makeService(dir, gate);
    await expect(
      svc.enableThirdPartyAuth('26.2', DEFAULT_THIRD_PARTY_SKIN_API),
    ).rejects.toMatchObject({ reason: 'confirm_declined' });
    expect(await exists(join(dir, 'game', '26.2', 'config', 'CustomSkinLoader'))).toBe(false);
  });

  it('确认框展示 §1.2 风险提示全文后才放行并写配置', async () => {
    const dir = join(tmpDir, 'confirmed');
    const details: string[] = [];
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
      confirm: async (req) => {
        details.push(req.detail);
        return true;
      },
    });
    await makeService(dir, gate).enableThirdPartyAuth('26.2', DEFAULT_THIRD_PARTY_SKIN_API);
    expect(details[0]).toContain(RISK_NOTICE);
    expect(details[0]).toContain('微软服务协议限制绕过技术保护措施');
    const cfg = await import('node:fs/promises').then((f) =>
      f.readFile(
        join(dir, 'game', '26.2', 'config', 'CustomSkinLoader', 'CustomSkinLoader.json'),
        'utf-8',
      ),
    );
    expect(cfg).toContain('littleskin.cn');
  });

  it('URL 形态非法（file:// / 冒名 userinfo）→ 拒绝', async () => {
    const dir = join(tmpDir, 'badurl');
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
      confirm: async () => true,
    });
    const svc = makeService(dir, gate);
    await expect(svc.enableThirdPartyAuth('26.2', 'file:///etc/passwd')).rejects.toMatchObject({
      reason: 'url_not_allowed',
    });
    await expect(
      svc.enableThirdPartyAuth('26.2', 'https://u:p@littleskin.cn/api/yggdrasil'),
    ).rejects.toMatchObject({ reason: 'url_not_allowed' });
  });

  it('未过闸门时配置**永远不会**被写出（闸门在写盘之前）', async () => {
    const dir = join(tmpDir, 'beforewrite');
    let confirmCalled = false;
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
      confirm: async () => {
        confirmCalled = true;
        return false;
      },
    });
    const svc = makeService(dir, gate);
    await expect(
      svc.enableThirdPartyAuth('26.2', DEFAULT_THIRD_PARTY_SKIN_API),
    ).rejects.toBeTruthy();
    expect(confirmCalled).toBe(true);
    // 连 mod 目录都不该被创建
    expect(await exists(join(dir, 'versions', '26.2', 'mods'))).toBe(false);
  });
});

describe('DEFAULT_THIRD_PARTY_SKIN_API', () => {
  it('只是默认**取值**，不代表默认开启（闸门仍默认关闭）', () => {
    expect(DEFAULT_THIRD_PARTY_SKIN_API).toBe('https://littleskin.cn/api/yggdrasil');
    expect(new ThirdPartyAuthGate().isEnabled).toBe(false);
  });
});
