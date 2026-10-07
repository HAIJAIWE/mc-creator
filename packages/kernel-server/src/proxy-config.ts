/**
 * 代理层配置（设计文档 §7.2 代理层：Velocity / BungeeCord / Waterfall）。
 *
 * ## 为什么单独一个模块
 *
 * 代理配置是**三种互不兼容的外部格式**，与本仓 server.properties 无关：
 *
 * | 形态 | 文件 | 格式 | 路由表 | 路由顺序 |
 * |---|---|---|---|---|
 * | velocity | `velocity.toml` | TOML | `[servers]` 顶层 `name = "host:port"` | 顶层 `try = [...]` |
 * | bungeecord | `config.yml` | YAML | `servers.<name>.address` | `listeners[].priorities` |
 * | waterfall | `config.yml` | YAML | 同 bungeecord | 同 bungeecord |
 *
 * 键名依据（不是记忆，是核对过的出处）：
 * - Velocity：`https://docs.papermc.io/velocity/configuration`
 *   （官方文档明确 "Every Velocity file is stored in velocity.toml, located in the
 *   directory where you started the proxy. Velocity uses the TOML file format"，
 *   并列出 `servers` section、顶层 `try` Array、`bind`、`motd`、
 *   `show-max-players`、`online-mode`）
 * - BungeeCord：`https://www.spigotmc.org/wiki/bungeecord-configuration-guide/`
 *   （官方 wiki 贴出完整默认 `config.yml`，含 `listeners` 为**列表**、
 *   `servers.<n>.address`、`listeners[].priorities`、`ip_forward`、`online_mode`）
 * - waterfall：Waterfall 是 BungeeCord 的 fork，沿用同一 `config.yml` 格式；
 *   本模块不生成 waterfall 独有键（其独有键属实现细节，非 §7.2 要求）。
 *
 * ## 三条硬纪律
 *
 * 1. **不发明格式**。本仓曾用过一份自造的 `config.json`
 *    （`proxyType`/`port`/`bindAddress` 三个键都不是任何代理的真实键），
 *    那种产物代理根本不读。见 MEMORY §10-9「不猜着写代码」。
 * 2. **路由表是本体**。§7.2 对代理层的定义是「独立网络层，处理多子服路由」，
 *    所以 `servers` + `try`/`priorities` 是一等公民，不是可选项。
 * 3. **解析失败即抛，不做乐观回退**。手改过的配置解析不出来时必须报错，
 *    绝不返回半个字段（对照 kernel-bedrock/probe.ts「存在≠可读」的同一条纪律）。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** §7.2 代理层三种形态。顺序即 UI 展示顺序。 */
export const PROXY_TYPES = ['velocity', 'bungeecord', 'waterfall'] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

export function isProxyType(v: unknown): v is ProxyType {
  return typeof v === 'string' && (PROXY_TYPES as readonly string[]).includes(v);
}

/**
 * 该形态的真实配置文件名。
 *
 * 关键：velocity 用 TOML（`velocity.toml`），bungee/waterfall 用 YAML（`config.yml`）。
 * 两者**不能互换**——Velocity 只读 velocity.toml，文件名错了代理不会启动。
 */
export function proxyConfigFileName(type: ProxyType): 'velocity.toml' | 'config.yml' {
  return type === 'velocity' ? 'velocity.toml' : 'config.yml';
}

/** 一个后端子服（§7.2「多子服路由」的元素）。 */
export interface ProxyBackend {
  /** 路由名（velocity.toml 的 `[servers]` 键 / config.yml 的 `servers` 键）。 */
  name: string;
  /** `host:port` 地址。velocity 直接是字符串，bungee 是 `address` 字段。 */
  address: string;
}

/** 代理配置的统一视图（抹平三种格式的差异，供内核与 UI 消费）。 */
export interface ProxyConfigView {
  type: ProxyType;
  /** 监听地址 `host:port`。velocity=`bind`，bungee=`listeners[0].host`。 */
  bind: string;
  motd: string;
  maxPlayers: number;
  onlineMode: boolean;
  backends: ProxyBackend[];
  /** 路由顺序。velocity=`try`，bungee=`listeners[].priorities`。 */
  tryOrder: string[];
}

