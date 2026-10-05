// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  createCollabDocument,
  mergeCollabDocuments,
  mergeSnapshots,
  diffCollabDocuments,
  encodeMessage,
  decodeMessage,
  mergePresence,
  type CollabDocument,
  type CollabSnapshot,
} from './collab-protocol.js';

function layer(id: string, dataUrl: string, updatedAt: number, updatedBy = 'a') {
  return {
    id,
    name: id,
    type: 'custom',
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'source-over',
    dataUrl,
    updatedAt,
    updatedBy,
  };
}

function doc(over: Partial<CollabDocument> = {}): CollabDocument {
  return createCollabDocument({
    docId: 'doc-1',
    playerName: 'Steve',
    model: 'classic',
    layers: [layer('base', 'data:A', 100, 'a')],
    updatedBy: 'a',
    ...over,
  });
}

describe('collab-protocol merge', () => {
  it('逐图层取新者胜出', () => {
    const local = doc({
      layers: [layer('base', 'data:A', 100, 'a'), layer('l2', 'data:X', 100, 'a')],
    });
    const remote = doc({
      layers: [layer('base', 'data:B', 200, 'b'), layer('l2', 'data:X', 100, 'a')],
      revision: 5,
      updatedBy: 'b',
    });
    const { doc: merged, changedLayerIds } = mergeCollabDocuments(local, remote);
    expect(merged.layers.find((l) => l.id === 'base')?.dataUrl).toBe('data:B');
    expect(merged.layers.find((l) => l.id === 'l2')?.dataUrl).toBe('data:X');
    expect(changedLayerIds).toEqual(['base']);
    expect(merged.revision).toBe(6);
  });

  it('时间戳相同时按 peerId 字典序决胜（确定性）', () => {
    const local = doc({ layers: [layer('base', 'data:A', 100, 'b')] });
    const remote = doc({ layers: [layer('base', 'data:B', 100, 'a')] });
    const { doc: merged } = mergeCollabDocuments(local, remote);
    expect(merged.layers[0]?.dataUrl).toBe('data:A');
  });

  it('仅远端有的图层并入，仅本地有的保留', () => {
    const local = doc({ layers: [layer('base', 'data:A', 100, 'a')] });
    const remote = doc({
      layers: [layer('base', 'data:A', 100, 'a'), layer('new', 'data:N', 150, 'b')],
    });
    const { doc: merged, changedLayerIds } = mergeCollabDocuments(local, remote);
    expect(merged.layers.map((l) => l.id).sort()).toEqual(['base', 'new']);
    expect(changedLayerIds).toContain('new');
  });

  it('tombstone 阻止已删除图层复活', () => {
    const local = doc({ layers: [layer('base', 'data:A', 100, 'a')], tombstones: { gone: 300 } });
    const remote = doc({
      layers: [layer('base', 'data:A', 100, 'a'), layer('gone', 'data:G', 200, 'b')],
    });
    const { doc: merged } = mergeCollabDocuments(local, remote);
    expect(merged.layers.some((l) => l.id === 'gone')).toBe(false);
    expect(merged.tombstones['gone']).toBe(300);
  });

  it('不同 docId 直接抛错', () => {
    const local = doc();
    const remote = doc({ docId: 'doc-2' } as Partial<CollabDocument>);
    expect(() => mergeCollabDocuments(local, remote)).toThrow();
  });

  it('diff 找出差异图层与披风', () => {
    const a = doc({ layers: [layer('base', 'data:A', 100, 'a')] });
    const b = doc({
      layers: [layer('base', 'data:B', 200, 'b')],
      capeDataUrl: 'data:cape',
      capeUpdatedAt: 1,
      capeUpdatedBy: 'b',
    });
    expect(diffCollabDocuments(a, b).sort()).toEqual(['__cape__', 'base']);
  });
});

describe('collab-protocol messages', () => {
  it('编解码往返', () => {
    const msg = { kind: 'hello', peerId: 'p1', playerName: 'Steve', revision: 3 } as const;
    expect(decodeMessage(encodeMessage(msg))).toEqual({ v: 1, ...msg });
  });

  it('非法版本与未知类型抛错', () => {
    expect(() => decodeMessage('{"v":2,"kind":"hello"}')).toThrow();
    expect(() => decodeMessage('{"v":1,"kind":"nope"}')).toThrow();
  });

  it('在场信息合并与过期剔除', () => {
    const now = 1_000_000;
    let map = mergePresence(
      new Map(),
      {
        kind: 'presence',
        peerId: 'p1',
        presence: { peerId: 'p1', playerName: 'A', color: '#fff', cursor: null, updatedAt: 0 },
      },
      now,
    );
    expect(map.has('p1')).toBe(true);
    map = mergePresence(
      map,
      {
        kind: 'presence',
        peerId: 'p2',
        presence: { peerId: 'p2', playerName: 'B', color: '#000', cursor: null, updatedAt: 0 },
      },
      now + 31_000,
    );
    expect(map.has('p1')).toBe(false);
    expect(map.has('p2')).toBe(true);
  });
});

describe('collab-protocol snapshots', () => {
  const snap = (over: Partial<CollabSnapshot> = {}): CollabSnapshot => ({
    docId: 'Steve',
    playerName: 'Steve',
    skinDataUrl: 'data:A',
    capeDataUrl: null,
    revision: 1,
    updatedAt: 100,
    updatedBy: 'a',
    ...over,
  });

  it('null 本地直接采用远端', () => {
    expect(mergeSnapshots(null, snap())).toEqual(snap());
  });

  it('新时间戳胜出', () => {
    const winner = mergeSnapshots(
      snap({ updatedAt: 100, updatedBy: 'a' }),
      snap({ updatedAt: 200, updatedBy: 'b' }),
    );
    expect(winner.updatedBy).toBe('b');
  });

  it('相同时间戳按 peerId 字典序决胜', () => {
    const winner = mergeSnapshots(
      snap({ updatedAt: 100, updatedBy: 'b' }),
      snap({ updatedAt: 100, updatedBy: 'a' }),
    );
    expect(winner.updatedBy).toBe('b');
  });

  it('不同 docId 抛错', () => {
    expect(() => mergeSnapshots(snap({ docId: 'A' }), snap({ docId: 'B' }))).toThrow();
  });

  it('snapshot 消息编解码往返', () => {
    const msg = { kind: 'snapshot', peerId: 'p1', snap: snap() } as const;
    expect(decodeMessage(encodeMessage(msg))).toEqual({ v: 1, ...msg });
  });
});
