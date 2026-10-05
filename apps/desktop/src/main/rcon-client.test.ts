/**
 * rcon-client 测试（§7.4 RCON 回退）。
 * 本地 TCP fake RCON 服务器手写握手，不连真实服务端。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { sendRcon, RconError, DEFAULT_RCON_TIMEOUT_MS } from './rcon-client.js';

const HOST = '127.0.0.1';

function encode(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf8');
  const length = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + length);
  buf.writeInt32LE(length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  return buf;
}

interface Pkt {
  id: number;
  type: number;
  body: string;
}

function decode(buf: Buffer): { packets: Pkt[]; rest: Buffer } {
  const packets: Pkt[] = [];
  let off = 0;
  while (buf.length - off >= 4) {
    const len = buf.readInt32LE(off);
    if (len < 10 || len > 64 * 1024 * 1024) break;
    if (buf.length - off - 4 < len) break;
    packets.push({
      id: buf.readInt32LE(off + 4),
      type: buf.readInt32LE(off + 8),
      body: buf.slice(off + 12, off + 12 + (len - 10)).toString('utf8'),
    });
    off += 4 + len;
  }
  return { packets, rest: buf.slice(off) };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, HOST, () => {
      const a = s.address() as net.AddressInfo;
      s.close(() => resolve(a.port));
    });
  });
}

let servers: net.Server[] = [];
afterEach(async () => {
  for (const s of servers) {
    await new Promise<void>((r) => s.close(() => r()));
  }
  servers = [];
});

/** 起一个“标准行为” fake RCON：验口令 → 回 exec 响应 + 空包终止。 */
async function startStandardRcon(opts: {
  password: string;
  respond?: (cmd: string) => string[];
}): Promise<number> {
  const port = await getFreePort();
  const srv = net.createServer((sock) => {
    let buf: Buffer = Buffer.alloc(0);
    let authed = false;
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const d = decode(buf);
      buf = d.rest;
      for (const p of d.packets) {
        if (p.type === 3) {
          if (p.body === opts.password) {
            authed = true;
            sock.write(encode(p.id, 2, ''));
          } else {
            sock.write(encode(-1, 2, ''));
          }
        } else if (p.type === 2) {
          if (!authed) {
            sock.write(encode(-1, 2, ''));
            continue;
          }
          const parts = opts.respond ? opts.respond(p.body) : [`ok:${p.body}`];
          for (const part of parts) sock.write(encode(p.id, 0, part));
          sock.write(encode(p.id, 0, ''));
        }
      }
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => srv.listen(port, HOST, resolve));
  servers.push(srv);
  return port;
}

describe('rcon-client（Source RCON §7.4）', () => {
  it('默认超时为 5s 且可覆盖', () => {
    expect(DEFAULT_RCON_TIMEOUT_MS).toBe(5_000);
  });

  it('auth 成功 + 执行返回响应正文', async () => {
    const port = await startStandardRcon({ password: 's3cret' });
    const res = await sendRcon({ host: HOST, port, password: 's3cret', command: 'list' });
    expect(res).toBe('ok:list');
  });

  it('多包响应按 id 拼接', async () => {
    const port = await startStandardRcon({
      password: 'pw',
      respond: () => ['hello-', 'world', '!'],
    });
    const res = await sendRcon({ host: HOST, port, password: 'pw', command: 'say hi' });
    expect(res).toBe('hello-world!');
  });

  it('auth 失败抛 RCON_AUTH_FAILED 中文错，且不泄漏口令', async () => {
    const secret = 'right-password-xyz';
    const port = await startStandardRcon({ password: secret });
    try {
      await sendRcon({ host: HOST, port, password: 'wrong-password', command: 'list' });
      expect.unreachable('应抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(RconError);
      expect((e as RconError).code).toBe('RCON_AUTH_FAILED');
      expect((e as Error).message).toContain('鉴权失败');
      expect((e as Error).message).not.toContain(secret);
      expect((e as Error).message).not.toContain('wrong-password');
    }
  });

  it('exec 无响应 → 超时抛 RCON_TIMEOUT（可覆盖 timeoutMs）', async () => {
    // fake：鉴权通过后对 exec 永远不回包。
    const port = await getFreePort();
    const srv = net.createServer((sock) => {
      let buf: Buffer = Buffer.alloc(0);
      sock.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const d = decode(buf);
        buf = d.rest;
        for (const p of d.packets) {
          if (p.type === 3) sock.write(encode(p.id, 2, ''));
          // type 2 故意不回 → 客户端超时
        }
      });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((r) => srv.listen(port, HOST, r));
    servers.push(srv);
    try {
      await sendRcon({ host: HOST, port, password: 'pw', command: 'list', timeoutMs: 200 });
      expect.unreachable('应超时');
    } catch (e) {
      expect(e).toBeInstanceOf(RconError);
      expect((e as RconError).code).toBe('RCON_TIMEOUT');
      expect((e as Error).message).toContain('超时');
      expect((e as Error).message).not.toContain('pw');
    }
  });

  it('连不上抛 RCON_CONN_FAILED 中文错，且不泄漏口令', async () => {
    const port = await getFreePort(); // 拿到即释放：此刻无监听
    const secret = 'conn-secret-abc';
    try {
      await sendRcon({ host: HOST, port, password: secret, command: 'list', timeoutMs: 1000 });
      expect.unreachable('应连不上');
    } catch (e) {
      expect(e).toBeInstanceOf(RconError);
      expect((e as RconError).code).toBe('RCON_CONN_FAILED');
      expect((e as Error).message).toContain('连接失败');
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('socket 半包/粘包仍能正确解包', async () => {
    // 服务端把响应包拆成 1 字节一片发，考验客户端累积缓冲。
    const port = await getFreePort();
    const srv = net.createServer((sock) => {
      let buf: Buffer = Buffer.alloc(0);
      sock.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const d = decode(buf);
        buf = d.rest;
        for (const p of d.packets) {
          if (p.type === 3) {
            sock.write(encode(p.id, 2, ''));
          } else if (p.type === 2) {
            const full = Buffer.concat([encode(p.id, 0, 'frag'), encode(p.id, 0, '')]);
            // 逐字节写，制造极端分片
            for (let i = 0; i < full.length; i += 1) sock.write(full.slice(i, i + 1));
          }
        }
      });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((r) => srv.listen(port, HOST, r));
    servers.push(srv);
    const res = await sendRcon({ host: HOST, port, password: 'pw', command: 'x' });
    expect(res).toBe('frag');
  });
});
