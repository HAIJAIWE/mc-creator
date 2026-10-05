/**
 * MCP Streamable HTTP 传输层（设计文档 §10.1：传输分两类 —— Streamable HTTP 走生产，
 * stdio 走本地工具；stdio 实现在 ./mcp-server.ts，本文件补上生产那一半）。
 *
 * 零第三方依赖：只用 node: 内置（http / crypto / url）+ ./mcp-server.js 的方法分发核心。
 * **不重写一套方法分发**：POST 的每个 JSON-RPC 条目都交给 handleRequest（stdio 同一份），
 * 所以两条传输的 MCP 语义逐字一致（initialize / notifications/initialized / tools/list /
 * tools/call / 未知方法 -32601）。
 *
 * 通道政策不变（§10.6 / §10.2，MCP 通道铁律）：
 * - W/X 类工具在本通道一律**拒绝执行**（不弹窗、不执行），返回 isError:true +
 *   error.category === 'permission' + data.confirmRequired:true（由 createMcpServer 的
 *   refuse() 统一实现，本文件不复制该逻辑，只保证 HTTP 通道复用同一个 McpServer 句柄）；
 * - R 类只读工具且有内核支持 kind → 才透传 kernel.dispatch；
 * - 沙箱内代码永不自动加载进正式环境（§13.4：本层不提供任何「装载沙箱代码」的 MCP 方法，
 *   未知方法一律 -32601，等于对该路径 fail-closed）。
 *
 * 规范要点（MCP Streamable HTTP）：
 * - 单一端点 POST/GET/DELETE（默认 /mcp）；
 * - **JSON-RPC 语义优先于 HTTP 状态码**：tools/call 里的业务错误是 HTTP 200 + JSON-RPC error，
 *   只有「body 不是合法 JSON」这类协议层失败才用 400；
 * - 会话由 `Mcp-Session-Id` 头承载：initialize 成功后下发，后续请求带错/过期的会话 id → 404；
 * - `Origin` 校验是规范强制的安全要求（防 DNS rebinding，浏览器 page 能打本机端口），
 *   默认只放行 localhost / 127.0.0.1，其余 403。
 *
 * 自启动纪律（与 stdio 层一致）：**本文件不自启动**。import 只导出符号，
 * 由调用方显式 serveHttp({ server: createMcpServer({}), port, host, path })。
 * 生产环境（§10.1「独立进程，长任务不随窗口关闭终止」）由外壳拉起一个
 * `node -e "import('@mc-creator/agent').then(m => m.serveHttp({ server: m.createMcpServer({}), port: 3001 }))"`
 * 之类的常驻进程；本轮不写该入口脚本，避免 import 本模块时意外监听端口。
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import type { JsonRpcRequest, JsonRpcResponse, McpServer } from './mcp-server.js';
import { handleRequest } from './mcp-server.js';

// ---------------------------------------------------------------------------
// 常量 / 默认策略
// ---------------------------------------------------------------------------

/** 主端点路径（MCP Streamable HTTP 单一端点）。 */
export const DEFAULT_MCP_PATH = '/mcp';
/** body 上限，防内存打爆（4MB；规范未规定，本地工具参数极小，纯防御）。 */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
/** 会话默认存活时长（30 分钟）；惰性过期，靠注入的 now() 判断。 */
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
/** SSE 心跳间隔（30s）；0 = 关闭心跳。 */
export const DEFAULT_SSE_HEARTBEAT_MS = 30_000;
/** GET 建立 SSE 流后立刻下发的注释帧（注释帧被 EventSource 忽略，仅保活/探活）。 */
export const SSE_OPEN_FRAME = ': mc-creator mcp stream open\n\n';
/**
 * 过期会话定期清扫间隔（60s；0 = 关闭）。
 *
 * 为什么需要它：过期判定是**惰性**的（has() 命中才算），所以「建了会话就再没被
 * 访问过」的记录只会在被访问时才被删。开了持久化后这还有个副作用 —— 内存 Map 与
 * 磁盘存档都会长期留着这些死会话（存档只在变更时落盘，没人访问就不算变更）。
 * 定期清扫把「没人碰的过期会话」也回收掉。默认 60s，close() 会清掉该定时器
 * （且已 unref，不挡进程退出），设 0 即回到纯惰性清理。
 */
export const DEFAULT_SESSION_SWEEP_MS = 60_000;

/**
 * 服务端自定义错误码（JSON-RPC 保留 -32099..-32000 给实现方自定义）。
 * 规范把 400/401/403/404/405/413 的 body 定为 JSON-RPC error，所以这些 HTTP 失败也要带码。
 */
export const ERR_SESSION_NOT_FOUND = -32001;
export const ERR_UNAUTHORIZED = -32002;
export const ERR_FORBIDDEN_ORIGIN = -32003;
export const ERR_ENDPOINT_NOT_FOUND = -32004;
export const ERR_METHOD_NOT_ALLOWED = -32005;
export const ERR_PAYLOAD_TOO_LARGE = -32006;
export const ERR_NOT_ACCEPTABLE = -32007;

/** HTTP 层监听的方法白名单（其余 405 + Allow）。 */
export const ALLOWED_METHODS = 'GET, POST, DELETE';

// ---------------------------------------------------------------------------
// 传输无关的请求/响应形状
// ---------------------------------------------------------------------------

/** 与 node:http 无关的请求视图（body 文本由调用方读流拼好）。 */
export interface HttpRequestLike {
  method: string;
  /** 含 query 的原始 url（只取 pathname 判端点）。 */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** 原始 body 文本（GET/DELETE 为空串）。 */
  body: string;
}

