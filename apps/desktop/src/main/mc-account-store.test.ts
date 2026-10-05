import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let encryptionAvailable = true;

// 可逆 cipher 模拟 safeStorage（与 curseforge-config.test.ts 保持一致），
// 关键是「密文里读不出明文」这个性质必须成立。
const enc = (s: string) => Buffer.from(`ENC(${s})`, 'utf-8');
const dec = (b: Buffer) => {
  const s = b.toString('utf-8');
  return s.startsWith('ENC(') && s.endsWith(')') ? s.slice(4, -1) : '';
};

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => enc(s),
    decryptString: (b: Buffer) => dec(b),
  },
}));

import {
  ACCOUNTS_FILE_VERSION,
  AccountStore,
  OS_ENCRYPTION_UNAVAILABLE,
  TOKEN_REFRESH_SKEW_MS,
  type StoredAccount,
} from './mc-account-store.js';

const ACC_A = {
  username: 'jeb_',
  uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
  msRefreshToken: 'REFRESH-TOKEN-ALPHA-0123456789',
  mcAccessToken: 'MC-ACCESS-TOKEN-ALPHA-0123456789',
  mcAccessTokenExpiresAt: 2_000_000_000_000,
  capes: [
    {
      capeId: 'c1',
      imageUrl: 'https://textures.minecraft.net/texture/cape1',
      active: true,
      alias: 'Migrator',
    },
  ],
  hasMinecraftProfile: true,
};

const ACC_B = {
  username: 'Notch',
  uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
  msRefreshToken: 'REFRESH-TOKEN-BRAVO-0123456789',
  mcAccessToken: 'MC-ACCESS-TOKEN-BRAVO-0123456789',
  mcAccessTokenExpiresAt: 2_000_000_000_000,
  capes: [],
  hasMinecraftProfile: true,
};

function store(now = 1_000_000): AccountStore {
  return new AccountStore(join(tmpDir, 'mc-accounts.json'), () => now);
}

const filePath = (): string => join(tmpDir, 'mc-accounts.json');

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mc-accounts-'));
  encryptionAvailable = true;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('AccountStore · §13.2 凭据加密', () => {
  it('无文件时返回空档案', async () => {
    expect(await store().list()).toEqual([]);
    expect(await store().current()).toBeNull();
  });

  it('⚠️ refresh token 落盘是密文（磁盘上搜不到明文）', async () => {
    const s = store();
    await s.upsert(ACC_A);
    const raw = readFileSync(filePath(), 'utf-8');
    expect(raw).not.toContain('REFRESH-TOKEN-ALPHA-0123456789');
    expect(raw).not.toContain('MC-ACCESS-TOKEN-ALPHA-0123456789');
    const parsed = JSON.parse(raw) as {
      accounts: { msRefreshToken: string; mcAccessToken: string }[];
    };
    expect(parsed.accounts[0]!.msRefreshToken).toMatch(/^enc:/);
    expect(parsed.accounts[0]!.mcAccessToken).toMatch(/^enc:/);
  });

  it('⚠️ 整个文件里没有任何 token 明文片段', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.upsert(ACC_B, { setActive: false });
    const raw = readFileSync(filePath(), 'utf-8');
    for (const secret of ['REFRESH-TOKEN-ALPHA-0123456789', 'REFRESH-TOKEN-BRAVO-0123456789']) {
      expect(raw).not.toContain(secret);
      expect(raw).not.toContain(secret.slice(0, 12));
    }
  });

  it('OS 加密不可用时**拒绝写入**（§13.2 fail-closed，不静默退化为明文）', async () => {
    encryptionAvailable = false;
    await expect(store().upsert(ACC_A)).rejects.toThrow(OS_ENCRYPTION_UNAVAILABLE);
    // 关键：磁盘上不能出现文件
    expect(existsSync(filePath())).toBe(false);
  });

  it('OS 加密不可用时 updateTokens 也拒绝', async () => {
    const s = store();
    await s.upsert(ACC_A);
    encryptionAvailable = false;
    await expect(
      s.updateTokens('853c80ef3c3749fdaa49938b674adae6', {
        msRefreshToken: 'NEW-REFRESH-TOKEN-0123456789',
        mcAccessToken: 'NEW-MC-TOKEN-0123456789',
        mcAccessTokenExpiresAt: 2_100_000_000_000,
      }),
    ).rejects.toThrow(OS_ENCRYPTION_UNAVAILABLE);
  });

  it('解密失败（跨机器迁移）→ 该账户 token 为空串，不崩溃', async () => {
    const s = store();
    await s.upsert(ACC_A);
    // 写入一段无法解密的 enc: 内容
    const raw = JSON.parse(readFileSync(filePath(), 'utf-8')) as {
      accounts: { msRefreshToken: string }[];
    };
    raw.accounts[0]!.msRefreshToken = 'enc:bm90LWEtcmVhbC1jaXBoZXI=';
    writeFileSync(filePath(), JSON.stringify(raw), 'utf-8');
    const loaded = await s.list();
    expect(loaded[0]!.msRefreshToken).toBe('');
    expect(loaded[0]!.username).toBe('jeb_');
  });
});

