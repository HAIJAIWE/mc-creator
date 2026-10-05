/**
 * §5.8 账户：**多账户并存与切换**；§13.2 凭据：**OS 级加密**落盘。
 *
 * ## 存什么、怎么存
 *
 * 磁盘文件 `userData/mc-accounts.json`：
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "activeId": "853c80ef3c3749fdaa49938b674adae6",   // 无连字符的 profile UUID
 *   "accounts": [
 *     {
 *       "id": "853c80ef3c3749fdaa49938b674adae6",
 *       "username": "jeb_",                  // Minecraft 玩家名（不是 XBox 昵称）
 *       "uuid": "853c80ef-3c37-49fd-aa49-938b674adae6",  // 启动用（带连字符）
 *       "msRefreshToken": "enc:...",         // §13.2：OS 加密
 *       "mcAccessToken": "enc:...",          // §13.2：OS 加密
 *       "mcAccessTokenExpiresAt": 1730000000000,
 *       "capes": [ { "capeId": "...", "imageUrl": "...", "active": true, "alias": null } ],
 *       "hasMinecraftProfile": true,
 *       "addedAt": 1730000000000,
 *       "lastUsedAt": 1730000000000
 *     }
 *   ]
 * }
 * ```
 *
 * **加密复用 `secret-storage.ts` 的 `encryptSecret`/`decryptSecret`**
 * （本仓已有的 safeStorage 封装），不重造。
 *
 * ## ⚠️ 与 `safeStorage.isEncryptionAvailable() === false` 的取舍
 *
 * `encryptSecret` 在 OS 不支持加密时**静默退化为明文**。对 API Key 来说
 * 「拿不到加密就明文存」是可接受的降级（用户还能用），但对
 * **OAuth refresh token** 不可接受：§13.2 明写「禁止明文落 json」，
 * 而一个能续期的 refresh token 泄露 = 账号被长期接管。
 *
 * 因此本模块**比 `encryptSecret` 更严**：写入前检查加密可用性，
 * 不可用时**拒绝写入**（fail-closed）并抛明确错误，让用户知道
 * 「这台机器上无法安全保存微软账户」，而不是静默把 token 写进明文 json。
 * 读取侧保持宽松：解密失败返回空串（与 `decryptSecret` 一致），
 * 让上层把该账户判为「需重新登录」而不是崩溃。
 *
 * ## 为什么以 refresh token 为主凭据
 *
 * Minecraft access token（`login_with_xbox` 的产物）有效期约 24h 且
 * **没有独立的 refresh 端点**：官方续期方式是用 **OAuth refresh token**
 * 重跑 XBL→XSTS→Minecraft 整条链。所以「长期凭据」是 OAuth refresh token，
 * 它才是必须加密落盘的那一个；MC access token 也一并加密，
 * 避免明文 token 出现在磁盘上（哪怕它 24h 就过期）。
 */

import { readFile } from 'node:fs/promises';
import { safeStorage } from 'electron';
import { writeFileAtomic } from '@mc-creator/shell';
import { decryptSecret, encryptSecret } from './secret-storage.js';
import { isUuidLike, normalizeUuid, type McCape } from './mc-account-service.js';

/** 存档格式版本。读到的版本不认识 → 视为空（不猜着解析）。 */
export const ACCOUNTS_FILE_VERSION = 1;

export const OS_ENCRYPTION_UNAVAILABLE =
  '当前系统不支持 OS 级凭据加密（Electron safeStorage 不可用），' +
  '按 §13.2「禁止明文落 json」拒绝保存微软账户 token。' +
  '请在系统上启用凭据存储（如 Windows DPAPI / macOS Keychain / libsecret）后重试。';

/** 内存里的账户（token **已解密**）。绝不整体落盘。 */
export interface StoredAccount {
  /** 无连字符的 profile UUID —— 账户主键。 */
  readonly id: string;
  readonly username: string;
  /** 带连字符的 UUID（启动参数 `--uuid` 用）。 */
  readonly uuid: string;
  /** 已解密的 OAuth refresh token（长期凭据）。 */
  readonly msRefreshToken: string;
  /** 已解密的 Minecraft access token。 */
  readonly mcAccessToken: string;
  readonly mcAccessTokenExpiresAt: number;
  readonly capes: readonly McCape[];
  /** false = 拥有微软账户但没有 Java 版档案（刚买 / 只有 Game Pass）。 */
  readonly hasMinecraftProfile: boolean;
  readonly addedAt: number;
  readonly lastUsedAt: number;
}

/** 给 UI 用的账户摘要。**结构上就没有 token 字段** —— §13.2 的第一道防线。 */
export interface AccountSummary {
  readonly id: string;
  readonly username: string;
  readonly uuid: string;
  readonly hasMinecraftProfile: boolean;
  readonly activeCapeUrl: string | null;
  readonly lastUsedAt: number;
  /** token 是否仍然新鲜（false = 启动前需要刷新）。 */
  readonly tokenFresh: boolean;
}

