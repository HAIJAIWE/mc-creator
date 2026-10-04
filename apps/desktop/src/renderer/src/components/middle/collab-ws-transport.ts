/**
 * v2.0 协作传输层（WebSocket 中继，跨机联调）。
 *
 * 与 BroadcastChannel 传输实现同一形状（见 collab-transport.ts），
 * 面板层可同时挂载多个通道；信令/快照消息格式完全一致，
 * 本机联调与跨机只需切换通道，无需改业务逻辑。
 */
import { decodeMessage, encodeMessage, type CollabMessage } from './collab-protocol';

export interface CollabWsTransportOptions {
  onMessage: (msg: CollabMessage) => void;
  onOpen?: () => void;
  onClose?: (code: number) => void;
  /** 断线重连间隔（毫秒），0 表示不重连 */
  reconnectMs?: number;
}

export interface CollabWsTransport {
  readonly peerId: string;
  readonly channelName: string;
  readonly url: string;
  post(msg: CollabMessage): void;
  close(): void;
}

export function createCollabWsTransport(
  url: string,
  docId: string,
  peerId: string,
  opts: CollabWsTransportOptions,
): CollabWsTransport | null {
  if (typeof WebSocket === 'undefined') return null;
  const channelName = `ws:${url}#${docId || 'default'}`;
  const sep = url.includes('?') ? '&' : '?';
  const target = `${url}${sep}docId=${encodeURIComponent(docId || 'default')}&peerId=${encodeURIComponent(peerId)}`;

  let socket: WebSocket | null = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reconnectMs = opts.reconnectMs ?? 2000;

  const connect = () => {
    if (closed) return;
    try {
      socket = new WebSocket(target);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      opts.onOpen?.();
    };
    socket.onmessage = (ev) => {
      try {
        if (typeof ev.data !== 'string') return;
        const msg = decodeMessage(ev.data);
        if (msg.peerId === peerId) return;
        opts.onMessage(msg);
      } catch {
        /* 坏包静默丢弃 */
      }
    };
    const handleDown = (code: number) => {
      opts.onClose?.(code);
      scheduleReconnect();
    };
    socket.onclose = (ev) => handleDown(ev.code);
    socket.onerror = () => {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
    };
  };

  const scheduleReconnect = () => {
    if (closed || reconnectMs <= 0) return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, reconnectMs);
  };

  connect();

  return {
    peerId,
    channelName,
    url,
    post(msg: CollabMessage) {
      try {
        if (socket && socket.readyState === 1) {
          socket.send(encodeMessage(msg));
        }
      } catch {
        /* ignore */
      }
    },
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}