describe('AccountStore · 多账户并存与切换', () => {
  it('两个账户可并存（各自的 token 互不串）', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.upsert(ACC_B, { setActive: false });
    const all = await s.list();
    expect(all).toHaveLength(2);
    const a = all.find((x) => x.username === 'jeb_')!;
    const b = all.find((x) => x.username === 'Notch')!;
    expect(a.msRefreshToken).toBe(ACC_A.msRefreshToken);
    expect(b.msRefreshToken).toBe(ACC_B.msRefreshToken);
    expect(a.id).toBe('853c80ef3c3749fdaa49938b674adae6');
  });

  it('重复登录同一账户是幂等覆盖（不产生重复条目）', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.upsert({ ...ACC_A, msRefreshToken: 'REFRESH-TOKEN-ALPHA2-0123456789' });
    const all = await s.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.msRefreshToken).toBe('REFRESH-TOKEN-ALPHA2-0123456789');
  });

  it('current() 默认返回最近登录的（upsert 默认 setActive）', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.upsert(ACC_B);
    expect((await s.current())!.username).toBe('Notch');
  });

  it('switchTo 切到指定账户并持久化', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.upsert(ACC_B, { setActive: false });
    const switched = await s.switchTo('853c80ef3c3749fdaa49938b674adae6');
    expect(switched.username).toBe('jeb_');
    // 新进程读回来仍然是切换后的
    expect((await store().current())!.username).toBe('jeb_');
  });

  it('switchTo 接受带连字符的 UUID', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.upsert(ACC_B, { setActive: false });
    const switched = await s.switchTo('853c80ef-3c37-49fd-aa49-938b674adae6');
    expect(switched.id).toBe('853c80ef3c3749fdaa49938b674adae6');
  });

  it('switchTo 不存在的账户 → 抛错（不静默失败）', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await expect(s.switchTo('ffffffffffff4f9f9f9f9f9f9f9f9f9f9f9f9f9')).rejects.toThrow(
      /账户不存在/,
    );
  });

  it('remove 当前账户后 activeId 顺延', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.upsert(ACC_B, { setActive: false });
    await s.switchTo('853c80ef3c3749fdaa49938b674adae6');
    await s.remove('853c80ef3c3749fdaa49938b674adae6');
    const left = await s.list();
    expect(left).toHaveLength(1);
    expect((await s.current())!.username).toBe('Notch');
  });

  it('remove 唯一账户 → current() 为 null', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await s.remove(ACC_A.uuid);
    expect(await s.current()).toBeNull();
  });

  it('remove 不存在的 id 是幂等的（不抛）', async () => {
    const s = store();
    await s.upsert(ACC_A);
    await expect(s.remove('ffffffffffff4f9f9f9f9f9f9f9f9f9f9f9f9f9')).resolves.toBeUndefined();
  });
});

