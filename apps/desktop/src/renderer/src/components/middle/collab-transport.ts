/**
 * v2.0 协作传输层（BroadcastChannel，同机多窗口实时同步）。
 *
 * - 每个文档一个 channel：`mc-creator-collab:<docId>`。
 * - 自己发出的消息不会回送给自己（BroadcastChannel 语义），
 *   为保险起见仍按 peerId 过滤。
 * - 无 BroadcastChannel 的环境返回 null，由调用方降级为单机模式。
 * - WebRTC/DataChannel 阶段只需实现同名接口替换本类。
 */
import { decodeMessage, encodeMessage, type CollabMessage, type CollabPresence } from './collab-protocol';

export function createPeerId(): string {
  return `peer-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function collabChannelName(docId: string): string {
  return `mc-creator-collab:${docId || 'default'}`;
}

export interface CollabTransport {
  readonly peerId: string;
  readonly channelName: string;
  post(msg: CollabMessage): void;
  close(): void;
}

export function createCollabTransport(
  docId: string,
  peerId: string,
  onMessage: (msg: CollabMessage) => void,
): CollabTransport | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channelName = collabChannelName(docId);
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (ev: MessageEvent) => {
    try {
      if (typeof ev.data !== 'string') return;
      const msg = decodeMessage(ev.data);
      if (msg.peerId === peerId) return;
      onMessage(msg);
    } catch {
      /* 坏包静默丢弃 */
    }
  };
  return {
    peerId,
    channelName,
    post(msg: CollabMessage) {
      try {
        channel.postMessage(encodeMessage(msg));
      } catch {
        /* ignore */
      }
    },
    close() {
      try {
        channel.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export function emptyPresence(peerId: string, playerName: string, color: string): CollabPresence {
  return { peerId, playerName, color, cursor: null, updatedAt: Date.now() };
}