/** 传输无关的响应视图。 */
export interface HttpResponseLike {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** 心跳帧（`: heartbeat <ms>` 注释行）。 */
export function sseHeartbeatFrame(nowMs: number): string {
  return `: heartbeat ${nowMs}\n\n`;
}

// ---------------------------------------------------------------------------
// Accept 头校验（MCP Streamable HTTP 规范强制项）
// ---------------------------------------------------------------------------

/** POST 必须同时可接受 JSON 与 SSE（MCP 规范要求客户端两者都声明）。 */
const POST_REQUIRED_ACCEPT = ['application/json', 'text/event-stream'] as const;

/** 单条 media-range（q 值已归一到 0..1，q=0 表示显式拒绝该类型）。 */
interface MediaRange {
  type: string;
  q: number;
}

/**
 * 解析 Accept 头为 media-range 列表。
 *
 * 为什么不能 `includes('application/json')`：那样写会把
 * `application/json-seq` 误判为已声明 `application/json`（前缀匹配），
 * 而 json-seq 是完全不同的媒体类型，接了它我们的响应格式就对不上了。
 * 所以必须按 `type/subtype` 精确比对 type 与 subtype 两段。
 *
 * 语法细节：逗号分隔、每项 `type/subtype[;q=权重]`、参数间可有空格、
 * type/subtype 大小写不敏感（RFC 9110 media type 是大小写无关的）、
 * 非法 q 值按 1.0 处理（宁可宽松也不因畸形头拒绝合法请求）。
 */
export function parseAccept(header: string | undefined): MediaRange[] {
  if (header === undefined) return [];
  const out: MediaRange[] = [];
  for (const rawPart of header.split(',')) {
    const part = rawPart.trim();
    if (part === '') continue;
    const segments = part.split(';');
    const media = (segments[0] ?? '').trim().toLowerCase();
    const slash = media.indexOf('/');
    if (slash <= 0) continue; // 没有合法 type/subtype → 忽略该项
    const type = media.slice(0, slash);
    const subtype = media.slice(slash + 1);
    if (subtype === '') continue;
    let q = 1;
    for (const seg of segments.slice(1)) {
      const [rawKey, ...rest] = seg.split('=');
      if ((rawKey ?? '').trim().toLowerCase() !== 'q') continue;
      const parsed = Number.parseFloat(rest.join('=').trim());
      if (Number.isFinite(parsed)) q = Math.min(1, Math.max(0, parsed));
    }
    out.push({ type: `${type}/${subtype}`, q });
  }
  return out;
}

/**
 * 请求是否可接受给定的媒体类型。
 *
 * 匹配规则（按 RFC 9110 §12.5.1）：精确 type/subtype > type 通配 > 全通配，
 * 取**优先级最高**的那条比对其 q 值，而不是「只要有一条 q>0 就算可接受」——
 * 后者会让「json 的 q=0 + 全通配的 q=1」被判为接受 json，
 * 而客户端明明用 q=0 显式拒绝了它。
 */
export function acceptsMediaType(ranges: readonly MediaRange[], wanted: string): boolean {
  const target = wanted.toLowerCase();
  const slash = target.indexOf('/');
  if (slash <= 0) return false;
  const type = target.slice(0, slash);
  const wildcardType = `${type}/*`;

  // 优先级：精确 type/subtype(3) > type/*(2) > */*(1)；同优先级取 q 更高者。
  let bestQ = -1;
  let bestPriority = 0;
  for (const range of ranges) {
    let priority = 0;
    if (range.type === target) priority = 3;
    else if (range.type === wildcardType) priority = 2;
    else if (range.type === '*/*') priority = 1;
    if (priority === 0) continue;
    if (priority > bestPriority || (priority === bestPriority && range.q > bestQ)) {
      bestPriority = priority;
      bestQ = range.q;
    }
  }
  // 一条都没匹配上 → 不可接受（客户端没声明任何能收该类型的范围）。
  return bestPriority > 0 && bestQ > 0;
}

/** POST 缺 Accept（或缺必需类型）→ false。规范要求客户端声明两者。 */
export function postAcceptOk(accept: string | undefined): boolean {
  // 完全不声明 Accept：按 RFC 9110 等价于 `*/*`，视为接受（规范用 MAY 措辞）。
  const ranges = parseAccept(accept);
  if (ranges.length === 0) return true;
  return POST_REQUIRED_ACCEPT.every((wanted) => acceptsMediaType(ranges, wanted));
}

/** GET（SSE 流）只需客户端能接受 text/event-stream。 */
export function sseAcceptOk(accept: string | undefined): boolean {
  const ranges = parseAccept(accept);
  if (ranges.length === 0) return true;
  return acceptsMediaType(ranges, 'text/event-stream');
}

/**
 * 默认 Accept 判定：**只管 POST**。
 *
 * 规范对 POST 要求客户端同时声明 `application/json` 与 `text/event-stream`
 * （响应可能取其一，客户端得两个都能收）；对 GET 只说「可以声明
 * text/event-stream」—— 是 MAY 不是 MUST，而且 SSE 的 Content-Type 是
 * 服务端定的，客户端没声明不代表不能收。所以默认对 GET/DELETE 放行，
 * 想严格校验 SSE 的调用方自己传 acceptChecker（用 sseAcceptOk）。
 *
 * 完全没有 Accept 头按 RFC 9110 等价「全通配」→ 放行。
 */
export function defaultAcceptChecker(accept: string | undefined, method: string): boolean {
  return method.toUpperCase() !== 'POST' || postAcceptOk(accept);
}

/** 取头（大小写不敏感，兼容 string[] —— set-cookie 类多值头）。 */
export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 会话管理（§10.1 生产环境需要）
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  createdAt: number;
}

/**
 * 会话存储的持久化后端（生产化用；内存态是默认）。
 *
 * 为什么抽成接口而不是直接写文件：`SessionStore.has()` 是请求热路径，
 * 若每次都读盘就是同步 IO 阻塞事件循环。抽出来后，生产实现可在**启动时**加载
 * 一次进内存、变更时异步落盘，请求路径仍只碰内存。
 */