describe('AccountStore · 刷新窗口', () => {
  it('距过期 > 5min 视为新鲜（不发刷新请求）', () => {
    const now = 1_000_000_000_000;
    const s = new AccountStore(join(tmpDir, 'x.json'), () => now);
    const acc: StoredAccount = {
      id: 'a',
      username: 'u',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'r',
      mcAccessToken: 'm',
      mcAccessTokenExpiresAt: now + TOKEN_REFRESH_SKEW_MS + 1000,
      capes: [],
      hasMinecraftProfile: true,
      addedAt: now,
      lastUsedAt: now,
    };
    expect(s.isTokenFresh(acc)).toBe(true);
  });

  it('距过期 <= 5min 视为需刷新', () => {
    const now = 1_000_000_000_000;
    const s = new AccountStore(join(tmpDir, 'x.json'), () => now);
    const acc: StoredAccount = {
      id: 'a',
      username: 'u',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'r',
      mcAccessToken: 'm',
      mcAccessTokenExpiresAt: now + TOKEN_REFRESH_SKEW_MS - 1,
      capes: [],
      hasMinecraftProfile: true,
      addedAt: now,
      lastUsedAt: now,
    };
    expect(s.isTokenFresh(acc)).toBe(false);
  });
});

describe('AccountStore · 输入校验与损坏文件', () => {
  it('UUID 形状非法 → 拒绝入库', async () => {
    await expect(store().upsert({ ...ACC_A, uuid: 'jeb_' })).rejects.toThrow(/不是合法的/);
  });

  it('refresh token 为空 → 拒绝入库（否则永远无法续期）', async () => {
    await expect(store().upsert({ ...ACC_A, msRefreshToken: '' })).rejects.toThrow(/refresh token/);
  });

  it('文件损坏（非法 JSON）→ 空档案，不崩', async () => {
    writeFileSync(filePath(), '{ not json', 'utf-8');
    expect(await store().list()).toEqual([]);
  });

  it('版本不认识 → 视为空（不猜着解析）', async () => {
    writeFileSync(
      filePath(),
      JSON.stringify({ version: 99, activeId: 'x', accounts: [{ id: 'y' }] }),
      'utf-8',
    );
    expect(await store().list()).toEqual([]);
  });

  it('账户条目字段类型不对 → 该字段退化为默认值而不是崩', async () => {
    writeFileSync(
      filePath(),
      JSON.stringify({
        version: ACCOUNTS_FILE_VERSION,
        activeId: 'a',
        accounts: [{ id: 'a', username: 42, mcAccessTokenExpiresAt: 'soon', capes: 'no' }],
      }),
      'utf-8',
    );
    const [acc] = await store().list();
    expect(acc!.username).toBe('');
    expect(acc!.mcAccessTokenExpiresAt).toBe(0);
    expect(acc!.capes).toEqual([]);
  });
});

describe('AccountStore · summaries（给 UI，绝不含 token）', () => {
  it('摘要里没有 token 字段，且带 activeCapeUrl / tokenFresh', async () => {
    const s = store(1_000_000_000_000);
    await s.upsert({ ...ACC_A, mcAccessTokenExpiresAt: 1_000_000_000_000 + 10 * 60_000 });
    const [summary] = await s.summaries();
    expect(Object.keys(summary!).sort()).toEqual(
      [
        'activeCapeUrl',
        'hasMinecraftProfile',
        'id',
        'lastUsedAt',
        'tokenFresh',
        'username',
        'uuid',
      ].sort(),
    );
    expect(summary!.activeCapeUrl).toBe('https://textures.minecraft.net/texture/cape1');
    expect(summary!.tokenFresh).toBe(true);
    // 值里也不能出现 token
    expect(JSON.stringify(summary)).not.toContain('REFRESH-TOKEN');
  });

  it('无 ACTIVE 披风时 activeCapeUrl 为 null', async () => {
    await store().upsert(ACC_B);
    const [summary] = await store().summaries();
    expect(summary!.activeCapeUrl).toBeNull();
  });
});
