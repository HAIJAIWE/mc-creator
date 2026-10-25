/**
 * 二进制 NBT 读取器测试。
 *
 * 重点是**防御性**：level.dat 来自玩家硬盘，可能被截断、被旧工具写成非 gzip、
 * 结构损坏。任何一种都不该让主进程抛异常 —— 世界列表要照常显示，只是标记元数据不可读。
 *
 * fixture 由本文件内的编码器现场生成（而不是放静态二进制文件），
 * 这样「测试数据与实现同源」的假绿风险至少在编码侧是显式可见的。
 */
import { describe, it, expect } from 'vitest';
import { parseNbt, nbtGet, nbtCompound, type NbtTag } from './nbt-reader.js';

// ===== 最小 NBT 编码器（仅测试用）=====

const enc = {
  u8: (v: number) => [v & 0xff],
  i16: (v: number) => [(v >> 8) & 0xff, v & 0xff],
  i32: (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff],
  i64: (v: number) => {
    const hi = Math.floor(v / 0x100000000);
    const lo = v >>> 0;
    return [...enc.i32(hi), ...enc.i32(lo)];
  },
  f32: (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v);
    return [...b];
  },
  f64: (v: number) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v);
    return [...b];
  },
  /** 修饰 UTF-8：NUL 编成 0xC0 0x80，长度用 u16 */
  str: (s: string) => {
    const bytes: number[] = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0) bytes.push(0xc0, 0x80);
      else if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000)
        bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else {
        const v = cp - 0x10000;
        const hi = 0xd800 + (v >> 10);
        const lo = 0xdc00 + (v & 0x3ff);
        for (const u of [hi, lo]) {
          bytes.push(0xe0 | (u >> 12), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
        }
      }
    }
    return [...enc.u8(bytes.length >>> 8), ...enc.u8(bytes.length & 0xff), ...bytes];
  },
};

type TagPayload = { type: number; bytes: number[] };

function compound(entries: Record<string, TagPayload>): number[] {
  const out: number[] = [];
  for (const [name, e] of Object.entries(entries)) {
    out.push(e.type);
    // 逐段 push 而非 spread：payload 可达数百万字节，展开成参数会爆调用栈
    for (const b of enc.str(name)) out.push(b);
    for (const b of e.bytes) out.push(b);
  }
  out.push(0); // TAG_End
  return out;
}

/**
 * 组一个完整的根 Compound 字节流。
 *
 * 用循环拼接而不是 `[a, ...body]` —— body 可达数百万字节，
 * 展开成函数参数会直接爆调用栈（变异测试时才暴露出来）。
 */