export interface SessionPersistence {
  /** 启动时载入全部会话（存档损坏时应返回空集而不是抛 —— 由实现保证）。 */
  load(): SessionRecord[];
  /** 变更后落盘（异步，允许乱序到达；实现需自行保证最终一致）。 */
  save(records: SessionRecord[]): void | Promise<void>;
}

/**
 * Mcp-Session-Id 存储。
 * 时钟（now）与 id 生成器必须可注入 —— 否则测试无法断言具体 session id，也无法测过期。
 */
export class SessionStore {
  readonly #byId = new Map<string, SessionRecord>();
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #newId: () => string;
  readonly #persist: SessionPersistence | undefined;
  /** dispose() 之后停止落盘（关停语义，见 dispose 注释）。 */
  #persistEnabled = true;

  constructor(
    opts: {
      now?: () => number;
      ttlMs?: number;
      newSessionId?: () => string;
      /** 给了则启用跨重启持久化。 */
      persistence?: SessionPersistence;
    } = {},
  ) {
    this.#now = opts.now ?? Date.now;
    this.#ttlMs = opts.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.#newId = opts.newSessionId ?? randomUUID;
    this.#persist = opts.persistence;
    if (this.#persist !== undefined) {
      // 启动加载：过滤掉已过期与畸形条目，避免把垃圾带进内存（存档可能半写/手改过）。
      const cutoff = this.#now();
      for (const record of this.#persist.load()) {
        if (typeof record?.id !== 'string' || record.id === '') continue;
        if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) continue;
        if (this.#ttlMs > 0 && cutoff - record.createdAt > this.#ttlMs) continue;
        this.#byId.set(record.id, { id: record.id, createdAt: record.createdAt });
      }
    }
  }

