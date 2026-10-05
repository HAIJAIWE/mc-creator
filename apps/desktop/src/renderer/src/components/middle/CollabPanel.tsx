import { useCallback, useEffect, useRef, useState } from 'react';
import { Users, Send, Radio } from 'lucide-react';
import {
  mergeSnapshots,
  mergePresence,
  type CollabMessage,
  type CollabSnapshot,
  type CollabPresence,
  type RtcSignalPayload,
} from './collab-protocol';
import { createCollabTransport, createPeerId, type CollabTransport } from './collab-transport';
import { createCollabWsTransport, type CollabWsTransport } from './collab-ws-transport';
import { CollabRtcPeer, type RtcPeerState } from './collab-webrtc';

interface CollabPanelProps {
  /** 文档 ID（用玩家名） */
  docId: string;
  playerName: string;
  getSnapshot: () => { skinDataUrl: string | null; capeDataUrl: string | null };
  onRemoteSnapshot: (snap: CollabSnapshot) => void;
}

const PEER_COLORS = ['#2ba8a0', '#e8d878', '#e84a4a', '#4a8aff', '#7a5aa8', '#d97b2e'];

function colorForPeer(peerId: string): string {
  let h = 0;
  for (let i = 0; i < peerId.length; i++) h = (h * 31 + (peerId.charCodeAt(i) ?? 0)) % 997;
  return PEER_COLORS[h % PEER_COLORS.length] ?? '#2ba8a0';
}

