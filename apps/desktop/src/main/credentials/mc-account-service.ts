/**
 * §5.8 账户：微软 access token → **Minecraft 服务端账户**。
 *
 * ## 链路（每一步都是必需的，缺一不可）
 *
 * ```
 * MS OAuth access token
 *   └─(1) POST user.auth.xboxlive.com/user/authenticate   (RPS, RelyingParty=http://auth.xboxlive.com)
 *        └─ XBL Token + uhs
 *   └─(2) POST xsts.auth.xboxlive.com/xsts/authorize      (RelyingParty=rp://api.minecraftservices.com/)
 *        └─ XSTS Token + uhs
 *   └─(3) POST api.minecraftservices.com/authentication/login_with_xbox
 *        └─ identityToken = "XBL3.0 x=<uhs>;<XSTS Token>"
 *        └─ Minecraft access token  ← 这个才是进游戏用的
 *   └─(4) GET  api.minecraftservices.com/entitlements/mcstore   （是否拥有 / Game Pass）
 *   └─(5) GET  api.minecraftservices.com/minecraft/profile      （UUID + 玩家名 + 皮肤 + 披风）
 * ```
 *
 * ## ⚠️ 最常见的实现错误：拿 XBox 账号名当玩家名
 *
 * 第 (1)(2) 步能拿到的 `uhs` 是 **Xbox 用户哈希**，`xid` 是 **XUID**（Xbox 数字 ID），
 * **都不是玩家名**。Minecraft Java 版的玩家名与 UUID **只**来自第 (5) 步的
 * `GET /minecraft/profile`（返回 `{ id, name, skins, capes }`）。
 * 用 XBox 昵称当 `--username` 会得到「正版验证失败 / 皮肤对不上」这类
 * 极难自查的问题。本模块把 `id`/`name` 的来源**唯一化**在 `fetchMinecraftProfile`。
 *
 * ## 披风（Cape）—— 现状核实结论
 *
 * 历史上确实下线过一批公开的 cape 查询端点（`api.mojang.com`、
 * `sessionserver.mojang.com/session/minecraft/profile/<uuid>` 的无鉴权用法），
 * 但**官方 cape 数据本身没有下线**：现代端点
 * `GET api.minecraftservices.com/minecraft/profile`（**需 Bearer Minecraft
 * access token**）的响应里就带 `capes: [{ id, state, url, alias }]`，
 * `state === 'ACTIVE'` 表示游戏里正在穿的那件。
 *
 * 因此本模块**不造**一个独立的 cape 客户端，而是从**自己的 profile** 响应里
 * 读 cape —— 这既是真的（同一个端点），也天然满足 §5.8「披风仅正版」：
 * 该端点必须持正版链路的 token 才能访问。
 *
 * **已知限制（如实记录）**：这个端点只能查**当前登录账号自己**的 cape。
 * 查**任意玩家**的 cape 没有可用的官方鉴权端点（旧的公开 session server
 * 已被弃用）。本项目的使用场景（启动器显示当前账号的披风）不受影响。
 *
 * ## 无 profile 的账号
 *
 * `GET /minecraft/profile` 对「拥有游戏但从未创建 Java 版档案」的账号返回
 * **404**（文档里部分端点用 204 表示同一件事，本模块两种都当「无档案」）。
 * 典型场景：刚买了 Java 版还没进过游戏、或只有 Game Pass 未激活档案。
 * 行为：返回 `null`（**不抛错**），调用方给出「请先启动一次官方客户端
 * 完成档案创建」的可执行提示，**不会崩**。
 */

import { SecretScrubber } from './token-redact.js';

export const XBL_USER_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
export const XBL_XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
export const MC_LOGIN_WITH_XBOX_URL =
  'https://api.minecraftservices.com/authentication/login_with_xbox';
export const MC_ENTITLEMENTS_URL = 'https://api.minecraftservices.com/entitlements/mcstore';
export const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';

