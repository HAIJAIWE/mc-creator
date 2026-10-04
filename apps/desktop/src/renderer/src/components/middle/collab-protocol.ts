/**
 * v2.0 协作协议地基（纯函数，无网络依赖，可单测）。
 *
 * 设计：文档级 LWW（Last-Writer-Wins）按图层合并。
 * - 每个图层携带 updatedAt（毫秒时间戳）+ updatedBy（peerId）。
 * - 合并时逐图层取更新者胜出的一方；仅远端有的图层直接并入；仅本地有的保留。
 * - revision 取双方最大值 + 1，用于排序与去重。
 * - 删除用显式 tombstone 集合传播（避免 resurrect），本版本实现 tombstone 合并，
 *   应用层删除图层时需同时写入 tombstone。
 * - 传输层（WebRTC DataChannel / WebSocket / BroadcastChannel）后续接入，
 *   只需透传 encodeMessage/decodeMessage 的字符串。
 */

export interface CollabLayerState {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  /** 图层像素（PNG dataURL，64x64） */
  dataUrl: string;
  updatedAt: number;
  updatedBy: string;
}

export interface CollabDocument {
  docId: string;
  playerName: string;
  model: string;
  layers: CollabLayerState[];
  /** 已删除图层的 tombstone：layerId -> 删除时间戳 */
  tombstones: Record<string, number>;
  capeDataUrl: string | null;
  capeUpdatedAt: number;
  capeUpdatedBy: string;
  revision: number;
  updatedAt: number;
  updatedBy: string;
}

export type CollabMessage =
  | { kind: 'hello'; peerId: string; playerName: string; revision: number }
  | { kind: 'update'; peerId: string; doc: CollabDocument }
  | { kind: 'snapshot'; peerId: string; snap: CollabSnapshot }
  | { kind: 'rtc'; peerId: string; to: string; signal: RtcSignalPayload }
  | { kind: 'presence'; peerId: string; presence: CollabPresence }
  | { kind: 'bye'; peerId: string };

/** v2.0 WebRTC 信令负载（SDP / ICE 均以字符串透传，保持可序列化） */
export type RtcSignalPayload =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: string | null };

export interface CollabPresence {
  peerId: string;
  playerName: string;
  color: string;
  /** 当前悬停像素（可选，用于远端光标） */
  cursor: { x: number; y: number } | null;
  updatedAt: number;
}

/** 在场信息过期阈值（毫秒） */
export const PRESENCE_TTL_MS = 30_000;

/**
 * v2.0 快照同步（BroadcastChannel 同机多窗口阶段）：
 * 负载为合成后的皮肤/披风 PNG，不做逐图层合并，文档级 LWW。
 * 逐图层合并（mergeCollabDocuments）留给 WebRTC 阶段。
 */
export interface CollabSnapshot {
  docId: string;
  playerName: string;
  skinDataUrl: string | null;
  capeDataUrl: string | null;
  revision: number;
  updatedAt: number;
  updatedBy: string;
}

/** 快照 LWW：返回胜出者（时间戳优先，相同则 peerId 字典序大者胜） */
export function mergeSnapshots(local: CollabSnapshot | null, remote: CollabSnapshot): CollabSnapshot {
  if (!local) return remote;
  if (local.docId !== remote.docId) {
    throw new Error(`文档 ID 不一致：${local.docId} vs ${remote.docId}`);
  }
  if (remote.updatedAt !== local.updatedAt) {
    return remote.updatedAt > local.updatedAt ? remote : local;
  }
  return remote.updatedBy >= local.updatedBy ? remote : local;
}

export function createCollabDocument(input: {
  docId: string;
  playerName: string;
  model: string;
  layers: CollabLayerState[];
  tombstones?: Record<string, number>;
  capeDataUrl?: string | null;
  capeUpdatedAt?: number;
  capeUpdatedBy?: string;
  revision?: number;
  updatedBy: string;
}): CollabDocument {
  const now = Date.now();
  return {
    docId: input.docId,
    playerName: input.playerName,
    model: input.model,
    layers: input.layers.map((l) => ({ ...l })),
    tombstones: { ...(input.tombstones ?? {}) },
    capeDataUrl: input.capeDataUrl ?? null,
    capeUpdatedAt: input.capeUpdatedAt ?? 0,
    capeUpdatedBy: input.capeUpdatedBy ?? '',
    revision: input.revision ?? 1,
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
}

/** 比较两个图层版本：返回 true 表示 a 比 b 新 */
function isLayerNewer(a: Pick<CollabLayerState, 'updatedAt' | 'updatedBy'>, b: Pick<CollabLayerState, 'updatedAt' | 'updatedBy'>): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.updatedBy > b.updatedBy;
}

/**
 * 合并远端文档到本地。返回合并后文档 + 本次变更的图层 id。
 * - tombstone：双方取最大时间戳；被 tombstone 覆盖的图层不复活。
 */
