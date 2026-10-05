// @vitest-environment node
/**
 * 中继端到端：起真实的 scripts/collab-relay.mjs 进程，
 * 两端用真实的 createCollabWsTransport 完成 hello/snapshot кръговрат。
 * 覆盖测试内联中继测不到的东西：脚本参数解析、join/leave 日志路径、
 * 真实网络下的编解码与房间隔离。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCollabWsTransport } from './collab-ws-transport.js';
import type { CollabMessage } from './collab-protocol.js';

const PORT = 18787;
const URL = `ws://127.0.0.1:${PORT}`;
let child: ChildProcess | null = null;

function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (cond()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('等待中继消息超时'));
      }
    }, 20);
  });
}

describe('collab-relay e2e（真实脚本进程）', () => {
  beforeAll(async () => {
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../../scripts/collab-relay.mjs',
    );
    child = spawn(process.execPath, [script, '--port', String(PORT), '--host', '127.0.0.1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    child.stdout?.on('data', (d: Buffer) => output.push(d.toString()));
    child.stderr?.on('data', (d: Buffer) => output.push(d.toString()));
    child.on('error', (e) => output.push(`spawn error: ${(e as Error).message}`));
    try {
      await waitFor(() => output.join('').includes('listening on'), 8000);
    } catch {
      throw new Error(`中继未启动，子进程输出：${output.join('').slice(0, 500) || '(无)'}`);
    }
  }, 15000);

  afterAll(async () => {
    if (child) {
      child.kill();
      await new Promise((r) => setTimeout(r, 200));
      child = null;
    }
  });

  it('双端经真实中继完成 hello/snapshot 往返，且房间隔离', async () => {
    const receivedA: CollabMessage[] = [];
    const receivedB: CollabMessage[] = [];
    const receivedOther: CollabMessage[] = [];
    const a = createCollabWsTransport(URL, 'e2e-room', 'e2e-a', {
      onMessage: (m) => receivedA.push(m),
    });
    const b = createCollabWsTransport(URL, 'e2e-room', 'e2e-b', {
      onMessage: (m) => receivedB.push(m),
    });
    const c = createCollabWsTransport(URL, 'other-room', 'e2e-c', {
      onMessage: (m) => receivedOther.push(m),
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    try {
      await new Promise((r) => setTimeout(r, 400));
      a?.post({ kind: 'hello', peerId: 'e2e-a', playerName: 'A', revision: 1 });
      await waitFor(() => receivedB.length >= 1);
      expect(receivedB[0]?.kind).toBe('hello');
      await new Promise((r) => setTimeout(r, 150));
      expect(receivedA).toHaveLength(0);
      expect(receivedOther).toHaveLength(0);

      const snap = {
        docId: 'e2e-room',
        playerName: 'B',
        skinDataUrl: 'data:E2E',
        capeDataUrl: null,
        revision: 2,
        updatedAt: Date.now(),
        updatedBy: 'e2e-b',
      };
      b?.post({ kind: 'snapshot', peerId: 'e2e-b', snap });
      await waitFor(() => receivedA.length >= 1);
      const got = receivedA[0];
      expect(got?.kind).toBe('snapshot');
      if (got?.kind === 'snapshot') {
        expect(got.snap.skinDataUrl).toBe('data:E2E');
        expect(got.snap.revision).toBe(2);
      }
      expect(receivedOther).toHaveLength(0);
    } finally {
      a?.close();
      b?.close();
      c?.close();
    }
  });
});