export function CollabPanel({
  docId,
  playerName,
  getSnapshot,
  onRemoteSnapshot,
}: CollabPanelProps) {
  const [peerId] = useState(() => createPeerId());
  const [peers, setPeers] = useState<Map<string, CollabPresence>>(new Map());
  const [revision, setRevision] = useState(1);
  const [autoApply, setAutoApply] = useState(true);
  const [lastEvent, setLastEvent] = useState('等待连接…');
  const [supported] = useState(() => typeof BroadcastChannel !== 'undefined');
  const [open, setOpen] = useState(true);

  const transportRef = useRef<CollabTransport | null>(null);
  const relayRef = useRef<CollabWsTransport | null>(null);
  const rtcRef = useRef<CollabRtcPeer | null>(null);
  const [rtcStates, setRtcStates] = useState<Map<string, RtcPeerState>>(new Map());
  const [relayUrl, setRelayUrl] = useState(() => {
    try {
      return localStorage.getItem('mc-creator-collab-relay') ?? 'ws://127.0.0.1:8787';
    } catch {
      return 'ws://127.0.0.1:8787';
    }
  });
  const [relayStatus, setRelayStatus] = useState<'off' | 'connecting' | 'on'>('off');
  const lastSnapRef = useRef<CollabSnapshot | null>(null);
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;
  const onRemoteRef = useRef(onRemoteSnapshot);
  onRemoteRef.current = onRemoteSnapshot;
  const autoApplyRef = useRef(autoApply);
  autoApplyRef.current = autoApply;
  const playerNameRef = useRef(playerName);
  playerNameRef.current = playerName;

  // 远端快照统一入口（BroadcastChannel 与 DataChannel 共用）：LWW + 可选自动应用
  const applyIncomingSnap = useCallback((snap: CollabSnapshot, via: string) => {
    const winner = mergeSnapshots(lastSnapRef.current, snap);
    const isRemote = winner === snap;
    lastSnapRef.current = winner;
    setRevision(snap.revision);
    if (isRemote) {
      setLastEvent(`收到 ${snap.updatedBy.slice(0, 12)}… 的新版本（r${snap.revision}，${via}）`);
      if (autoApplyRef.current) {
        onRemoteRef.current(snap);
        setLastEvent(`已应用远端版本 r${snap.revision}`);
      }
    }
  }, []);
  const applyIncomingSnapRef = useRef(applyIncomingSnap);
  applyIncomingSnapRef.current = applyIncomingSnap;

  // 全通道广播（本机 BC + 跨机中继，两个都连上时都会收到，去重靠 LWW）
  const postToAll = useCallback((msg: Parameters<CollabTransport['post']>[0]) => {
    transportRef.current?.post(msg);
    relayRef.current?.post(msg);
  }, []);
  const postToAllRef = useRef(postToAll);
  postToAllRef.current = postToAll;

  // 通道共用消息处理（channel 区分回包通道）
  const handleChannelMessage = useCallback(
    (channel: { post: (msg: CollabMessage) => void }, msg: CollabMessage) => {
      if (msg.kind === 'rtc') {
        // WebRTC 信令只处理发给自己的
        if (msg.to !== peerId) return;
        void rtcRef.current?.handleSignal(msg.peerId, msg.signal).catch(() => {
          /* 信令异常静默忽略 */
        });
        return;
      }
      if (msg.kind === 'hello' || msg.kind === 'presence') {
        if (msg.kind === 'hello') {
          channel.post({
            kind: 'presence',
            peerId,
            presence: {
              peerId,
              playerName: playerNameRef.current,
              color: colorForPeer(peerId),
              cursor: null,
              updatedAt: Date.now(),
            },
          });
        }
        if (msg.kind === 'presence') {
          setPeers((prev) => mergePresence(prev, msg));
        } else {
          setPeers((prev) => {
            const next = new Map(prev);
            next.set(msg.peerId, {
              peerId: msg.peerId,
              playerName: msg.playerName,
              color: colorForPeer(msg.peerId),
              cursor: null,
              updatedAt: Date.now(),
            });
            return next;
          });
        }
        setLastEvent(`发现节点 ${msg.peerId.slice(0, 12)}…`);
      } else if (msg.kind === 'snapshot') {
        applyIncomingSnapRef.current(msg.snap, '广播');
      } else if (msg.kind === 'bye') {
        setPeers((prev) => {
          const next = new Map(prev);
          next.delete(msg.peerId);
          return next;
        });
      }
    },
    [peerId],
  );
  const handleChannelMessageRef = useRef(handleChannelMessage);
  handleChannelMessageRef.current = handleChannelMessage;

  useEffect(() => {
    if (!supported) {
      setLastEvent('当前环境不支持 BroadcastChannel，仅单机模式');
      return;
    }
    const transport = createCollabTransport(docId, peerId, (msg) => {
      if (transport) handleChannelMessageRef.current(transport, msg);
    });
    transportRef.current = transport;
    if (!transport) return;
    // WebRTC 直连实例：信令经由全部传输层透传（本机 BC + 跨机中继）
    const rtc = new CollabRtcPeer({
      peerId,
      sendSignal: (to: string, signal: RtcSignalPayload) => {
        postToAllRef.current({ kind: 'rtc', peerId, to, signal });
      },
      onSnapshot: (snap) => {
        applyIncomingSnapRef.current(snap, '直连');
      },
      onStateChange: (targetPeerId, state) => {
        setRtcStates((prev) => {
          const next = new Map(prev);
          if (state === 'closed') next.delete(targetPeerId);
          else next.set(targetPeerId, state);
          return next;
        });
        if (state === 'open') setLastEvent(`已与 ${targetPeerId.slice(0, 12)}… 建立直连`);
      },
    });
    rtcRef.current = rtc;
    transport.post({ kind: 'hello', peerId, playerName, revision: 1 });
    const timer = setInterval(() => {
      transport.post({
        kind: 'presence',
        peerId,
        presence: {
          peerId,
          playerName: playerNameRef.current,
          color: colorForPeer(peerId),
          cursor: null,
          updatedAt: Date.now(),
        },
      });
      // 顺带剔除过期节点
      setPeers((prev) => {
        const now = Date.now();
        const next = new Map(prev);
        for (const [id, p] of next) {
          if (now - p.updatedAt > 30_000) next.delete(id);
        }
        return next;
      });
    }, 5000);
    return () => {
      clearInterval(timer);
      try {
        transport?.post({ kind: 'bye', peerId });
      } catch {
        /* ignore */
      }
      rtcRef.current?.closeAll();
      rtcRef.current = null;
      transport?.close();
      transportRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, peerId, supported]);

  const handleBroadcast = () => {
    const { skinDataUrl, capeDataUrl } = getSnapshotRef.current();
    if (!skinDataUrl && !capeDataUrl) {
      setLastEvent('没有可广播的纹理');
      return;
    }
    const snap: CollabSnapshot = {
      docId,
      playerName: playerNameRef.current,
      skinDataUrl,
      capeDataUrl,
      revision: revision + 1,
      updatedAt: Date.now(),
      updatedBy: peerId,
    };
    lastSnapRef.current = snap;
    setRevision((r) => r + 1);
    postToAllRef.current({ kind: 'snapshot', peerId, snap });
    // 已直连的节点额外走 DataChannel 发一份（跨机就绪后即为主通道）
    const rtc = rtcRef.current;
    if (rtc) {
      for (const target of rtc.targets) {
        rtc.sendSnapshot(target, snap);
      }
    }
    setLastEvent(`已广播 r${snap.revision}（已连通道可接收）`);
  };

  const handleConnect = (targetPeerId: string) => {
    const rtc = rtcRef.current;
    if (!rtc) {
      setLastEvent('直连不可用（传输层未就绪）');
      return;
    }
    setLastEvent(`正在与 ${targetPeerId.slice(0, 12)}… 建立直连…`);
    void rtc.connectTo(targetPeerId).catch(() => {
      setLastEvent('直连建立失败（对方可能已离线）');
    });
  };

  const handleRelayToggle = () => {
    if (relayRef.current) {
      try {
        relayRef.current.post({ kind: 'bye', peerId });
      } catch {
        /* ignore */
      }
      relayRef.current.close();
      relayRef.current = null;
      setRelayStatus('off');
      setLastEvent('已断开中继');
      return;
    }
    const url = relayUrl.trim();
    if (!url) {
      setLastEvent('请先填写中继地址');
      return;
    }
    try {
      localStorage.setItem('mc-creator-collab-relay', url);
    } catch {
      /* ignore */
    }
    setRelayStatus('connecting');
    setLastEvent(`正在连接中继 ${url}…`);
    const relay = createCollabWsTransport(url, docId, peerId, {
      onMessage: (msg) => {
        if (relay) handleChannelMessageRef.current(relay, msg);
      },
      onOpen: () => {
        setRelayStatus('on');
        setLastEvent(`中继已连接（${url}），可跨机协作`);
        relay?.post({ kind: 'hello', peerId, playerName: playerNameRef.current, revision });
      },
      onClose: () => {
        setRelayStatus((s) => (relayRef.current ? 'connecting' : s));
        setLastEvent('中继断开，2s 后自动重连…');
      },
    });
    if (!relay) {
      setRelayStatus('off');
      setLastEvent('当前环境不支持 WebSocket，仅单机模式');
      return;
    }
    relayRef.current = relay;
  };

  // docId 变化时断开旧中继（由用户重新连接）
  useEffect(() => {
    return () => {
      relayRef.current?.close();
      relayRef.current = null;
    };
  }, [docId]);

  return (
    <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mc-dim"
      >
        <Users className="h-3 w-3" /> 协作{peers.size > 0 ? ` · ${peers.size} 人在线` : ''}
        {relayStatus === 'on' && <span className="text-green-400">· 中继已连</span>}
      </button>
      {open && (
        <>
          {!supported ? (
            <div className="text-[11px] text-mc-mute">当前环境不支持，仅单机模式可用。</div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-mc-dim">
                <Radio className="h-3 w-3 text-green-400" />
                <span className="font-mono">本机 {peerId.slice(0, 14)}…</span>
                <label className="ml-auto flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={autoApply}
                    onChange={(e) => setAutoApply(e.target.checked)}
                    className="accent-mc-primary"
                  />
                  自动应用远端
                </label>
              </div>
              {peers.size > 0 && (
                <div className="mb-2 flex flex-col gap-1">
                  {[...peers.values()].map((p) => {
                    const rtcState = rtcStates.get(p.peerId);
                    return (
                      <div
                        key={p.peerId}
                        className="flex items-center gap-1.5 rounded-mc border border-mc-border bg-mc-surface-3 px-1.5 py-1 text-[10px] text-mc-text"
                        title={p.peerId}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="min-w-0 flex-1 truncate">{p.playerName}</span>
                        {rtcState === 'open' ? (
                          <span className="shrink-0 text-green-400" title="DataChannel 已直连">
                            直连中
                          </span>
                        ) : rtcState === 'connecting' ? (
                          <span className="shrink-0 text-mc-accent">连接中…</span>
                        ) : (
                          <button
                            onClick={() => handleConnect(p.peerId)}
                            className="shrink-0 rounded border border-mc-border px-1.5 py-0.5 text-[10px] text-mc-dim hover:border-mc-accent hover:text-mc-text"
                            title="经由信令建立 WebRTC DataChannel 直连（跨机就绪后即为主通道）"
                          >
                            直连
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                onClick={handleBroadcast}
                className="flex w-full items-center justify-center gap-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1.5 text-[11px] text-mc-text hover:border-mc-accent"
                title="把当前皮肤+披风广播给已连通道（本机窗口/中继房间）"
              >
                <Send className="h-3.5 w-3.5" /> 广播当前皮肤
              </button>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={relayUrl}
                  onChange={(e) => setRelayUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && relayStatus === 'off') handleRelayToggle();
                  }}
                  placeholder="中继 ws://host:8787（跨机）"
                  className="min-w-0 flex-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1 text-[11px] text-mc-text placeholder:text-mc-mute"
                  title="启动 scripts/collab-relay.mjs 后填入地址；回车连接"
                />
                <button
                  onClick={handleRelayToggle}
                  className={`shrink-0 rounded-mc border px-2 py-1 text-[11px] transition-colors ${
                    relayStatus === 'on'
                      ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                      : relayStatus === 'connecting'
                        ? 'border-mc-border bg-mc-surface-3 text-mc-accent'
                        : 'border-mc-border bg-mc-surface-3 text-mc-dim hover:text-mc-text'
                  }`}
                >
                  {relayStatus === 'on'
                    ? '断开'
                    : relayStatus === 'connecting'
                      ? '连接中…'
                      : '连接'}
                </button>
              </div>
              <div className="mt-1.5 truncate text-[10px] text-mc-mute" title={lastEvent}>
                {lastEvent}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