  /**
   * 异步落盘快照（fire-and-forget：写失败不该让请求失败，会话在内存里仍可用）。
   *
   * 必须 try/catch 包住**调用本身**而不只是 .catch：后端允许同步抛
   * （如 JSON 文件后端遇到不可写路径会 throw），那时 Promise.resolve 还没
   * 接管，异常会直接冒泡打断请求。
   */
  #flush(): void {
    const persist = this.#persist;
    if (persist === undefined || !this.#persistEnabled) return;
    try {
      void Promise.resolve(persist.save([...this.#byId.values()])).catch(() => {
        // 落盘失败只丢「跨重启仍可用」这一条能力，不影响当前进程。
      });
    } catch {
      // 同上：同步抛错也吞掉（存档不可写不该让 initialize 失败）。
    }
  }

  /**
   * 关停：清内存但**不落盘**。
   *
   * 为什么必须有它：serveHttp.close() 走的是「服务没了」这条路径，
   * 若顺手把空集合落盘，就把上一轮所有会话从存档里抹了 —— 下次重启
   * 一个都恢复不了。语义上「关停」与「删除全部会话」是两件事。
   */
  dispose(): void {
    this.#persistEnabled = false;
    this.#byId.clear();
  }

  /** 建会话，返回 id。 */
  create(): SessionRecord {
    const record: SessionRecord = { id: this.#newId(), createdAt: this.#now() };
    this.#byId.set(record.id, record);
    this.#flush();
    return record;
  }

  /**
   * 会话是否存在且未过期（惰性清理：命中即判断 createdAt + ttl）。
   * ttlMs <= 0 表示永不过期。
   */
  has(id: string): boolean {
    const record = this.#byId.get(id);
    if (record === undefined) return false;
    if (this.#ttlMs > 0 && this.#now() - record.createdAt > this.#ttlMs) {
      this.#byId.delete(id);
      this.#flush();
      return false;
    }
    return true;
  }

  /** 取会话记录（不存在/过期 → undefined）。 */
  get(id: string): SessionRecord | undefined {
    return this.has(id) ? this.#byId.get(id) : undefined;
  }

  /** 终止会话（DELETE /mcp 用），返回是否本来存在。 */
  delete(id: string): boolean {
    const existed = this.has(id);
    this.#byId.delete(id);
    this.#flush();
    return existed;
  }

  /** 存活会话数（测试断言用）。 */
  size(): number {
    let n = 0;
    for (const id of [...this.#byId.keys()]) if (this.has(id)) n += 1;
    return n;
  }

  /** 清空（DELETE 全量 / 测试 resetSessions）。 */
  clear(): void {
    this.#byId.clear();
    this.#flush();
  }

  /**
   * 定期清扫过期会话（配合 serveHttp 的 sweepMs 定时器）。
   * 返回被删掉的条数；只在真的删了东西时才落盘 —— 定时器每 tick 都写盘是纯浪费。
   *
   * 注意：调用方必须注入/使用稳定时钟才能断言本方法的效果（测试用 now 推进）。
   */
  sweepExpired(): number {
    // 自己判过期而**不**复用 has()：has() 内部对每次过期删除都会落盘，
    // 那样一个清扫 tick 会写盘 N 次；这里只批量删、最后落一次。
    let removed = 0;
    for (const [id, record] of [...this.#byId]) {
      if (this.#ttlMs > 0 && this.#now() - record.createdAt > this.#ttlMs) {
        this.#byId.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.#flush();
    return removed;
  }
}

/**
 * JSON 文件持久化后端（生产化：重启后会话仍可用）。
 *
 * 安全性取舍：
 * - 存档损坏（半写/手改）→ `load()` 返回空集而非抛异常。理由：会话丢失的代价
 *   只是客户端要重新 initialize，而服务起不来是灾难性的。
 * - 写用「临时文件 + rename」保证不产生半写的存档（同 shell 包的原子写思路）。
 * - 同步 IO（readFileSync/writeFileSync）：只在启动与变更时发生，不在请求热路径。
 */
export function createJsonFilePersistence(filePath: string): SessionPersistence {
  return {
    load(): SessionRecord[] {
      try {
        if (!existsSync(filePath)) return [];
        const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
          (r): r is SessionRecord =>
            typeof r === 'object' &&
            r !== null &&
            typeof (r as SessionRecord).id === 'string' &&
            typeof (r as SessionRecord).createdAt === 'number',
        );
      } catch {
        // 损坏 / 不可读 → 当作无存档，不让服务起不来。
        return [];
      }
    },
    save(records: SessionRecord[]): void {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
        renameSync(tmp, filePath);
      } catch {
        // 落盘失败不影响当前进程可用性（见 SessionStore.#flush 的注释）。
      }
    },
  };
}

/** 模块级默认会话存储（handleHttpRequest 不传 ctx 时使用；resetSessions() 清它）。 */
const defaultSessions = new SessionStore();

/** 清空模块级默认会话存储（测试清理用）。 */
export function resetSessions(): void {
  defaultSessions.clear();
}

// ---------------------------------------------------------------------------
// Origin 校验（MCP 规范强制的 DNS rebinding 防护）
// ---------------------------------------------------------------------------

/**
 * 默认 Origin 策略：缺省放行；`http://localhost[:port]` / `http://127.0.0.1[:port]` 放行；
 * 其余（含 https、其它主机、跨端口）一律拒绝。
 *
 * 为什么这是规范强制项：Streamable HTTP 端点常监听 127.0.0.1，浏览器里的任意网页
 * （DNS rebinding）都能对 localhost 发跨域简单请求，若不校验 Origin 就等于把
 * 25 个 MCP 工具（含 R 类读日志/读配置）暴露给任何打开的网页。
 * 生产环境应把 origins 钉成精确白名单（file:// 外壳走自定义 validateOrigin）。
 */
export function createDefaultOriginValidator(
  allowedPorts: number[] = [],
): (origin: string | undefined) => boolean {
  // 端口一律按字符串比较（URL.port 在显式给出时是字符串，无端口时规范化为 '80'）。
  const allowed = new Set(allowedPorts.map((p) => String(p)));
  return (origin) => {
    if (origin === undefined || origin === '' || origin === 'null') return true;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:') return false;
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return false;
    if (allowed.size === 0) return true;
    const port = url.port === '' ? '80' : url.port;
    return allowed.has(port);
  };
}

/** 默认放行（无 origin 头 = 非浏览器客户端 / 桌面外壳 IPC 场景）。 */
export const defaultValidateOrigin: (origin: string | undefined) => boolean =
  createDefaultOriginValidator();

// ---------------------------------------------------------------------------
// body 解析（支持 batch —— 规范要求 HTTP 层支持，stdio 层不支持）
// ---------------------------------------------------------------------------

function isId(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

type ParsedEntry =
  | { ok: true; request: JsonRpcRequest }
  | { ok: false; code: number; message: string; id: string | number | null };

/**
 * 单个条目 → JsonRpcRequest（判据对齐 mcp-server.ts 的 parseLine，差别是本层支持 batch，
 * 所以不把数组当 -32600）。jsonrpc 缺省放行，给出且非 '2.0' → -32600。
 */
function parseEntry(value: unknown): ParsedEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      code: -32600,
      message: 'Invalid Request: expected a JSON-RPC request object',
      id: null,
    };
  }
  const obj = value as Record<string, unknown>;
  if (obj['jsonrpc'] !== undefined && obj['jsonrpc'] !== '2.0') {
    return { ok: false, code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"', id: null };
  }
  const rawId = obj['id'];
  const id = isId(rawId) ? rawId : null;
  if (typeof obj['method'] !== 'string') {
    return { ok: false, code: -32600, message: 'Invalid Request: missing method', id };
  }
  if (rawId !== undefined && !isId(rawId)) {
    return {
      ok: false,
      code: -32600,
      message: 'Invalid Request: id must be string | number | null',
      id: null,
    };
  }
  const request: JsonRpcRequest = { jsonrpc: '2.0', method: obj['method'] };
  if (rawId !== undefined) request.id = rawId;
  if (obj['params'] !== undefined) request.params = obj['params'];
  return { ok: true, request };
}

type ParsedPayload =
  | { kind: 'empty' }
  | { kind: 'single'; entry: ParsedEntry }
  | { kind: 'batch'; entries: ParsedEntry[] }
  | { kind: 'error'; code: number; message: string; id: string | number | null };

/** 解析 HTTP body：空 / 单请求 / batch / 协议层错误。 */
export function parseHttpPayload(body: string): ParsedPayload {
  const trimmed = body.trim();
  if (trimmed === '') return { kind: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      kind: 'error',
      code: -32700,
      message: `Parse error: request body is not valid JSON (${e instanceof Error ? e.message : 'invalid'})`,
      id: null,
    };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return {
        kind: 'error',
        code: -32600,
        message: 'Invalid Request: empty batch array',
        id: null,
      };
    }
    return { kind: 'batch', entries: parsed.map(parseEntry) };
  }
  return { kind: 'single', entry: parseEntry(parsed) };
}

// ---------------------------------------------------------------------------
// 响应构造小工具
// ---------------------------------------------------------------------------

function jsonBody(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): HttpResponseLike {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  };
}

function rpcError(
  status: number,
  id: string | number | null,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): HttpResponseLike {
  return jsonBody(status, { jsonrpc: '2.0', id, error: { code, message } }, headers);
}

function noContent(headers: Record<string, string> = {}): HttpResponseLike {
  return { status: 204, headers, body: '' };
}

/** pathname（去掉 query），非 http(s) url 一律当 '/'。 */
function pathnameOf(url: string): string {
  const raw = url.split('?')[0] ?? '/';
  const idx = raw.indexOf('://');
  if (idx >= 0) {
    const rest = raw.slice(idx + 3);
    const slash = rest.indexOf('/');
    return slash < 0 ? '/' : (rest.slice(slash).split('#')[0] ?? '/');
  }
  return raw.split('#')[0] ?? '/';
}

// ---------------------------------------------------------------------------
// 传输无关的请求处理核心（纯逻辑，无 I/O，可测）
// ---------------------------------------------------------------------------

export interface HttpContext {
  server: McpServer;
  /** 主端点路径，默认 '/mcp'。 */
  path?: string;
  /** Origin 校验钩子（MCP 规范强制的 DNS rebinding 防护）。 */
  validateOrigin?: (origin: string | undefined) => boolean;
  /**
   * 认证钩子，默认放行。
   * 生产环境（§10.1 独立进程 + BYOK）应在这里接 OAuth / token 校验；
   * 本轮只留钩子：返回 false → 401 + WWW-Authenticate。
   */
  authorize?: (req: HttpRequestLike) => boolean | Promise<boolean>;
  sessions?: SessionStore;
  now?: () => number;
  newSessionId?: () => string;
  /** body 字节上限，超出 → 413。 */
  maxBodyBytes?: number;
  /** SSE 心跳间隔（仅 serveHttp 真正开流时用）；0 = 不发心跳。 */
  heartbeatMs?: number;
  /**
   * 是否强制校验 Accept 头（规范要求客户端在 POST 时声明
   * `application/json` 与 `text/event-stream`，GET 时声明 `text/event-stream`）。
   *
   * 默认 false = 宽松放行：规范用 MAY 措辞，且实测大量客户端（含官方 TS SDK 的
   * 部分版本、curl 手测、部分 IDE 插件）省略 Accept 或只发全通配。
   * 在本地工具通道这种「只监听 127.0.0.1 且已有 Origin 防护」的场景，
   * 严格校验带来的只是排障噪音而非安全性 —— 真正的安全边界由 Origin + 授权钩子守。
   * 生产暴露到非本机时建议置 true。
   */
  requireAccept?: boolean;
  /** 宽松覆盖：给定 Accept 头是否可接受（默认按 POST 双类型判定）。 */
  acceptChecker?: (accept: string | undefined, method: string) => boolean;
}

/**
 * GET /mcp 的既定行为（选择 + 理由，测试固定之）：
 * **返回 200 + Content-Type: text/event-stream 并保持连接**，握手帧是一条注释行
 * `: mc-creator mcp stream open`（SSE 注释帧），随后每 30s 一条 `: heartbeat <ms>`。
 *
 * 为什么不返回 405：MCP Streamable HTTP 规范把 GET（服务端主动推送的 SSE 流）列为
 * 端点能力的一部分，本服务「暂无推送源」只意味着流里暂时只有心跳，不代表能力不存在；
 * 若直接 405，等于永久删掉 GET 能力，后续接通知源（如 build 进度、read_logs 流式）
 * 还要改协议与客户端。保持连接 + 心跳还能顺带验证客户端是否真的连得上。
 */
export const GET_SSE_BEHAVIOR = 'sse-with-heartbeat' as const;

function sseResponse(headers: Record<string, string> = {}): HttpResponseLike {
  return {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // 反向代理缓冲会卡住 SSE（nginx 默认会缓冲），显式关掉。
      'X-Accel-Buffering': 'no',
      ...headers,
    },
    // 传输无关核心只给出「握手帧」；serveHttp 不会结束响应，而是接着写心跳。
    body: SSE_OPEN_FRAME,
  };
}