/** 生成配置用的输入。 */
export interface ProxyConfigSpec {
  type: ProxyType;
  /** 监听 `host:port`。 */
  bind: string;
  motd: string;
  maxPlayers: number;
  onlineMode: boolean;
  /** 多子服路由表（至少一个才像个代理；空表见 validateProxySpec）。 */
  backends: ProxyBackend[];
  /** 路由顺序；缺省用 backends 的声明顺序。 */
  tryOrder?: string[];
}

// ---------------------------------------------------------------------------
// 校验：地址 / 端口 / 重名 / 路由引用
// ---------------------------------------------------------------------------

/** `host:port`。host 可为 IPv4/IPv6 字面量或域名；port 1..65535。 */
export function parseAddress(address: string): { host: string; port: number } | undefined {
  // IPv6 字面量形如 [::1]:25577，必须先剥方括号再找最后一个冒号。
  const m = /^\[(.+)\]:(\d{1,5})$/.exec(address) ?? /^(.+):(\d{1,5})$/.exec(address);
  if (m === null) return undefined;
  const host = (m[1] ?? '').trim();
  const port = Number(m[2]);
  if (host === '' || host.includes(' ')) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host, port };
}

/** 路由名约束：非空、无空白、无 YAML/TOML 结构字符。 */
const ROUTE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * 生成前校验。返回全部问题（不是只报第一个），便于 UI 一次性呈现。
 *
 * 校验依据是「代理真会怎么读这份配置」：BungeeCord 官方 wiki 明确建议
 * server 名用小写；带 `:` 或空格的键在 YAML 里会破坏结构，故一并拒绝。
 */
