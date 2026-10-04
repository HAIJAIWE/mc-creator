// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CollabRtcPeer } from './collab-webrtc.js';
import type { RtcSignalPayload, CollabSnapshot } from './collab-protocol.js';

/** 最小 Mock RTCPeerConnection：记录调用，支持手动触发事件 */
class MockPC {
  onicecandidate: ((ev: { candidate: { toJSON: () => object } | null }) => void) | null = null;
  ondatachannel: ((ev: { channel: MockDC }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  local: unknown = null;
  remote: unknown = null;
  ice: unknown[] = [];
  closed = false;
  dc: MockDC | null = null;

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }
  async setLocalDescription(desc: unknown) {
    this.local = desc;
    // 模拟 ICE 收集结束
    queueMicrotask(() => this.onicecandidate?.({ candidate: null }));
  }
  async setRemoteDescription(desc: unknown) {
    this.remote = desc;
  }
  async addIceCandidate(c: unknown) {
    this.ice.push(c);
  }
  createDataChannel() {
    this.dc = new MockDC();
    return this.dc;
  }
  close() {
    this.closed = true;
  }
  /** 测试手段：模拟连通 */
  simulateConnected() {
    this.connectionState = 'connected';
    this.onconnectionstatechange?.();
  }
}

class MockDC {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  simulateOpen() {
    this.onopen?.();
  }
  deliver(data: string) {
    this.onmessage?.({ data });
  }
}

const snap = (): CollabSnapshot => ({
  docId: 'Steve',
  playerName: 'Steve',
  skinDataUrl: 'data:A',
  capeDataUrl: null,
  revision: 2,
  updatedAt: 200,
  updatedBy: 'peer-a',
});

describe('collab-webrtc', () => {
  it('发起方发出 offer，收到 answer 后可经 DC 发送快照', async () => {
    const signals: Array<{ to: string; signal: RtcSignalPayload }> = [];
    const pcs: MockPC[] = [];
    const peer = new CollabRtcPeer({
      peerId: 'peer-a',
      sendSignal: (to, signal) => signals.push({ to, signal }),
      onSnapshot: () => {},
      createConnection: () => {
        const pc = new MockPC();
        pcs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
    });

    await peer.connectTo('peer-b');
    const offers = signals.filter((s) => s.signal.type === 'offer');
    expect(offers).toHaveLength(1);
    expect(offers[0]?.to).toBe('peer-b');
    expect(offers[0]?.signal.type).toBe('offer');

    // 对端 answer
    await peer.handleSignal('peer-b', { type: 'answer', sdp: 'mock-answer-sdp' });
    expect(pcs[0]?.remote).toEqual({ type: 'answer', sdp: 'mock-answer-sdp' });

    // ICE 透传
    await peer.handleSignal('peer-b', { type: 'ice', candidate: JSON.stringify({ candidate: 'c' }) });
    expect(pcs[0]?.ice).toHaveLength(1);

    // 未 open 前发送失败
    expect(peer.sendSnapshot('peer-b', snap())).toBe(false);

    // 模拟连通
    pcs[0]?.simulateConnected();
    (pcs[0]?.dc as MockDC | null)?.simulateOpen();
    expect(peer.isOpen('peer-b')).toBe(true);
    expect(peer.sendSnapshot('peer-b', snap())).toBe(true);
    const sent = (pcs[0]?.dc as MockDC | null)?.sent ?? [];
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] as string).snap.revision).toBe(2);
  });

  it('收到 offer 后回 answer，入向 DC 消息投递快照', async () => {
    const signals: Array<{ to: string; signal: RtcSignalPayload }> = [];
    const snapshots: CollabSnapshot[] = [];
    const pcs: MockPC[] = [];
    const peer = new CollabRtcPeer({
      peerId: 'peer-b',
      sendSignal: (to, signal) => signals.push({ to, signal }),
      onSnapshot: (s) => snapshots.push(s),
      createConnection: () => {
        const pc = new MockPC();
        pcs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
    });

    await peer.handleSignal('peer-a', { type: 'offer', sdp: 'mock-offer-sdp' });
    const answers = signals.filter((s) => s.signal.type === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.to).toBe('peer-a');

    // 模拟对端建好的 DC 到达
    const inbound = new MockDC();
    pcs[0]?.ondatachannel?.({ channel: inbound });
    inbound.simulateOpen();
    inbound.deliver(JSON.stringify({ v: 1, kind: 'snapshot', peerId: 'peer-a', snap: snap() }));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.revision).toBe(2);
  });

  it('重复 connectTo 不重复建连；closePeer 清理', async () => {
    let created = 0;
    const peer = new CollabRtcPeer({
      peerId: 'peer-a',
      sendSignal: () => {},
      onSnapshot: () => {},
      createConnection: () => {
        created += 1;
        return new MockPC() as unknown as RTCPeerConnection;
      },
    });
    await peer.connectTo('peer-b');
    await peer.connectTo('peer-b');
    expect(created).toBe(1);
    expect(peer.getState('peer-b')).toBe('connecting');
    peer.closePeer('peer-b');
    expect(peer.getState('peer-b')).toBeNull();
    expect(peer.sendSnapshot('peer-b', snap())).toBe(false);
  });

  it('坏包与未知目标安全忽略', async () => {
    const peer = new CollabRtcPeer({
      peerId: 'peer-a',
      sendSignal: () => {},
      onSnapshot: () => {
        throw new Error('不应被调用');
      },
      createConnection: () => new MockPC() as unknown as RTCPeerConnection,
    });
    await peer.handleSignal('peer-unknown', { type: 'answer', sdp: 'x' });
    await peer.handleSignal('peer-unknown', { type: 'ice', candidate: null });
    expect(peer.targets).toHaveLength(0);
  });
});