/** 从响应头里取回显的会话 id（node:http 会小写化头名，故大小写不敏感）。 */
function sessionIdOf(headers: Record<string, string>): string | undefined {
  return headerValue(headers as Record<string, string | string[] | undefined>, 'mcp-session-id');
}

/** GET 回显会话头（带了的 id 已在上面校验过有效）。 */
function sseHeaders(sessionId: string | undefined): Record<string, string> {
  return sessionId === undefined || sessionId === '' ? {} : { 'Mcp-Session-Id': sessionId };
}

// ---------------------------------------------------------------------------
// 主动推送（MCP notifications/* over SSE）
// ---------------------------------------------------------------------------

/**
 * 推送一条 SSE 数据帧。
 *
 * 与心跳帧（`: 注释行`）是**两条不同的路**：注释帧只保活、不进事件流，
 * 数据帧才承载 JSON-RPC notification。格式按 SSE 规范：`event:` / `data:` / 空行。
 * data 是单行 JSON（JSON.stringify 不产出裸换行），所以不需要多行 data 前缀处理。
 */
export function sseNotificationFrame(method: string, params: unknown): string {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
  return `event: message\ndata: ${payload}\n\n`;
}

/** 单个推送目标：与传输解耦，测试可注入 fake。 */
export interface NotificationTarget {
  /** 返回 false 表示背压（写缓冲已满），调用方据此决定策略。 */
  write(frame: string): boolean;
  /** 流是否仍可写（close 之后必须为 false）。 */
  writable(): boolean;
}

/**
 * 推送中心：管理各会话的 SSE 流，并提供主动推送能力。
 *
 * 背压策略：先探测后写 —— `write()` 返回 false 说明内核缓冲已满，
 * 此时**丢弃该条并计数**（`dropped`），不排队。原因：SSE 推送的内容是
 * 「进度/状态快照」这类**可丢的瞬时信息**（build 进度、read_logs 尾部），
 * 为它无限排队会在慢客户端上把内存吃光；而排队重发一条过期进度毫无意义。
 * 关键状态变更走 HTTP POST 的返回值而非推送，不依赖这条通道的可靠性。
 * `dropped` 可读，调用方能观测到丢消息（测试固定该行为）。
 */
export class NotificationHub {
  readonly #targets = new Map<string, NotificationTarget>();
  #dropped = 0;

  /** 登记一条 SSE 流；同 id 重复登记覆盖旧流（客户端重连场景）。 */
  attach(sessionId: string, target: NotificationTarget): void {
    this.#targets.set(sessionId, target);
  }

  /** 注销（流关闭时调用）。 */
  detach(sessionId: string): void {
    this.#targets.delete(sessionId);
  }