function root(body: number[]): Uint8Array {
  const head = [10, ...enc.str('')];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

const TAG = {
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12,
} as const;

// ===========================================================================
describe('parseNbt · 基本类型', () => {
  it('解析字符串 / int / long / byte', () => {
    const data = root(
      compound({
        LevelName: { type: TAG.STRING, bytes: enc.str('我的世界世界') },
        GameType: { type: TAG.INT, bytes: enc.i32(1) },
        LastPlayed: { type: TAG.LONG, bytes: enc.i64(1_726_000_000_000) },
        Hardcore: { type: TAG.BYTE, bytes: [1] },
      }),
    );
    const r = parseNbt(data);
    expect(r).not.toBeNull();
    expect(nbtGet(r, 'LevelName')).toBe('我的世界世界');
    expect(nbtGet(r, 'GameType')).toBe(1);
    expect(nbtGet(r, 'LastPlayed')).toBe(1_726_000_000_000);
    expect(nbtGet(r, 'Hardcore')).toBe(true);
  });

  it('解析 float / double', () => {
    const r = parseNbt(
      root(
        compound({
          F: { type: TAG.FLOAT, bytes: enc.f32(1.5) },
          D: { type: TAG.DOUBLE, bytes: enc.f64(3.25) },
        }),
      ),
    );
    expect(nbtGet(r, 'F')).toBeCloseTo(1.5, 5);
    expect(nbtGet(r, 'D')).toBeCloseTo(3.25, 5);
  });

  it('空 Compound 正常返回空对象', () => {
    expect(parseNbt(root(compound({})))).toEqual({});
  });
});

// ===========================================================================
describe('parseNbt · 嵌套结构', () => {
  it('解析嵌套 Compound', () => {
    const data = root(
      compound({
        Version: {
          type: TAG.COMPOUND,
          bytes: compound({
            Id: { type: TAG.INT, bytes: enc.i32(3953) },
            Name: { type: TAG.STRING, bytes: enc.str('1.21.11') },
          }),
        },
      }),
    );
    const r = parseNbt(data);
    const v = nbtCompound(r, 'Version');
    expect(nbtGet(v ?? null, 'Id')).toBe(3953);
    expect(nbtGet(v ?? null, 'Name')).toBe('1.21.11');
  });

  it('解析 List of Compound', () => {
    const item = compound({ k: { type: TAG.INT, bytes: enc.i32(7) } });
    const data = root(
      compound({
        L: { type: TAG.LIST, bytes: [TAG.COMPOUND, ...enc.i32(2), ...item, ...item] },
      }),
    );
    const r = parseNbt(data);
    const l = nbtGet(r, 'L');
    expect(Array.isArray(l)).toBe(true);
    expect(l).toHaveLength(2);
  });

  it('解析 Int_Array / Byte_Array', () => {
    const r = parseNbt(
      root(
        compound({
          IA: {
            type: TAG.INT_ARRAY,
            bytes: [...enc.i32(3), ...enc.i32(10), ...enc.i32(20), ...enc.i32(30)],
          },
          BA: { type: TAG.BYTE_ARRAY, bytes: [...enc.i32(2), 0xff, 0x00] },
        }),
      ),
    );
    expect(Array.from(nbtGet(r, 'IA') as Int32Array)).toEqual([10, 20, 30]);
    expect(Array.from(nbtGet(r, 'BA') as Uint8Array)).toEqual([255, 0]);
  });

  it('Long_Array 只保留摘要（不把几 MB 全量塞进内存）', () => {
    const payload = [...enc.i32(20)];
    for (let i = 0; i < 20; i++) payload.push(...enc.i64(i));
    const r = parseNbt(root(compound({ LA: { type: TAG.LONG_ARRAY, bytes: payload } })));
    const v = nbtGet(r, 'LA');
    expect(Array.isArray(v)).toBe(true);
    expect(v).toHaveLength(8);
  });
});

// ===========================================================================
describe('parseNbt · 修饰 UTF-8', () => {
  it('ASCII 正常', () => {
    const r = parseNbt(root(compound({ S: { type: TAG.STRING, bytes: enc.str('hello') } })));
    expect(nbtGet(r, 'S')).toBe('hello');
  });

  it('NUL 编成 0xC0 0x80 而不是 0x00（与标准 UTF-8 不同）', () => {
    const s = `a${String.fromCharCode(0)}b`;
    expect(s.length).toBe(3);
    const r = parseNbt(root(compound({ S: { type: TAG.STRING, bytes: enc.str(s) } })));
    expect(nbtGet(r, 'S')).toBe(s);
  });

  it('中文 / emoji（4 字节 → UTF-16 代理对）', () => {
    const s = '世界 🌍 end';
    const r = parseNbt(root(compound({ S: { type: TAG.STRING, bytes: enc.str(s) } })));
    expect(nbtGet(r, 'S')).toBe(s);
  });
});

// ===========================================================================
describe('parseNbt · 损坏输入必须降级而不是抛', () => {
  it('空输入', () => {
    expect(parseNbt(new Uint8Array(0))).toBeNull();
  });

  it('根类型不是 Compound', () => {
    expect(parseNbt(Uint8Array.from([8, 0, 0]))).toBeNull();
  });

  it('被截断（字符串长度声明 100 实际只剩 3 字节）', () => {
    expect(parseNbt(Uint8Array.from([10, 0, 0, 8, 0, 3, 0x41, 0x42, 0x43]))).toBeNull();
  });

  it('未知 tag 类型（更高版本 NBT）', () => {
    // type=99，后面随便什么字节 —— 无法确定 payload 长度，只能放弃
    expect(parseNbt(Uint8Array.from([10, 0, 0, 99, 0, 1, 0x41, 0]))).toBeNull();
  });

  /**
   * 防 OOM —— 这条必须让「上限」成为**唯一**的失败原因，否则是假绿。
   *
   * 前一版用 0x7fffffff 的声明长度配极短数据：无论有没有上限检查，
   * 都会因为「剩余字节不足」返回 null，于是去掉上限后用例照样通过（变异存活）。
   *
   * 这里改为：声明长度 = 上限+1，并且**真的把数据补齐**。
   *  - 有上限 → 立刻拒绝，返回 null
   *  - 无上限 → 数组被完整读出，返回非 null
   * 两者结果相反，上限才真正被锁住。
   */
  it('超过上限但数据齐全 → 仍拒绝（上限是唯一失败原因）', () => {
    const over = (1 << 20) + 1; // MAX_ARRAY_LEN = 1<<20
    const payload: number[] = enc.i32(over);
    for (let i = 0; i < over; i++) {
      payload.push((i >>> 24) & 0xff, (i >>> 16) & 0xff, (i >>> 8) & 0xff, i & 0xff);
    }
    const data = root(compound({ IA: { type: TAG.INT_ARRAY, bytes: payload } }));
    // 数据确实齐全（over 个 int 的字节都在）
    expect(data.length).toBeGreaterThan(over * 4);
    expect(parseNbt(data)).toBeNull();
  });

  it('负数数组长度', () => {
    const data = root(compound({ BA: { type: TAG.BYTE_ARRAY, bytes: [...enc.i32(-5)] } }));
    expect(parseNbt(data)).toBeNull();
  });

  it('深度超限（构造 40 层嵌套）', () => {
    let payload: number[] = compound({});
    for (let i = 0; i < 40; i++) {
      payload = compound({ nested: { type: TAG.COMPOUND, bytes: payload } });
    }
    expect(parseNbt(root(payload))).toBeNull();
  });

  it('随机字节不会抛异常（只可能返回 null 或部分结果）', () => {
    for (let i = 0; i < 200; i++) {
      const len = 1 + Math.floor(Math.random() * 64);
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) buf[j] = Math.floor(Math.random() * 256);
      expect(() => parseNbt(buf)).not.toThrow();
    }
  });
});

// ===========================================================================
describe('nbtGet / nbtCompound 的类型防御', () => {
  it('取不存在的键返回 undefined', () => {
    const r = parseNbt(root(compound({})));
    expect(nbtGet(r, 'missing')).toBeUndefined();
    expect(nbtCompound(r, 'missing')).toBeUndefined();
  });

  it('对非 Compound 字段取子 Compound 返回 undefined', () => {
    const r = parseNbt(root(compound({ S: { type: TAG.STRING, bytes: enc.str('x') } })));
    expect(nbtCompound(r, 'S')).toBeUndefined();
  });

  it('对数组字段取子 Compound 返回 undefined', () => {
    const r = parseNbt(
      root(compound({ IA: { type: TAG.INT_ARRAY, bytes: [...enc.i32(1), ...enc.i32(1)] } })),
    );
    expect(nbtCompound(r, 'IA')).toBeUndefined();
  });

  it('null 根上取字段不抛', () => {
    expect(nbtGet(null, 'X')).toBeUndefined();
    expect(nbtCompound(null, 'X')).toBeUndefined();
  });

  it('类型导出可用于声明', () => {
    const tag: NbtTag = { type: TAG.STRING, value: 'ok' };
    expect(tag.value).toBe('ok');
  });
});