export function validateProxySpec(spec: ProxyConfigSpec): string[] {
  const errors: string[] = [];
  if (!isProxyType(spec.type)) errors.push(`不支持的代理类型: ${String(spec.type)}`);
  if (parseAddress(spec.bind) === undefined) {
    errors.push(`bind 地址非法（需 host:port，端口 1-65535）: ${spec.bind}`);
  }
  if (spec.motd.trim() === '') errors.push('motd 不得为空');
  if (!Number.isInteger(spec.maxPlayers) || spec.maxPlayers < 0) {
    errors.push(`maxPlayers 非法（需 ≥ 0 的整数）: ${String(spec.maxPlayers)}`);
  }
  if (spec.backends.length === 0) {
    errors.push('至少需要一个后端子服：§7.2 代理层的职责是「处理多子服路由」');
  }
  const seen = new Set<string>();
  for (const b of spec.backends) {
    if (!ROUTE_NAME_RE.test(b.name)) {
      errors.push(`路由名非法（仅允许字母数字与 _ . - ，1-64 字符）: ${b.name}`);
    } else if (seen.has(b.name)) {
      errors.push(`路由名重复: ${b.name}`);
    }
    seen.add(b.name);
    if (parseAddress(b.address) === undefined) {
      errors.push(`后端 ${b.name} 地址非法（需 host:port，端口 1-65535）: ${b.address}`);
    }
  }
  const tryOrder = spec.tryOrder ?? spec.backends.map((b) => b.name);
  for (const name of tryOrder) {
    if (!seen.has(name)) errors.push(`路由顺序引用了未声明的子服: ${name}`);
  }
  if (tryOrder.length === 0) errors.push('路由顺序（try/priorities）不得为空');
  // 同一地址挂两个路由名会让 failover 失去意义，且通常是配错的信号。
  const byAddress = new Map<string, string>();
  for (const b of spec.backends) {
    const prev = byAddress.get(b.address);
    if (prev !== undefined) errors.push(`子服 ${b.name} 与 ${prev} 指向同一地址: ${b.address}`);
    byAddress.set(b.address, b.name);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 渲染：Velocity -> TOML
// ---------------------------------------------------------------------------

/** TOML 基本字符串转义（Velocity 的 motd 走 MiniMessage，常含引号与反斜杠）。 */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((v) => tomlString(v)).join(', ')}]`;
}

/**
 * 渲染 `velocity.toml`。
 *
 * 键名逐条对照官方文档的 root section 与 servers section：
 * `config-version` / `bind` / `motd` / `show-max-players` / `online-mode` /
 * `player-info-forwarding-mode` / `forwarding-secret-file`，
 * `[servers]` 下 `name = "host:port"`，顶层 `try = [...]`。
 */
export function renderVelocityToml(spec: ProxyConfigSpec): string {
  const tryOrder = spec.tryOrder ?? spec.backends.map((b) => b.name);
  const lines: string[] = [
    '# 由 MC 全链路 AI 工作台生成（§7.2 代理层）。',
    '# 键名依据 https://docs.papermc.io/velocity/configuration',
    'config-version = "2.7"',
    `bind = ${tomlString(spec.bind)}`,
    `motd = ${tomlString(spec.motd)}`,
    `show-max-players = ${spec.maxPlayers}`,
    `online-mode = ${spec.onlineMode ? 'true' : 'false'}`,
    // modern 转发需要后端开启 online-mode；offline（裂头）时必须退回 none，
    // 否则 Velocity 会等一个永不到来的转发握手。
    `player-info-forwarding-mode = ${spec.onlineMode ? '"modern"' : '"none"'}`,
    'forwarding-secret-file = "forwarding.secret"',
    // `try` 必须落在 [servers] 段**之前**：TOML 里进了段之后的裸键归属该段，
    // 放到段后会变成 `servers.try`，等于凭空多一个名叫 "try" 的后端。
    `try = ${tomlStringArray(tryOrder)}`,
    '',
    '[advanced]',
    'compression-threshold = 256',
    'connection-timeout = 5000',
    'read-timeout = 30000',
    'login-ratelimit = 3000',
    'haproxy-protocol = false',
    'tcp-fast-open = false',
    'show-ping-requests = true',
    'announce-proxy-commands = true',
    'enable-player-address-logging = true',
    '',
    '[servers]',
  ];
  for (const b of spec.backends) {
    lines.push(`${b.name} = ${tomlString(b.address)}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 渲染：BungeeCord / Waterfall -> YAML
// ---------------------------------------------------------------------------

/**
 * 渲染 `config.yml`（bungeecord / waterfall 共用）。
 *
 * 注意 BungeeCord 的路由顺序在 **`listeners[].priorities`**，不是顶层 `try`；
 * 且 `listeners` 是**列表**（可多端口监听），`servers.<n>` 是**带 address 的 map**。
 * 官方 wiki 默认配置原文即如此。
 */
export function renderBungeeYaml(spec: ProxyConfigSpec): string {
  const tryOrder = spec.tryOrder ?? spec.backends.map((b) => b.name);
  const doc = {
    timeout: 30000,
    player_limit: -1,
    ip_forward: spec.onlineMode,
    online_mode: spec.onlineMode,
    prevent_proxy_connections: false,
    forge_support: false,
    log_commands: false,
    log_pings: true,
    network_compression_threshold: 256,
    connection_throttle: 4000,
    connection_throttle_limit: 3,
    server_connect_timeout: 5000,
    remote_ping_timeout: 5000,
    remote_ping_cache: -1,
    servers: Object.fromEntries(
      spec.backends.map((b) => [b.name, { address: b.address, restricted: false }]),
    ),
    listeners: [
      {
        host: spec.bind,
        motd: spec.motd,
        max_players: spec.maxPlayers,
        tab_list: 'GLOBAL_PING',
        tab_size: 60,
        force_default_server: false,
        bind_local_address: true,
        ping_passthrough: false,
        proxy_protocol: false,
        query_enabled: false,
        query_port: 25577,
        priorities: tryOrder,
        forced_hosts: {},
      },
    ],
    groups: {},
    permissions: {
      default: ['bungeecord.command.server', 'bungeecord.command.list'],
    },
  };
  return stringifyYaml(doc, { lineWidth: 0 });
}