  /** 当前挂载的流数（测试断言用）。 */
  size(): number {
    return this.#targets.size;
  }

  /** 因背压被丢弃的条数（可观测；不因丢消息抛异常）。 */
  droppedCount(): number {
    return this.#dropped;
  }

  /** 推给单个会话；目标不存在或流已关 → false（调用方不必处理异常）。 */
  notifySession(sessionId: string, method: string, params: unknown): boolean {
    const target = this.#targets.get(sessionId);
    if (target === undefined) return false;
    return this.#write(target, method, params);
  }

  /** 推给所有已挂载的流；返回实际投递成功数。 */
  notifyAll(method: string, params: unknown): number {
    let delivered = 0;
    for (const [sessionId, target] of [...this.#targets]) {
      if (this.#write(target, method, params)) delivered += 1;
      // 流已关的顺手清掉，避免 Map 无限增长（close 后仍挂着 = 泄漏）。
      if (!target.writable()) this.#targets.delete(sessionId);
    }
    return delivered;
  }

  /** 全部断开（服务关闭时用）。 */
  clear(): void {
    this.#targets.clear();
  }

  #write(target: NotificationTarget, method: string, params: unknown): boolean {
    if (!target.writable()) return false;
    try {
      if (target.write(sseNotificationFrame(method, params))) return true;
      // 背压：丢弃而非排队（见类注释）。
      this.#dropped += 1;
      return false;
    } catch {
      // 流可能已在 write 途中被对端关闭；不能因推送失败炸掉调用方。
      this.#dropped += 1;
      return false;
    }
  }
}

/**
 * 把一个 HTTP 请求映射成 MCP 响应（或 null 语义由 204/202 表达）。纯函数、无 I/O。
 *
 * 返回值恒为 HttpResponseLike；「无内容」用 202（notification）/204（DELETE）表达，
 * 不用 null —— 这样 node:http 层与测试 fake 层行为一致。
 *
 * @param ctx 可选上下文（会话存储 / origin / 认证 / 限额）；缺省用模块级默认会话存储。
 */
export async function handleHttpRequest(
  server: McpServer,
  req: HttpRequestLike,
  ctx: Omit<HttpContext, 'server'> = {},
): Promise<HttpResponseLike> {
  const path = ctx.path ?? DEFAULT_MCP_PATH;
  const validateOrigin = ctx.validateOrigin ?? defaultValidateOrigin;
  const authorize = ctx.authorize;
  const sessions = ctx.sessions ?? defaultSessions;
  const maxBodyBytes = ctx.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const acceptChecker = ctx.acceptChecker ?? defaultAcceptChecker;
  const requireAccept = ctx.requireAccept ?? false;

  // 1) Origin 校验最先做（DNS rebinding 防护：不合法的 origin 连 body 都不该处理）。
  const origin = headerValue(req.headers, 'origin');
  if (!validateOrigin(origin)) {
    return rpcError(
      403,
      null,
      ERR_FORBIDDEN_ORIGIN,
      `Forbidden: Origin not allowed (${origin ?? 'unknown'})`,
    );
  }

  // 2) 认证钩子（生产接 OAuth/token；本轮默认放行）。
  if (authorize !== undefined) {
    const allowed = await authorize(req);
    if (!allowed) {
      return rpcError(401, null, ERR_UNAUTHORIZED, 'Unauthorized: missing or invalid credentials', {
        'WWW-Authenticate': 'Bearer realm="mc-creator-mcp"',
      });
    }
  }

  // 3) 端点路由：非主路径 → 404。
  if (pathnameOf(req.url) !== path) {
    return rpcError(404, null, ERR_ENDPOINT_NOT_FOUND, `Not Found: MCP endpoint is ${path}`);
  }

  const method = req.method.toUpperCase();
  const sessionId = headerValue(req.headers, 'mcp-session-id');

  // 4) 方法不允许 → 405 + Allow（规范要求带 Allow 头）。
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    return rpcError(405, null, ERR_METHOD_NOT_ALLOWED, `Method not allowed: ${method}`, {
      Allow: ALLOWED_METHODS,
    });
  }

  // 5) 会话校验：带了的 id 必须存在且未过期（规范建议 404；过期策略见 SessionStore）。
  if (sessionId !== undefined && sessionId !== '' && !sessions.has(sessionId)) {
    return rpcError(
      404,
      null,
      ERR_SESSION_NOT_FOUND,
      'Session not found: Mcp-Session-Id is unknown or expired',
    );
  }

  // 6) Accept 校验（规范强制项，默认宽松；见 HttpContext.requireAccept 的取舍说明）。
  //    必须排在 GET/DELETE 分支**之前**，否则自定义判据永远管不到 SSE 流。
  //    对所有方法都问一遍 acceptChecker，好让调用方自定义严格度；
  //    默认判据 defaultAcceptChecker 只对 POST 严格（规范对 GET 是 MAY）。
  if (requireAccept) {
    const accept = headerValue(req.headers, 'accept');
    if (!acceptChecker(accept, method)) {
      return rpcError(
        406,
        null,
        ERR_NOT_ACCEPTABLE,
        `Not Acceptable: client must accept ${
          method === 'POST' ? 'application/json and text/event-stream' : 'text/event-stream'
        } (Accept: ${accept ?? 'absent'})`,
      );
    }
  }

  // 7) GET → 建立 SSE 流（保持连接 + 心跳，见 GET_SSE_BEHAVIOR）。
  if (method === 'GET') {
    return sseResponse(sseHeaders(sessionId));
  }

  // 8) DELETE → 终止会话，204。
  if (method === 'DELETE') {
    if (sessionId !== undefined && sessionId !== '') sessions.delete(sessionId);
    return noContent();
  }

  // 9) POST → body 限额 / 协议解析 / 方法分发。
  if (Buffer.byteLength(req.body, 'utf8') > maxBodyBytes) {
    return rpcError(
      413,
      null,
      ERR_PAYLOAD_TOO_LARGE,
      `Payload too large: limit is ${maxBodyBytes} bytes`,
    );
  }

