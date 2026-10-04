/**
 * v2.0 WebRTC 直连（DataChannel 传快照）。
 *
 * - 信令经由既有传输层透传（同机为 BroadcastChannel；跨机时换成 WebSocket
 *   中继即可，信令格式不变）。
 * - RTCPeerConnection 通过工厂注入，便于单测使用 Mock；生产环境默认
 *   `new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })`。
 * - 建连后快照走 DataChannel（`mc-doc`），BroadcastChannel 仍作为
 *   兜底广播通道。
 */
import {
  decodeMessage,
  type CollabMessage,
  type CollabSnapshot,
  type RtcSignalPayload,
} from './collab-protocol';

export type RtcPeerState = 'connecting' | 'open' | 'closed';

export interface CollabRtcOptions {
  peerId: string;
  /** 经由信令通道发送 */
  sendSignal: (to: string, signal: RtcSignalPayload) => void;
  /** 收到远端快照（DataChannel） */
  onSnapshot: (snap: CollabSnapshot, fromPeerId: string) => void;
  onStateChange?: (targetPeerId: string, state: RtcPeerState) => void;
  createConnection?: () => RTCPeerConnection;
}

const DATA_CHANNEL_LABEL = 'mc-doc';

function defaultCreateConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
}

interface PeerSlot {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  state: RtcPeerState;
}

export class CollabRtcPeer {
  private readonly opts: CollabRtcOptions;
  private readonly slots = new Map<string, PeerSlot>();

  constructor(opts: CollabRtcOptions) {
    this.opts = opts;
  }

  get targets(): string[] {
    return [...this.slots.keys()];
  }

  getState(targetPeerId: string): RtcPeerState | null {
    return this.slots.get(targetPeerId)?.state ?? null;
  }

  isOpen(targetPeerId: string): boolean {
    return this.slots.get(targetPeerId)?.state === 'open';
  }

  /** 向目标节点发起直连（创建 offer） */
  async connectTo(targetPeerId: string): Promise<void> {
    const existing = this.slots.get(targetPeerId);
    if (existing && existing.state !== 'closed') return;
    const pc = (this.opts.createConnection ?? defaultCreateConnection)();
    const slot: PeerSlot = { pc, dc: null, state: 'connecting' };
    this.slots.set(targetPeerId, slot);
    this.setState(targetPeerId, 'connecting');
    this.wirePeerConnection(targetPeerId, pc);
    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
    slot.dc = dc;
    this.wireDataChannel(targetPeerId, dc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.opts.sendSignal(targetPeerId, { type: 'offer', sdp: offer.sdp ?? '' });
  }

  /** 处理经由信令通道收到的 offer/answer/ice */
  async handleSignal(fromPeerId: string, signal: RtcSignalPayload): Promise<void> {
    if (signal.type === 'offer') {
      let slot = this.slots.get(fromPeerId);
      if (!slot || slot.state === 'closed') {
        const pc = (this.opts.createConnection ?? defaultCreateConnection)();
        slot = { pc, dc: null, state: 'connecting' };
        this.slots.set(fromPeerId, slot);
        this.setState(fromPeerId, 'connecting');
        this.wirePeerConnection(fromPeerId, pc);
        pc.ondatachannel = (ev) => {
          slot!.dc = ev.channel;
          this.wireDataChannel(fromPeerId, ev.channel);
        };
      }
      await slot.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      const answer = await slot.pc.createAnswer();
      await slot.pc.setLocalDescription(answer);
      this.opts.sendSignal(fromPeerId, { type: 'answer', sdp: answer.sdp ?? '' });
    } else if (signal.type === 'answer') {
      const slot = this.slots.get(fromPeerId);
      if (!slot) return;
      await slot.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
    } else {
      const slot = this.slots.get(fromPeerId);
      if (!slot || signal.candidate == null) return;
      try {
        await slot.pc.addIceCandidate(JSON.parse(signal.candidate) as RTCIceCandidateInit);
      } catch {
        /* 异常 candidate 忽略 */
      }
    }
  }

  /** 经由已建立的 DataChannel 发送快照，返回是否送达 */
  sendSnapshot(targetPeerId: string, snap: CollabSnapshot): boolean {
    const slot = this.slots.get(targetPeerId);
    if (!slot?.dc || slot.state !== 'open') return false;
    try {
      slot.dc.send(
        JSON.stringify({
          v: 1,
          kind: 'snapshot',
          peerId: this.opts.peerId,
          snap,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  closePeer(targetPeerId: string): void {
    const slot = this.slots.get(targetPeerId);
    if (!slot) return;
    try {
      slot.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      slot.pc.close();
    } catch {
      /* ignore */
    }
    this.slots.delete(targetPeerId);
    this.setState(targetPeerId, 'closed');
  }

  closeAll(): void {
    for (const id of [...this.slots.keys()]) this.closePeer(id);
  }

  private setState(targetPeerId: string, state: RtcPeerState): void {
    const slot = this.slots.get(targetPeerId);
    if (slot) slot.state = state;
    this.opts.onStateChange?.(targetPeerId, state);
  }

  private wirePeerConnection(targetPeerId: string, pc: RTCPeerConnection): void {
    pc.onicecandidate = (ev) => {
      this.opts.sendSignal(targetPeerId, {
        type: 'ice',
        candidate: ev.candidate ? JSON.stringify(ev.candidate.toJSON()) : null,
      });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') this.setState(targetPeerId, 'open');
      else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        this.setState(targetPeerId, 'closed');
      }
    };
  }

  private wireDataChannel(targetPeerId: string, dc: RTCDataChannel): void {
    dc.onopen = () => this.setState(targetPeerId, 'open');
    dc.onclose = () => this.setState(targetPeerId, 'closed');
    dc.onmessage = (ev) => {
      try {
        if (typeof ev.data !== 'string') return;
        const msg = decodeMessage(ev.data) as Extract<CollabMessage, { kind: 'snapshot' }>;
        if (msg.kind !== 'snapshot') return;
        this.opts.onSnapshot(msg.snap, targetPeerId);
      } catch {
        /* 坏包静默丢弃 */
      }
    };
  }
}