/** 磁盘上的形态：字段全是 `unknown`，必须逐字段校验后再用。 */
interface PersistedAccount {
  id?: unknown;
  username?: unknown;
  uuid?: unknown;
  msRefreshToken?: unknown;
  mcAccessToken?: unknown;
  mcAccessTokenExpiresAt?: unknown;
  capes?: unknown;
  hasMinecraftProfile?: unknown;
  addedAt?: unknown;
  lastUsedAt?: unknown;
}

interface PersistedFile {
  version: number;
  activeId: string | null;
  accounts: PersistedAccount[];
}

/** 读盘后的形态（已解密）。`activeId` 可变：切换账户时改它。 */
export interface AccountFile {
  readonly version: number;
  activeId: string | null;
  readonly accounts: StoredAccount[];
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function parseCapes(v: unknown): McCape[] {
  if (!Array.isArray(v)) return [];
  const out: McCape[] = [];
  for (const item of v) {
    const c = item as Partial<McCape> | null;
    if (typeof c?.capeId !== 'string' || c.capeId === '') continue;
    if (typeof c.imageUrl !== 'string' || c.imageUrl === '') continue;
    out.push({
      capeId: c.capeId,
      imageUrl: c.imageUrl,
      active: c.active === true,
      alias: typeof c.alias === 'string' ? c.alias : null,
    });
  }
  return out;
}

/** 启动前多久刷新 token（避免游戏刚起来 token 就过期）。 */
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

function emptyFile(): AccountFile {
  return { version: ACCOUNTS_FILE_VERSION, activeId: null, accounts: [] };
}

export class AccountStore {
  /**
   * @param filePath `userData/mc-accounts.json` 的完整路径（测试注入临时目录）。
   */
  constructor(
    readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** token 是否还能直接用（未进入刷新窗口）。 */
  isTokenFresh(account: StoredAccount): boolean {
    return account.mcAccessTokenExpiresAt - TOKEN_REFRESH_SKEW_MS > this.now();
  }

  /**
   * 拒绝在 OS 加密不可用时写入 token（§13.2 fail-closed）。
   *
   * 单独抽成方法，测试才能直接断言这条不变量，而不用去 mock 整条写入路径。
   */
  private assertCanEncrypt(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(OS_ENCRYPTION_UNAVAILABLE);
    }
  }

