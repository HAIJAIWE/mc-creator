// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  createCollabTransport,
  createPeerId,
  collabChannelName,
  type CollabTransport,
} from './collab-transport.js';
import type { CollabMessage } from './collab-protocol.js';

function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
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

describe('collab-transport', () => {
  it('channel 命名规则', () => {
    expect(collabChannelName('Steve')).toBe('mc-creator-collab:Steve');
    expect(collabChannelName('')).toBe('mc-creator-collab:default');
  });

  it('peerId 唯一', () => {
    expect(createPeerId()).not.toBe(createPeerId());
  });

  it('双端互通且过滤自身消息', async () => {
    const receivedA: CollabMessage[] = [];
    const receivedB: CollabMessage[] = [];
    const a: CollabTransport | null = createCollabTransport('test-doc', 'peer-a', (m) =>
      receivedA.push(m),
    );
    const b: CollabTransport | null = createCollabTransport('test-doc', 'peer-b', (m) =>
      receivedB.push(m),
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    try {
      a?.post({ kind: 'hello', peerId: 'peer-a', playerName: 'A', revision: 1 });
      await waitFor(() => receivedB.length >= 1);
      expect(receivedB[0]?.kind).toBe('hello');
      // 自身不应收到自己的消息
      await new Promise((r) => setTimeout(r, 100));
      expect(receivedA).toHaveLength(0);

      b?.post({
        kind: 'snapshot',
        peerId: 'peer-b',
        snap: {
          docId: 'test-doc',
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
    } finally {
      a?.close();
      b?.close();
    }
  });
});
