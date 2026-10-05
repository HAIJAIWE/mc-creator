/**
 * Source RCON 客户端（设计文档 §7.4：stdin 不可用时回退）。
 *
 * 只做一件事：TCP 小端包 [length,int32 id,int32 type,body,0x00,0x00]，
 * auth type=3，exec type=2，auth 回包 id 不匹配即失败；
 * 多包响应按 id 收集至空包/超时。
 *
 * 口令绝不落日志：所有错误信息只含 host:port 与 code，禁止含 password。
 */

import * as net from 'node:net';

/** 单次 RCON 操作默认超时（可被调用方覆盖）。 */
export const DEFAULT_RCON_TIMEOUT_MS = 5_000;

/** RCON 结构化失败码（中文错 + code，调用方按 code 归类）。 */
export type RconErrorCode = 'RCON_AUTH_FAILED' | 'RCON_TIMEOUT' | 'RCON_CONN_FAILED';

/** RCON 结构化错误：message 中文，code 给程序用，绝不含口令。 */
export class RconError extends Error {
  readonly code: RconErrorCode;
  constructor(message: string, code: RconErrorCode) {
    super(message);
    this.name = 'RconError';
    this.code = code;
  }
}

/** 函数式发送参数（选函数式更易测，不做 Client 类）。 */
export interface SendRconOptions {
  host: string;
  port: number;
  password: string;
  command: string;
  /** 单次操作超时毫秒，默认 DEFAULT_RCON_TIMEOUT_MS。 */
  timeoutMs?: number;
}

/** 可注入的发送函数签名（supervisor 测试用 fake 注入）。 */
export type RconSendFn = (opts: SendRconOptions) => Promise<string>;

const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
/** auth / exec 的请求 id（避开 -1：-1 是服务端鉴权失败的哨兵）。 */
const AUTH_ID = 1;
const EXEC_ID = 2;

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf8');
  const length = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + length);
  buf.writeInt32LE(length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  // 末尾两个 0x00 已由 alloc 置零。
  return buf;
}

interface DecodedPacket {
  id: number;
  type: number;
  body: string;
}

/** 从累积缓冲里尽力解包；返回解出的包与剩余缓冲（处理 TCP 粘包/半包）。 */
function decodeAvailable(buf: Buffer): { packets: DecodedPacket[]; rest: Buffer } {
  const packets: DecodedPacket[] = [];
  let offset = 0;
  while (buf.length - offset >= 4) {
    const length = buf.readInt32LE(offset);
    // 非法长度直接停（等更多数据或由超时收口，不抛裸异常）。
    if (!Number.isInteger(length) || length < 10 || length > 64 * 1024 * 1024) break;
    if (buf.length - offset - 4 < length) break;
    const id = buf.readInt32LE(offset + 4);
    const type = buf.readInt32LE(offset + 8);
    const bodyLen = length - 10;
    const body = buf.slice(offset + 12, offset + 12 + bodyLen).toString('utf8');
    packets.push({ id, type, body });
    offset += 4 + length;
  }
  return { packets, rest: buf.slice(offset) };
}

/**
 * 发一条 RCON 命令并返回拼接后的响应正文。
 * - auth 成功才发 exec；auth 回包 id !== AUTH_ID（常见 -1）即 RCON_AUTH_FAILED；
 * - exec 响应按 EXEC_ID 收集 body，遇到空包结束，否则到超时为止；
 * - 超时抛 RCON_TIMEOUT，建连/ socket 出错抛 RCON_CONN_FAILED；
 * - 所有错误信息禁止含 password。
 */
export function sendRcon(opts: SendRconOptions): Promise<string> {
  const { host, port, password, command } = opts;
  const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_RCON_TIMEOUT_MS);
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let stage: 'auth' | 'exec' = 'auth';
    let recv: Buffer = Buffer.alloc(0);
    const chunks: string[] = [];
    const socket = new net.Socket();

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        /* 忽略 */
      }
    };
    const fail = (err: RconError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const ok = (body: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };

    const timer = setTimeout(() => {
      fail(
        new RconError(
          `RCON 操作超时（${timeoutMs}ms）：${host}:${port} 未在时限内响应`,
          'RCON_TIMEOUT',
        ),
      );
    }, timeoutMs);
    // 超时不应拖住进程退出（vitest / Electron 同款处理）。
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as unknown as { unref(): void }).unref();
    }

    socket.once('connect', () => {
      try {
        socket.write(encodePacket(AUTH_ID, TYPE_AUTH, password));
      } catch (e) {
        fail(
          new RconError(
            `RCON 连接失败：无法向 ${host}:${port} 发送鉴权包（${(e as Error).message}）`,
            'RCON_CONN_FAILED',
          ),
        );
      }
    });

    socket.on('data', (chunk: Buffer) => {
      recv = Buffer.concat([recv, chunk]);
      const decoded = decodeAvailable(recv);
      recv = decoded.rest;
      for (const p of decoded.packets) {
        if (stage === 'auth') {
          // 鉴权失败哨兵：id === -1；或 id 与请求对不上都算失败。
          if (p.id === -1 || p.id !== AUTH_ID) {
            fail(new RconError(`RCON 鉴权失败：${host}:${port} 拒绝了口令`, 'RCON_AUTH_FAILED'));
            return;
          }
          // 鉴权通过（id === AUTH_ID，type 一般为 2）：发 exec。
          stage = 'exec';
          try {
            socket.write(encodePacket(EXEC_ID, TYPE_EXEC, command));
          } catch (e) {
            fail(
              new RconError(
                `RCON 连接失败：无法向 ${host}:${port} 发送命令包（${(e as Error).message}）`,
                'RCON_CONN_FAILED',
              ),
            );
            return;
          }
        } else {
          // exec 阶段：只收同 id 的包；空包 = 服务端说“发完了”。
          if (p.id !== EXEC_ID) continue;
          if (p.body === '') {
            ok(chunks.join(''));
            return;
          }
          chunks.push(p.body);
        }
      }
    });

    socket.once('error', (e: Error) => {
      // 口令绝不进错误信息：只带 host:port 与底层 reason。
      fail(
        new RconError(
          `RCON 连接失败：无法连接到 ${host}:${port}（${e.message}）`,
          'RCON_CONN_FAILED',
        ),
      );
    });
    socket.once('close', () => {
      if (settled) return;
      if (stage === 'auth') {
        fail(
          new RconError(`RCON 连接失败：${host}:${port} 在鉴权前关闭了连接`, 'RCON_CONN_FAILED'),
        );
      } else {
        // exec 阶段对端直接关连接：已有分片就按“到此为止”返回，否则算连接失败。
        // （兼容只回单包不带空终止符的服务端；标准多包仍以空包为准。）
        if (chunks.length > 0) ok(chunks.join(''));
        else
          fail(
            new RconError(`RCON 连接失败：${host}:${port} 在响应前关闭了连接`, 'RCON_CONN_FAILED'),
          );
      }
    });

    try {
      socket.connect(port, host);
    } catch (e) {
      fail(
        new RconError(
          `RCON 连接失败：无法连接到 ${host}:${port}（${(e as Error).message}）`,
          'RCON_CONN_FAILED',
        ),
      );
    }
  });
}