/** XSTS 401 的 `X-Err` 码 → 可执行的中文提示。 */
const XSTS_ERROR_HINTS: Record<number, string> = {
  2148916233: '该微软账户没有 Xbox 档案（通常是未成年人账户，需家长在 Xbox 网页上开通）',
  2148916238: '该账户所在国家/地区不受支持，或账户没有任何 Xbox 会员',
  2148916231: '该账户存在 Xbox 限制（如未验证邮箱）',
  2148916235: '该账户未通过 Xbox 安全检查，请先在浏览器登录一次 Xbox',
};

export type McAccountErrorCode =
  | 'xbl_auth_failed'
  | 'xsts_denied'
  | 'xsts_unsupported_region'
  | 'mc_login_failed'
  | 'mc_token_rejected'
  | 'network'
  | 'invalid_response';

export class McAccountError extends Error {
  constructor(
    readonly code: McAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McAccountError';
  }
}

/** 拥有权判定。Game Pass 也算「能进游戏」，所以不因为空 items 直接拒绝。 */
export interface McEntitlements {
  /** 有 `product_minecraft` / `game_minecraft` 之类的条目（买断或 Game Pass）。 */
  readonly ownsMinecraft: boolean;
  /** 只看到 `*_bedrock` 条目：只有基岩版，进不了 Java 版。 */
  readonly bedrockOnly: boolean;
  /** 服务端返回的条目名（诊断用，不含敏感信息）。 */
  readonly productNames: readonly string[];
}

export interface McCape {
  readonly capeId: string;
  /** 该件披风的图片直链（`textures.minecraft.net` CDN）。 */
  readonly imageUrl: string;
  /** 游戏内是否正在穿戴。 */
  readonly active: boolean;
  readonly alias: string | null;
}

export interface McProfile {
  /** 带连字符的 UUID（`853c80ef-3c37-49fd-aa49-938b674adae6`）—— 启动参数 `--uuid` 就用它。 */
  readonly id: string;
  /** Minecraft 玩家名 —— 启动参数 `--username` 就用它。**不是** XBox 昵称。 */
  readonly name: string;
  readonly capes: readonly McCape[];
  readonly skinUrl: string | null;
}

/** 把带连字符的 UUID 规范成无连字符（小写）。存档键用。 */
export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

/** 校验是 UUID 形状（防止把用户名当 id 存进账户表）。 */
export function isUuidLike(value: string): boolean {
  return /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(
    value,
  );
}

interface XuiClaim {
  uhs?: unknown;
  xid?: unknown;
}

function readUhs(body: { DisplayClaims?: { xui?: unknown } }): string {
  const xui = body.DisplayClaims?.xui;
  if (!Array.isArray(xui) || xui.length === 0) {
    throw new McAccountError('invalid_response', 'Xbox 响应缺少 DisplayClaims.xui（uhs）');
  }
  const first = xui[0] as XuiClaim;
  if (typeof first?.uhs !== 'string' || first.uhs === '') {
    throw new McAccountError('invalid_response', 'Xbox 响应缺少 uhs（用户哈希）');
  }
  return first.uhs;
}

/**
 * 所有出错的 message 都过一遍 scrubber。
 *
 * 这不是装饰：XBL/XSTS 的 401 响应体带 `X-Err` / `X-Msg`，
 * 而 `login_with_xbox` 的错误体在账号被封（`ACCOUNT_SUSPENDED`）时会回显
 * 请求里的 `identityToken` —— 那里面就有 XSTS token。
 * 不统一过一遍，异常信息就带着 token 进了日志（§13.2）。
 */
function fail(scrubber: SecretScrubber, code: McAccountErrorCode, message: string): McAccountError {
  return new McAccountError(code, scrubber.scrub(message));
}