// ---------------------------------------------------------------------------
// 渲染分发
// ---------------------------------------------------------------------------

export function renderProxyConfig(spec: ProxyConfigSpec): string {
  return spec.type === 'velocity' ? renderVelocityToml(spec) : renderBungeeYaml(spec);
}

// ---------------------------------------------------------------------------
// 解析：TOML / YAML -> 统一视图
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 解析抛出的错误（内核据此分类为 validation，而非崩溃）。 */
export class ProxyConfigParseError extends Error {
  override readonly name = 'ProxyConfigParseError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * 解析 `velocity.toml`。
 *
 * 只认官方文档列出的键。遇到 `[advanced]` / `[query]` 等已知但与本模块视图无关的段
 * 直接跳过（Velocity 默认配置有几十个键，全量建模无意义）。
 * `[servers]` 段的键值形如 `lobby = "127.0.0.1:30066"`。
 */
export function parseVelocityToml(text: string, type: ProxyType = 'velocity'): ProxyConfigView {
  const backends: ProxyBackend[] = [];
  let tryOrder: string[] = [];
  let section = '';
  const root: Record<string, unknown> = {};

  // 上一行以 `[` 结尾表示**多行数组**已开始（上游默认 `try` 就是这么写的）：
  // 该区段的续行只有裸字符串，直到遇到收尾的 `]`。
  let inMultilineArray = false;
  const multilineArray: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    // 多行数组的续行：只有裸字符串（可带尾逗号），直到收尾的 `]`。
    if (inMultilineArray) {
      if (line === ']') {
        tryOrder = multilineArray.splice(0);
        inMultilineArray = false;
        continue;
      }
      const item = unquoteTomlString(line.replace(/,$/, '').trim());
      if (item === undefined) {
        throw new ProxyConfigParseError(`velocity.toml 多行数组元素不是字符串: ${line}`);
      }
      multilineArray.push(item);
      continue;
    }

    // 段名 `[advanced]`：完整闭合。
    if (line.length > 1 && line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim();
      continue;
    }
    // 未闭合的 `[`：只可能是多行数组的开头（键值行在下面判）。
    if (line === '[') {
      throw new ProxyConfigParseError(`velocity.toml 段名未闭合: ${line}`);
    }
    const eq = line.indexOf('=');
    if (eq > 0 && line.slice(eq + 1).trim() === '[') {
      const key = line.slice(0, eq).trim();
      if (key !== 'try') {
        throw new ProxyConfigParseError(`velocity.toml 未知的多行数组键: ${key}`);
      }
      multilineArray.splice(0);
      inMultilineArray = true;
      continue;
    }
    if (eq <= 0) {
      throw new ProxyConfigParseError(`velocity.toml 无法解析的行: ${line}`);
    }
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();

    // `try` 按键名判定、**不看当前段**：上游默认 velocity.toml 把 `try` 放在
    // 文件末尾（已在 [query] 之后），按段判定会漏掉它 → 路由顺序整个丢失。
    if (key === 'try') {
      tryOrder = parseTomlStringArray(rawValue);
      continue;
    }

    if (section === 'servers') {
      const address = unquoteTomlString(rawValue);
      if (address === undefined) {
        throw new ProxyConfigParseError(
          `velocity.toml [servers].${key} 不是字符串地址: ${rawValue}`,
        );
      }
      backends.push({ name: key, address });
      continue;
    }
    if (section !== '') continue; // [advanced] / [query] 等与本视图无关

    root[key] = unquoteTomlString(rawValue) ?? rawValue;
  }

  return {
    type,
    bind: asString(root['bind'], '0.0.0.0:25577'),
    motd: asString(root['motd'], 'A Velocity Server'),
    maxPlayers: asInt(root['show-max-players'], 500),
    onlineMode: asBool(root['online-mode'], true),
    backends,
    tryOrder,
  };
}