  async load(): Promise<AccountFile> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedFile>;
      if (parsed.version !== ACCOUNTS_FILE_VERSION) {
        // 未知版本：宁可不读（返回空）也不要猜着解析出一个错的 token 状态。
        return emptyFile();
      }
      const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
      return {
        version: ACCOUNTS_FILE_VERSION,
        activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
        // 解密在此完成：解密失败（跨机器迁移）时 decryptSecret 返回空串，
        // 上层会把该账户判为「需重新登录」而不是崩。
        accounts: accounts.map((a) => this.deserialize(a)),
      };
    } catch {
      // 文件不存在 / 损坏 → 空档案。首次启动本来就是这个路径。
      return emptyFile();
    }
  }

  private deserialize(a: PersistedAccount): StoredAccount {
    const uuid = str(a.uuid);
    return {
      id: str(a.id, normalizeUuid(uuid)),
      username: str(a.username),
      uuid,
      msRefreshToken: decryptSecret(str(a.msRefreshToken)),
      mcAccessToken: decryptSecret(str(a.mcAccessToken)),
      mcAccessTokenExpiresAt: num(a.mcAccessTokenExpiresAt),
      capes: parseCapes(a.capes),
      hasMinecraftProfile: bool(a.hasMinecraftProfile),
      addedAt: num(a.addedAt),
      lastUsedAt: num(a.lastUsedAt),
    };
  }

  private serialize(a: StoredAccount): PersistedAccount {
    return {
      id: a.id,
      username: a.username,
      uuid: a.uuid,
      // §13.2：token 一律走 safeStorage，明文不落 json。
      msRefreshToken: encryptSecret(a.msRefreshToken),
      mcAccessToken: encryptSecret(a.mcAccessToken),
      mcAccessTokenExpiresAt: a.mcAccessTokenExpiresAt,
      capes: a.capes.map((c) => ({ ...c })),
      hasMinecraftProfile: a.hasMinecraftProfile,
      addedAt: a.addedAt,
      lastUsedAt: a.lastUsedAt,
    };
  }

  private async persist(file: AccountFile): Promise<void> {
    const out: PersistedFile = {
      version: ACCOUNTS_FILE_VERSION,
      activeId: file.activeId,
      accounts: file.accounts.map((a) => this.serialize(a)),
    };
    await writeFileAtomic(this.filePath, JSON.stringify(out, null, 2));
  }

  /** 全部账户（多账户并存）。 */
  async list(): Promise<StoredAccount[]> {
    return (await this.load()).accounts;
  }

  /** 当前选中的账户。没有 activeId 或指向已删除账户时回退到第一个。 */
  async current(): Promise<StoredAccount | null> {
    const file = await this.load();
    if (file.accounts.length === 0) return null;
    const active =
      file.activeId === null ? null : (file.accounts.find((a) => a.id === file.activeId) ?? null);
    return active ?? file.accounts[0] ?? null;
  }

  /**
   * 新增或更新一个账户（同 UUID 覆盖 → 天然幂等，重复登录不会产生重复条目）。
   *
   * @param opts.setActive 登录成功后应切到这个账户（默认 true）。
   */
  async upsert(
    account: Omit<StoredAccount, 'id' | 'addedAt' | 'lastUsedAt'>,
    opts: { setActive?: boolean } = {},
  ): Promise<StoredAccount> {
    if (!isUuidLike(account.uuid)) {
      throw new Error(`不是合法的 Minecraft UUID，拒绝入库：${account.uuid}`);
    }
    if (account.msRefreshToken === '') {
      throw new Error('OAuth refresh token 为空，拒绝入库（否则账户永远无法续期）');
    }
    this.assertCanEncrypt();
    const file = await this.load();
    const id = normalizeUuid(account.uuid);
    const now = this.now();
    const existing = file.accounts.find((a) => a.id === id);
    const next: StoredAccount = {
      ...account,
      id,
      addedAt: existing?.addedAt ?? now,
      lastUsedAt: now,
    };
    const idx = file.accounts.findIndex((a) => a.id === id);
    if (idx >= 0) file.accounts[idx] = next;
    else file.accounts.push(next);
    if (opts.setActive !== false) file.activeId = id;
    await this.persist(file);
    return next;
  }

  /** 切换当前账户。目标不存在 → 抛错（不静默失败）。 */
  async switchTo(id: string): Promise<StoredAccount> {
    const file = await this.load();
    const key = normalizeUuid(id);
    const idx = file.accounts.findIndex((a) => a.id === key);
    const target = file.accounts[idx];
    if (target === undefined) {
      throw new Error(`账户不存在，无法切换：${id}`);
    }
    file.activeId = key;
    const next: StoredAccount = { ...target, lastUsedAt: this.now() };
    file.accounts[idx] = next;
    await this.persist(file);
    return next;
  }

  /** 移除账户。若移除的是当前账户，activeId 顺延到剩下的第一个。 */
  async remove(id: string): Promise<void> {
    const file = await this.load();
    const key = normalizeUuid(id);
    const idx = file.accounts.findIndex((a) => a.id === key);
    if (idx < 0) return;
    file.accounts.splice(idx, 1);
    if (file.activeId === key) file.activeId = file.accounts[0]?.id ?? null;
    await this.persist(file);
  }

  /** 只更新 token 与 cape（刷新后调用），不碰其它字段。 */
  async updateTokens(
    id: string,
    update: {
      msRefreshToken: string;
      mcAccessToken: string;
      mcAccessTokenExpiresAt: number;
      capes?: readonly McCape[] | undefined;
      hasMinecraftProfile?: boolean | undefined;
    },
  ): Promise<StoredAccount> {
    this.assertCanEncrypt();
    const file = await this.load();
    const key = normalizeUuid(id);
    const idx = file.accounts.findIndex((a) => a.id === key);
    const existing = file.accounts[idx];
    if (existing === undefined) throw new Error(`账户不存在：${id}`);
    const next: StoredAccount = {
      ...existing,
      msRefreshToken: update.msRefreshToken,
      mcAccessToken: update.mcAccessToken,
      mcAccessTokenExpiresAt: update.mcAccessTokenExpiresAt,
      capes: update.capes ?? existing.capes,
      hasMinecraftProfile: update.hasMinecraftProfile ?? existing.hasMinecraftProfile,
      lastUsedAt: this.now(),
    };
    file.accounts[idx] = next;
    await this.persist(file);
    return next;
  }

  /** 给 UI 的摘要列表：按 lastUsedAt 倒序，且**不含 token**。 */
  async summaries(): Promise<AccountSummary[]> {
    const file = await this.load();
    return [...file.accounts]
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((a) => ({
        id: a.id,
        username: a.username,
        uuid: a.uuid,
        hasMinecraftProfile: a.hasMinecraftProfile,
        activeCapeUrl: a.capes.find((c) => c.active)?.imageUrl ?? null,
        lastUsedAt: a.lastUsedAt,
        tokenFresh: this.isTokenFresh(a),
      }));
  }
}