export function mergeCollabDocuments(
  localDoc: CollabDocument,
  remoteDoc: CollabDocument,
): { doc: CollabDocument; changedLayerIds: string[] } {
  if (localDoc.docId !== remoteDoc.docId) {
    throw new Error(`文档 ID 不一致：${localDoc.docId} vs ${remoteDoc.docId}`);
  }
  const tombstones: Record<string, number> = { ...localDoc.tombstones };
  for (const [id, ts] of Object.entries(remoteDoc.tombstones)) {
    tombstones[id] = Math.max(tombstones[id] ?? 0, ts);
  }

  const localById = new Map(localDoc.layers.map((l) => [l.id, l]));
  const remoteById = new Map(remoteDoc.layers.map((l) => [l.id, l]));
  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
  const merged: CollabLayerState[] = [];
  const changedLayerIds: string[] = [];

  for (const id of allIds) {
    const tombTs = tombstones[id] ?? 0;
    const l = localById.get(id);
    const r = remoteById.get(id);
    if (l && r) {
      const winner = isLayerNewer(r, l) ? r : l;
      // tombstone 比双方都新 → 删除
      if (tombTs > winner.updatedAt) {
        if (l) changedLayerIds.push(id);
        continue;
      }
      merged.push({ ...winner });
      if (winner === r && (r.dataUrl !== l.dataUrl || r.visible !== l.visible || r.opacity !== l.opacity || r.blendMode !== l.blendMode || r.locked !== l.locked || r.name !== l.name)) {
        changedLayerIds.push(id);
      }
    } else if (r && !l) {
      if (tombTs > r.updatedAt) continue;
      merged.push({ ...r });
      changedLayerIds.push(id);
    } else if (l && !r) {
      if (tombTs > l.updatedAt) {
        changedLayerIds.push(id);
        continue;
      }
      merged.push({ ...l });
    }
  }

  // 披风同样 LWW
  let capeDataUrl = localDoc.capeDataUrl;
  let capeUpdatedAt = localDoc.capeUpdatedAt;
  let capeUpdatedBy = localDoc.capeUpdatedBy;
  if (
    remoteDoc.capeUpdatedAt > localDoc.capeUpdatedAt ||
    (remoteDoc.capeUpdatedAt === localDoc.capeUpdatedAt && remoteDoc.capeUpdatedBy > localDoc.capeUpdatedBy)
  ) {
    if (remoteDoc.capeDataUrl !== localDoc.capeDataUrl) changedLayerIds.push('__cape__');
    capeDataUrl = remoteDoc.capeDataUrl;
    capeUpdatedAt = remoteDoc.capeUpdatedAt;
    capeUpdatedBy = remoteDoc.capeUpdatedBy;
  }

  // 保持图层顺序稳定：按本地顺序，未见过的追加
  const order = new Map(localDoc.layers.map((l, i) => [l.id, i]));
  merged.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));

  return {
    doc: {
      ...localDoc,
      layers: merged,
      tombstones,
      capeDataUrl,
      capeUpdatedAt,
      capeUpdatedBy,
      revision: Math.max(localDoc.revision, remoteDoc.revision) + 1,
      updatedAt: Math.max(localDoc.updatedAt, remoteDoc.updatedAt),
      updatedBy: remoteDoc.updatedAt >= localDoc.updatedAt ? remoteDoc.updatedBy : localDoc.updatedBy,
    },
    changedLayerIds,
  };
}

/** 计算两个文档的差异图层 id（用于最小重绘） */
export function diffCollabDocuments(a: CollabDocument, b: CollabDocument): string[] {
  const byId = new Map(b.layers.map((l) => [l.id, l]));
  const out: string[] = [];
  for (const l of a.layers) {
    const r = byId.get(l.id);
    if (!r || r.dataUrl !== l.dataUrl) out.push(l.id);
  }
  for (const l of b.layers) {
    if (!a.layers.some((x) => x.id === l.id)) out.push(l.id);
  }
  if (a.capeDataUrl !== b.capeDataUrl) out.push('__cape__');
  return [...new Set(out)];
}

/** 消息编解码（传输层直接透传字符串） */
export function encodeMessage(msg: CollabMessage): string {
  return JSON.stringify({ v: 1, ...msg });
}

export function decodeMessage(raw: string): CollabMessage {
  const obj = JSON.parse(raw) as Record<string, unknown> & { v?: number; kind?: string };
  if (obj.v !== 1 || typeof obj.kind !== 'string') {
    throw new Error('不支持的协作消息版本');
  }
  switch (obj.kind) {
    case 'hello':
    case 'update':
    case 'snapshot':
    case 'rtc':
    case 'presence':
    case 'bye':
      return obj as unknown as CollabMessage;
    default:
      throw new Error(`未知协作消息类型：${obj.kind}`);
  }
}

/** 合并在场信息并剔除过期节点 */
export function mergePresence(
  current: Map<string, CollabPresence>,
  msg: Extract<CollabMessage, { kind: 'presence' }>,
  now: number = Date.now(),
): Map<string, CollabPresence> {
  const next = new Map(current);
  next.set(msg.peerId, { ...msg.presence, updatedAt: now });
  for (const [id, p] of next) {
    if (now - p.updatedAt > PRESENCE_TTL_MS) next.delete(id);
  }
  return next;
}