  const payload = parseHttpPayload(req.body);
  if (payload.kind === 'empty') {
    return rpcError(400, null, -32700, 'Parse error: empty request body');
  }
  if (payload.kind === 'error') {
    return rpcError(400, payload.id, payload.code, payload.message);
  }

  const entries = payload.kind === 'batch' ? payload.entries : [payload.entry];
  let createdSessionId: string | undefined;
  const responses: JsonRpcResponse[] = [];

  for (const entry of entries) {
    if (!entry.ok) {
      // 单个条目本身就是非法请求（缺 method / jsonrpc 版本错 / id 类型错）→ 协议层失败，HTTP 400；
      // batch 内的非法条目按 JSON-RPC batch 语义：塞进 200 的响应数组里，逐条报错。
      if (payload.kind === 'single') {
        return rpcError(400, entry.id, entry.code, entry.message);
      }
      responses.push({
        jsonrpc: '2.0',
        id: entry.id,
        error: { code: entry.code, message: entry.message },
      });
      continue;
    }
    if (entry.request.method === 'initialize' && createdSessionId === undefined) {
      // initialize 成功即建会话（规范：initialize 响应头下发 Mcp-Session-Id）。
      createdSessionId = sessions.create().id;
    }
    const res = await handleRequest(server, entry.request);
    if (res !== null) responses.push(res);
  }

  // 只有 notification → 202 空 body（规范：客户端无需等结果）。
  if (responses.length === 0) {
    return createdSessionId === undefined
      ? { status: 202, headers: {}, body: '' }
      : { status: 202, headers: { 'Mcp-Session-Id': createdSessionId }, body: '' };
  }

  // JSON-RPC error 也是 HTTP 200（JSON-RPC 语义优先于 HTTP 状态码）。
  const headers: Record<string, string> = {};
  const activeId = createdSessionId ?? sessionId;
  if (activeId !== undefined && activeId !== '') headers['Mcp-Session-Id'] = activeId;
  return jsonBody(
    200,
    payload.kind === 'batch' ? responses : (responses[0] as JsonRpcResponse),
    headers,
  );
}

// ---------------------------------------------------------------------------
// 真正的 HTTP 服务器（node:http）
// ---------------------------------------------------------------------------

/**
 * 可注入的 HTTP 宿主端口（测试注入 fake 即可不开真实端口）。
 * handle 返回 null 表示宿主已自行接管长连接（SSE），serveHttp 不再写响应。
 */
export interface HttpHostPort {
  handle(req: HttpRequestLike): Promise<HttpResponseLike | null>;
  close?(): Promise<void> | void;
}

export interface ServeHttpOptions {
  server: McpServer;
  /** 0 = 随机端口（测试默认）。 */
  port?: number;
  host?: string;
  path?: string;
  /** 注入宿主端口（测试用 fake）；给了就不真开端口。 */
  listener?: unknown;
  validateOrigin?: (origin: string | undefined) => boolean;
  authorize?: (req: HttpRequestLike) => boolean | Promise<boolean>;
  now?: () => number;
  newSessionId?: () => string;
  /** 会话 TTL，<=0 = 永不过期。 */
  sessionTtlMs?: number;
  maxBodyBytes?: number;
  /** SSE 心跳间隔，0 = 不发。 */
  heartbeatMs?: number;
  /** 强制 Accept 校验（默认 false 宽松，见 HttpContext.requireAccept）。 */
  requireAccept?: boolean;
  /** 自定义 Accept 判定。 */
  acceptChecker?: (accept: string | undefined, method: string) => boolean;
  /** 会话存档路径；给了则跨重启持久化会话（见 createJsonFilePersistence）。 */
  sessionStorePath?: string;
  /** 过期会话清扫间隔，0 = 关闭（默认 DEFAULT_SESSION_SWEEP_MS）。 */
  sweepMs?: number;
}

export interface RunningHttpServer {
  port: number;
  url: string;
  /** 主动推送中心：外壳用它把进度/状态变化推给已连上的 SSE 客户端。 */
  notifications: NotificationHub;
  close(): Promise<void>;
}

function log(message: string): void {
  // 日志只走 stderr（HTTP 层 stdout 无人消费，但保持与 stdio 层同一纪律）。
  process.stderr.write(`[mcp-http] ${message}\n`);
}

function buildContext(opts: ServeHttpOptions): {
  ctx: Omit<HttpContext, 'server'>;
  sessions: SessionStore;
} {
  const sessions = new SessionStore({
    ...(opts.now === undefined ? {} : { now: opts.now }),
    ttlMs: opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    ...(opts.newSessionId === undefined ? {} : { newSessionId: opts.newSessionId }),
    // 会话存档路径：给了就跨重启持久化（§10.1 生产环境需要）。
    ...(opts.sessionStorePath === undefined
      ? {}
      : { persistence: createJsonFilePersistence(opts.sessionStorePath) }),
  });
  const ctx: Omit<HttpContext, 'server'> = { sessions };
  if (opts.path !== undefined) ctx.path = opts.path;
  if (opts.validateOrigin !== undefined) ctx.validateOrigin = opts.validateOrigin;
  if (opts.authorize !== undefined) ctx.authorize = opts.authorize;
  if (opts.now !== undefined) ctx.now = opts.now;
  if (opts.newSessionId !== undefined) ctx.newSessionId = opts.newSessionId;
  if (opts.maxBodyBytes !== undefined) ctx.maxBodyBytes = opts.maxBodyBytes;
  if (opts.heartbeatMs !== undefined) ctx.heartbeatMs = opts.heartbeatMs;
  if (opts.requireAccept !== undefined) ctx.requireAccept = opts.requireAccept;
  if (opts.acceptChecker !== undefined) ctx.acceptChecker = opts.acceptChecker;
  return { ctx, sessions };
}

