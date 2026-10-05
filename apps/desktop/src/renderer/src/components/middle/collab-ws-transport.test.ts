// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { createCollabWsTransport } from './collab-ws-transport.js';
import type { CollabMessage } from './collab-protocol.js';

function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (cond()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('等待协作消息超时'));
      }
    }, 20);
  });
}

describe('collab-ws-transport', () => {
  const servers: WebSocketServer[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  /** 起一个按 docId 分房的中继（与 scripts/collab-relay.mjs 同语义） */
  async function startRelay(): Promise<string> {
    const rooms = new Map<string, Set<import('ws').WebSocket>>();
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss.on('connection', (ws: import('ws').WebSocket, req) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const docId = url.searchParams.get('docId') || 'default';
      let set = rooms.get(docId);
      if (!set) {
        set = new Set();
        rooms.set(docId, set);
      }
      set.add(ws);
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        for (const peer of set ?? []) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(data.toString());
        }
      });
      ws.on('close', () => {
        set?.delete(ws);
        if (set?.size === 0) rooms.delete(docId);
      });
    });
    await new Promise<void>((resolve) => wss.on('listening', resolve));
    const addr = wss.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    servers.push(wss);
    return `ws://127.0.0.1:${port}`;
  }

  it('双端经中继互通、自身消息过滤、房间隔离', async () => {
    const url = await startRelay();
    const receivedA: CollabMessage[] = [];
    const receivedB: CollabMessage[] = [];
    const receivedC: CollabMessage[] = [];
    const a = createCollabWsTransport(url, 'room1', 'peer-a', {
      onMessage: (m) => receivedA.push(m),
    });
    const b = createCollabWsTransport(url, 'room1', 'peer-b', {
      onMessage: (m) => receivedB.push(m),
    });
    const c = createCollabWsTransport(url, 'room2', 'peer-c', {
      onMessage: (m) => receivedC.push(m),
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    try {
      // 等待三端连接建立
      await new Promise((r) => setTimeout(r, 300));
      a?.post({ kind: 'hello', peerId: 'peer-a', playerName: 'A', revision: 1 });
      await waitFor(() => receivedB.length >= 1);
      expect(receivedB[0]?.kind).toBe('hello');
      await new Promise((r) => setTimeout(r, 150));
      // 自身不回送，不同房间收不到
      expect(receivedA).toHaveLength(0);
      expect(receivedC).toHaveLength(0);

      b?.post({
        kind: 'snapshot',
        peerId: 'peer-b',
        snap: {
          docId: 'room1',
          playerName: 'B',
          skinDataUrl: 'data:X',
          capeDataUrl: null,
          revision: 2,
          updatedAt: Date.now(),
          updatedBy: 'peer-b',
        },
      });
      await waitFor(() => receivedA.length >= 1);
      expect(receivedA[0]?.kind).toBe('snapshot');
      expect(receivedC).toHaveLength(0);
    } finally {
      a?.close();
      b?.close();
      c?.close();
    }
  });
});