async function readJson(
  res: Response,
  scrubber: SecretScrubber,
  what: string,
): Promise<Record<string, unknown>> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw fail(scrubber, 'invalid_response', `${what} 返回了非 JSON 响应（HTTP ${res.status}）`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw fail(scrubber, 'invalid_response', `${what} 返回的不是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  scrubber: SecretScrubber,
  what: string,
): Promise<{ res: Response; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw fail(scrubber, 'network', `${what} 网络错误：${(e as Error).name}`);
  }
  const json = await readJson(res, scrubber, what);
  return { res, json };
}

/** (1) MS token → XBL token + uhs */
export async function authenticateXboxLive(
  fetchImpl: typeof fetch,
  msAccessToken: string,
  scrubber: SecretScrubber,
): Promise<{ token: string; uhs: string }> {
  const { res, json } = await postJson(
    fetchImpl,
    XBL_USER_AUTH_URL,
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
    // XBL 要求 RPS 票据同时出现在 body 与 Authorization 头里。
    { Authorization: `d=${msAccessToken}` },
    scrubber,
    'Xbox Live 认证',
  );
  if (!res.ok) {
    throw fail(
      scrubber,
      'xbl_auth_failed',
      `Xbox Live 认证失败（HTTP ${res.status}）：微软 access token 无效或已过期。`,
    );
  }
  const token = json['Token'];
  if (typeof token !== 'string' || token === '') {
    throw fail(scrubber, 'invalid_response', 'Xbox Live 响应缺少 Token');
  }
  return { token, uhs: readUhs(json as { DisplayClaims?: { xui?: unknown } }) };
}

/** (2) XBL token → XSTS token + uhs */
export async function authorizeXsts(
  fetchImpl: typeof fetch,
  xblToken: string,
  xblUhs: string,
  scrubber: SecretScrubber,
): Promise<{ token: string; uhs: string }> {
  const { res, json } = await postJson(
    fetchImpl,
    XBL_XSTS_URL,
    {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    },
    { Authorization: `XBL3.0 x=${xblUhs};${xblToken}` },
    scrubber,
    'Xbox 安全令牌(XSTS)签发',
  );
  if (!res.ok) {
    const xErr = Number(res.headers.get('x-err') ?? '0');
    const reason = scrubber.scrub(res.headers.get('x-msg') ?? '');
    if (xErr === 2148916238) {
      throw fail(
        scrubber,
        'xsts_unsupported_region',
        'XSTS 拒绝：该账户所在国家/地区不受支持，或账户没有任何 Xbox 会员。',
      );
    }
    const hint = XSTS_ERROR_HINTS[xErr];
    throw fail(
      scrubber,
      'xsts_denied',
      `XSTS 拒绝该账户${hint === undefined ? '' : `：${hint}`}` +
        `${reason === '' ? (xErr === 0 ? '' : `（X-Err=${xErr}）`) : `（X-Err=${xErr} ${reason}）`}`,
    );
  }
  const token = json['Token'];
  if (typeof token !== 'string' || token === '') {
    throw fail(scrubber, 'invalid_response', 'XSTS 响应缺少 Token');
  }
  return { token, uhs: readUhs(json as { DisplayClaims?: { xui?: unknown } }) };
}

/** (3) XSTS token → Minecraft access token */
export async function loginMinecraft(
  fetchImpl: typeof fetch,
  xstsToken: string,
  uhs: string,
  scrubber: SecretScrubber,
): Promise<{ accessToken: string; expiresAt: number }> {
  const { res, json } = await postJson(
    fetchImpl,
    MC_LOGIN_WITH_XBOX_URL,
    { identityToken: `XBL3.0 x=${uhs};${xstsToken}` },
    {},
    scrubber,
    'Minecraft 登录',
  );
  const accessToken = json['access_token'];
  if (!res.ok || typeof accessToken !== 'string' || accessToken === '') {
    const msg = typeof json['errorMessage'] === 'string' ? json['errorMessage'] : '';
    throw fail(
      scrubber,
      'mc_login_failed',
      `Minecraft 登录失败（HTTP ${res.status}）${msg === '' ? '' : `：${msg}`}`,
    );
  }
  const expiresIn = typeof json['expires_in'] === 'number' ? json['expires_in'] : 86400;
  return { accessToken, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
}

/** (4) 是否拥有 Java 版（买断 / Game Pass）。只读，不阻断登录。 */
export async function fetchEntitlements(
  fetchImpl: typeof fetch,
  mcAccessToken: string,
  scrubber: SecretScrubber,
): Promise<McEntitlements> {
  let res: Response;
  try {
    res = await fetchImpl(MC_ENTITLEMENTS_URL, {
      headers: { Authorization: `Bearer ${mcAccessToken}`, Accept: 'application/json' },
    });
  } catch (e) {
    throw fail(scrubber, 'network', `查询购买状态网络错误：${(e as Error).name}`);
  }
  // 401/403 = token 失效（不是「没买」），必须与「没买」区分开。
  if (res.status === 401 || res.status === 403) {
    throw fail(
      scrubber,
      'mc_token_rejected',
      `购买状态查询被拒（HTTP ${res.status}）：Minecraft token 已失效，需重新登录`,
    );
  }
  // 购买状态是**旁路**信息：拿不到就按「未知」处理，不能因此让整次登录失败。
  const itemsUnknown = await readJson(res, scrubber, '购买状态').catch(
    () => ({}) as Record<string, unknown>,
  );
  const items = Array.isArray(itemsUnknown['items']) ? itemsUnknown['items'] : [];
  const names = items
    .map((it) => {
      const name = (it as { name?: unknown } | null)?.name;
      return typeof name === 'string' ? name : '';
    })
    .filter((n) => n !== '');
  const java = names.some(
    (n) => n === 'product_minecraft' || n === 'game_minecraft' || !n.endsWith('_bedrock'),
  );
  return {
    ownsMinecraft: java,
    bedrockOnly: names.length > 0 && !java,
    productNames: names,
  };
}

interface RawTexture {
  id?: unknown;
  state?: unknown;
  url?: unknown;
  alias?: unknown;
}

/** 从自己的 profile 响应里读 cape（§5.8：披风仅正版，因为该端点必须持正版 token）。 */
export function readCapes(profile: Record<string, unknown>): McCape[] {
  const raw = profile['capes'];
  if (!Array.isArray(raw)) return [];
  const out: McCape[] = [];
  for (const item of raw) {
    const c = item as RawTexture;
    if (typeof c?.id !== 'string' || c.id === '') continue;
    if (typeof c.url !== 'string' || c.url === '') continue;
    out.push({
      capeId: c.id,
      imageUrl: c.url,
      active: c.state === 'ACTIVE',
      alias: typeof c.alias === 'string' ? c.alias : null,
    });
  }
  return out;
}

function readSkins(profile: Record<string, unknown>): string | null {
  const raw = profile['skins'];
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    const s = item as RawTexture;
    if (s?.state === 'ACTIVE' && typeof s.url === 'string') return s.url;
  }
  return null;
}

/**
 * (5) 取 Minecraft 服务端档案。
 *
 * **返回 `null` 表示「该账号没有 Java 版档案」**（刚买 / 只有 Game Pass /
 * 从未进过游戏），不是错误。调用方必须自己给出可执行的提示文案。
 */
export async function fetchMinecraftProfile(
  fetchImpl: typeof fetch,
  mcAccessToken: string,
  scrubber: SecretScrubber,
): Promise<McProfile | null> {
  let res: Response;
  try {
    res = await fetchImpl(MC_PROFILE_URL, {
      headers: { Authorization: `Bearer ${mcAccessToken}`, Accept: 'application/json' },
    });
  } catch (e) {
    throw fail(scrubber, 'network', `查询 Minecraft 档案网络错误：${(e as Error).name}`);
  }
  if (res.status === 404 || res.status === 204) {
    // 官方文档：部分端点用 204 表示「该 UUID 没有关联玩家」。
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    throw fail(
      scrubber,
      'mc_token_rejected',
      `Minecraft 档案查询被拒（HTTP ${res.status}）：token 已过期或无效，需重新登录`,
    );
  }
  const json = await readJson(res, scrubber, 'Minecraft 档案');
  const id = json['id'];
  const name = json['name'];
  if (typeof id !== 'string' || !isUuidLike(id)) {
    throw fail(scrubber, 'invalid_response', 'Minecraft 档案响应缺少合法 id 字段');
  }
  if (typeof name !== 'string' || name === '') {
    throw fail(scrubber, 'invalid_response', 'Minecraft 档案响应缺少 name 字段');
  }
  return { id, name, capes: readCapes(json), skinUrl: readSkins(json) };
}