function writeResponse(res: ServerResponse, out: HttpResponseLike): void {
  const body = out.body === '' ? undefined : out.body;
  res.writeHead(out.status, out.headers);
  if (body === undefined) res.end();
  else res.end(body);
}

/**
 * 起 Streamable HTTP 服务。
 * - 注入 listener（HttpHostPort）→ 不开端口，只做编排（测试 fake 用）；
 * - 否则 node:http createServer：读 body（限 4MB，超了 413）→ 交给 handleHttpRequest →
 *   写响应；GET 的 SSE 响应保持连接并定期写心跳；close() 清掉所有 SSE 连接后优雅关闭。
 */
export async function serveHttp(opts: ServeHttpOptions): Promise<RunningHttpServer> {
  const port = opts.port ?? 0;
  const host = opts.host ?? '127.0.0.1';
  const path = opts.path ?? DEFAULT_MCP_PATH;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const { ctx, sessions } = buildContext(opts);

  // --- 注入宿主端口分支：不碰网络 ---
  const injected = opts.listener as HttpHostPort | undefined;
  if (injected !== undefined && typeof injected.handle === 'function') {
    log(`注入宿主端口，跳过监听（path=${path}）`);
    return {
      port,
      url: `http://${host}:${port}${path}`,
      notifications: new NotificationHub(),
      close: async () => {
        sessions.dispose();
        if (injected.close !== undefined) await injected.close();
      },
    };
  }

  const streams = new Set<ServerResponse>();
  const timers = new Set<NodeJS.Timeout>();
  // 过期会话清扫：见 DEFAULT_SESSION_SWEEP_MS 的取舍说明。
  // 时钟来自 sessions 内部注入的 now()（真机是 Date.now），所以注入 fake 时钟的
  // 测试也能断言清扫行为；定时器本身按真实时间走，不受 fake 时钟影响。
  const sweepMs = opts.sweepMs ?? DEFAULT_SESSION_SWEEP_MS;
  if (sweepMs > 0) {
    const sweepTimer = setInterval(() => {
      const removed = sessions.sweepExpired();
      if (removed > 0) log(`清扫过期会话 ${removed} 条`);
    }, sweepMs);
    sweepTimer.unref?.();
    timers.add(sweepTimer);
  }
  /** 每条 SSE 流对应一个推送目标（按会话 id 登记；无会话 id 的匿名流不进 Hub）。 */
  const hub = new NotificationHub();
  /** res → 会话 id，供关闭时反查注销。 */
  const streamSession = new Map<ServerResponse, string>();

  const server: Server = createServer((req, res) => {
    void onNodeRequest(req, res).catch((e: unknown) => {
      log(`请求处理异常: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) {
        writeResponse(res, rpcError(500, null, -32603, 'Internal error'));
      } else {
        res.end();
      }
    });
  });

  async function onNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: string;
    try {
      body = await readBody(req, maxBodyBytes);
    } catch (e) {
      if (isPayloadTooLarge(e)) {
        writeResponse(
          res,
          rpcError(
            413,
            null,
            ERR_PAYLOAD_TOO_LARGE,
            `Payload too large: limit is ${maxBodyBytes} bytes`,
          ),
        );
        return;
      }
      throw e;
    }
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // GET /mcp → SSE：握手帧 + 保持连接 + 心跳（不经 handleHttpRequest 结束响应）。
    if (method === 'GET' && pathnameOf(url) === path) {
      const out = await handleHttpRequest(opts.server, { method, url, headers, body }, ctx);
      if (out.status === 200 && out.headers['Content-Type'] === 'text/event-stream') {
        streams.add(res);
        res.writeHead(out.status, out.headers);
        res.write(out.body);
        const sid = sessionIdOf(out.headers);
        if (sid !== undefined) {
          streamSession.set(res, sid);
          hub.attach(sid, {
            write: (frame) => res.write(frame),
            writable: () => !res.writableEnded && !res.destroyed,
          });
        }
        res.on('close', () => {
          streams.delete(res);
          const closed = streamSession.get(res);
          if (closed !== undefined) {
            streamSession.delete(res);
            hub.detach(closed);
          }
        });
        if (heartbeatMs > 0) {
          const timer = setInterval(() => {
            if (res.writableEnded) {
              clearInterval(timer);
              timers.delete(timer);
              return;
            }
            res.write(sseHeartbeatFrame(Date.now()));
          }, heartbeatMs);
          timer.unref?.();
          timers.add(timer);
        }
        return;
      }
      writeResponse(res, out);
      return;
    }

    const out = await handleHttpRequest(opts.server, { method, url, headers, body }, ctx);
    writeResponse(res, out);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  log(
    `Streamable HTTP 服务启动 http://${host}:${actualPort}${path}（GET=GET_SSE_BEHAVIOR, body<=${maxBodyBytes}B）`,
  );

  return {
    port: actualPort,
    url: `http://${host}:${actualPort}${path}`,
    notifications: hub,
    close: async () => {
      // dispose 而非 clear：关停不该把空存档落盘（否则抹掉全部会话）。
      sessions.dispose();
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      for (const res of streams) res.end();
      streams.clear();
      streamSession.clear();
      hub.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      log('Streamable HTTP 服务已关闭');
    },
  };
}

/** body 超上限的内部信号（node:http 层映射为 413，与纯逻辑层的 413 同码）。 */
class PayloadTooLargeError extends Error {
  constructor(limit: number) {
    super(`body too large: limit ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

function isPayloadTooLarge(e: unknown): e is PayloadTooLargeError {
  return e instanceof PayloadTooLargeError;
}

/** 读 body（限字节上限，超了抛 PayloadTooLargeError 并销毁请求流，不继续缓冲）。 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        reject(new PayloadTooLargeError(maxBytes));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => {
      if (!aborted) reject(e);
    });
  });
}