function unquoteTomlString(raw: string): string | undefined {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

function parseTomlStringArray(raw: string): string[] {
  const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : '';
  if (inner.trim() === '') return [];
  return inner
    .split(',')
    .map((s) => unquoteTomlString(s.trim()))
    .filter((s): s is string => s !== undefined);
}

/** 解析 `config.yml`（bungeecord / waterfall）。 */
export function parseBungeeYaml(text: string, type: ProxyType = 'bungeecord'): ProxyConfigView {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ProxyConfigParseError(`config.yml YAML 解析失败: ${message}`);
  }
  const root = asRecord(doc);
  if (root === undefined) {
    throw new ProxyConfigParseError(
      'config.yml 顶层不是映射（无法识别为 BungeeCord/Waterfall 配置）',
    );
  }

  const backends: ProxyBackend[] = [];
  const servers = asRecord(root['servers']);
  if (servers !== undefined) {
    for (const [name, rawEntry] of Object.entries(servers)) {
      const entry = asRecord(rawEntry);
      // BungeeCord 允许 `servers.<n>` 直接写成字符串地址，但官方默认是 { address: ... }。
      const address = typeof rawEntry === 'string' ? rawEntry : asString(entry?.['address'], '');
      if (address !== '') backends.push({ name, address });
    }
  }

  const listeners = Array.isArray(root['listeners']) ? root['listeners'] : [];
  const first = asRecord(listeners[0]) ?? {};
  const tryOrder = asStringArray(first['priorities']);

  return {
    type,
    bind: asString(first['host'], '0.0.0.0:25577'),
    motd: asString(first['motd'], 'A BungeeCord Server'),
    maxPlayers: asInt(first['max_players'], 1),
    onlineMode: asBool(root['online_mode'], true),
    backends,
    tryOrder,
  };
}

export function parseProxyConfig(type: ProxyType, text: string): ProxyConfigView {
  return type === 'velocity' ? parseVelocityToml(text, type) : parseBungeeYaml(text, type);
}

// ---------------------------------------------------------------------------
// 增量改写（set_proxy_server_config 用）
// ---------------------------------------------------------------------------

/**
 * 在现有视图上应用一次受限补丁并重新渲染。
 *
 * 只允许改这几个字段（都是代理真会读的键）；`type` 不可改（换了类型就是另一套格式）。
 * 渲染前重新跑 validateProxySpec，避免把非法路由写进代理真读的配置里。
 */
export interface ProxyConfigPatch {
  bind?: string;
  motd?: string;
  maxPlayers?: number;
  onlineMode?: boolean;
  backends?: ProxyBackend[];
  tryOrder?: string[];
}

export function applyProxyConfigPatch(
  current: ProxyConfigView,
  patch: ProxyConfigPatch,
): ProxyConfigView {
  const next: ProxyConfigView = {
    ...current,
    bind: patch.bind ?? current.bind,
    motd: patch.motd ?? current.motd,
    maxPlayers: patch.maxPlayers ?? current.maxPlayers,
    onlineMode: patch.onlineMode ?? current.onlineMode,
    backends: patch.backends ?? current.backends,
    tryOrder: patch.tryOrder ?? current.tryOrder,
  };
  return next;
}

/** 补丁后重渲染；校验不通过则抛，由内核分类为 validation。 */
export function renderAfterPatch(
  type: ProxyType,
  current: ProxyConfigView,
  patch: ProxyConfigPatch,
): string {
  const next = applyProxyConfigPatch(current, patch);
  const errors = validateProxySpec({
    type,
    bind: next.bind,
    motd: next.motd,
    maxPlayers: next.maxPlayers,
    onlineMode: next.onlineMode,
    backends: next.backends,
    tryOrder: next.tryOrder,
  });
  if (errors.length > 0) {
    throw new ProxyConfigParseError(`代理配置补丁非法：${errors.join('；')}`);
  }
  return renderProxyConfig({
    type,
    bind: next.bind,
    motd: next.motd,
    maxPlayers: next.maxPlayers,
    onlineMode: next.onlineMode,
    backends: next.backends,
    tryOrder: next.tryOrder,
  });
}
