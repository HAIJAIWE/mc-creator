/**
 * 二进制 NBT 读取器（只读，防御式解析）。
 *
 * `level.dat` 是 **gzip 压缩的二进制 NBT**，仓库里现成的 `NbtEditor` 只解析
 * 文本 SNBT，两者不通用 —— 所以这里单独实现一份。
 *
 * 设计取向是「读世界列表」而不是「通用 NBT 库」：
 *  - **不抛异常**：损坏 / 截断 / 未知 tag 一律降级为 `undefined`。
 *    世界目录可能来自玩家的旧存档，解析失败不该让整个列表打不开。
 *  - **不分配巨量结构**：Byte_Array / Int_Array 等大数组以惰性摘要形式返回，
 *    避免一个改过的 region 文件把主进程内存吃满。
 *  - 只取需要的字段由调用方决定，解析器本身不裁剪。
 *
 * 格式参考 Minecraft wiki 的 NBT 规范：全部大端。
 */

/** Compound 里的一项：`名称 -> 带类型的值` */
export interface NbtTag {
  type: number;
  value: NbtTagValue;
}

export type NbtTagValue =
  | number
  | string
  | boolean
  | Uint8Array
  | Int32Array
  | number[]
  | NbtTagValue[]
  | { [key: string]: NbtTag };

/** NBT tag 类型号（0=End, 1=Byte, …, 12=Long_Array） */
const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

/**
 * 数组与嵌套深度的上限。
 *
 * 恶意 / 损坏文件可以声明一个 2^31 长度的数组或无限嵌套的 Compound，
 * 不设限就是一次 OOM 或栈溢出 —— 而这些文件来自玩家硬盘，不是受控输入。
 */
const MAX_ARRAY_LEN = 1 << 20;
const MAX_DEPTH = 32;

/** 游标。`bad` 一旦置位，后续读取全部返回 undefined，解析整体降级而不是抛错。 */
class Reader {
  offset = 0;
  bad = false;

  constructor(private readonly buf: Uint8Array) {}

  /** 从当前游标到末尾的剩余字节数 */
  remaining(): number {
    return this.buf.length - this.offset;
  }

  private need(n: number): boolean {
    if (this.bad || this.offset + n > this.buf.length) {
      this.bad = true;
      return false;
    }
    return true;
  }

  u8(): number | undefined {
    if (!this.need(1)) return undefined;
    return this.buf[this.offset++];
  }

  i8(): number | undefined {
    const v = this.u8();
    return v === undefined ? undefined : (v << 24) >> 24;
  }

  i16(): number | undefined {
    if (!this.need(2)) return undefined;
    const v = (this.buf[this.offset] << 8) | this.buf[this.offset + 1];
    this.offset += 2;
    return (v << 16) >> 16;
  }

  i32(): number | undefined {
    if (!this.need(4)) return undefined;
    const v =
      this.buf[this.offset] * 0x1000000 +
      ((this.buf[this.offset + 1] << 16) |
        (this.buf[this.offset + 2] << 8) |
        this.buf[this.offset + 3]);
    this.offset += 4;
    return v | 0;
  }

  i64(): number | undefined {
    if (!this.need(8)) return undefined;
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.buf[this.offset + i]!);
    this.offset += 8;
    // 超出 Number 安全范围时钳到 ±MAX_SAFE_INTEGER：
    // 时间戳用得上，超大值当不准也比返回错值强
    const n = Number(v);
    if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
    if (n < Number.MIN_SAFE_INTEGER) return Number.MIN_SAFE_INTEGER;
    return n;
  }

  f32(): number | undefined {
    if (!this.need(4)) return undefined;
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 4).getFloat32(0);
    this.offset += 4;
    return v;
  }

  f64(): number | undefined {
    if (!this.need(8)) return undefined;
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 8).getFloat64(0);
    this.offset += 8;
    return v;
  }

  /** 字节数组的原始视图（不复制） */
  take(n: number): Uint8Array {
    if (!this.need(n)) return new Uint8Array(0);
    const s = this.offset;
    this.offset += n;
    return this.buf.subarray(s, s + n);
  }

  /** NBT 字符串是「u16 长度 + 修饰 UTF-8」，不是 JS 的 u32 长度 */
  str(): string | undefined {
    const len = this.u16();
    if (len === undefined) return undefined;
    if (!this.need(len)) return undefined;
    const s = decodeModifiedUtf8(this.buf.subarray(this.offset, this.offset + len));
    this.offset += len;
    return s;
  }

  private u16(): number | undefined {
    if (!this.need(2)) return undefined;
    const v = (this.buf[this.offset] << 8) | this.buf[this.offset + 1];
    this.offset += 2;
    return v;
  }
}

/**
 * 修饰 UTF-8：Java 的 `DataOutput.writeUTF` 变体。
 *
 * 与标准 UTF-8 的差别：NUL 编成 0xC0 0x80 而不是 0x00，且用 u16 记长度。
 * 世界名里出现 emoji / 补充平面字符时，标准解码会得到乱码，所以这里自己走一遍。
 */
function decodeModifiedUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const a = bytes[i]!;
    if (a < 0x80) {
      out += String.fromCharCode(a);
      i += 1;
    } else if ((a & 0xe0) === 0xc0) {
      const b = bytes[i + 1];
      if (b === undefined) break;
      out += String.fromCharCode(((a & 0x1f) << 6) | (b & 0x3f));
      i += 2;
    } else if ((a & 0xf0) === 0xe0) {
      const b = bytes[i + 1];
      const c = bytes[i + 2];
      if (b === undefined || c === undefined) break;
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
      i += 3;
    } else if ((a & 0xf8) === 0xf0) {
      // 4 字节 = UTF-16 代理对，转成两个 JS surrogate
      const b = bytes[i + 1];
      const c = bytes[i + 2];
      const d = bytes[i + 3];
      if (b === undefined || c === undefined || d === undefined) break;
      const cp = ((a & 0x07) << 18) | ((b & 0x3f) << 12) | ((c & 0x3f) << 6) | (d & 0x3f);
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
    } else {
      // 非法首字节：丢弃并前进，避免死循环
      i += 1;
    }
  }
  return out;
}

function readPayload(r: Reader, type: number, depth: number): NbtTagValue | undefined {
  if (depth > MAX_DEPTH) {
    r.bad = true;
    return undefined;
  }
  switch (type) {
    case TAG_BYTE: {
      const v = r.i8();
      return v === undefined ? undefined : v !== 0;
    }
    case TAG_SHORT:
      return r.i16();
    case TAG_INT:
      return r.i32();
    case TAG_LONG:
      return r.i64();
    case TAG_FLOAT:
      return r.f32();
    case TAG_DOUBLE:
      return r.f64();
    case TAG_BYTE_ARRAY: {
      const len = r.i32();
      if (len === undefined || len < 0 || len > MAX_ARRAY_LEN) {
        r.bad = true;
        return undefined;
      }
      if (!rHas(r, len)) return undefined;
      const out = new Uint8Array(len);
      out.set(r.take(len));
      return out;
    }
    case TAG_INT_ARRAY: {
      const len = r.i32();
      if (len === undefined || len < 0 || len > MAX_ARRAY_LEN) {
        r.bad = true;
        return undefined;
      }
      const out = new Int32Array(len);
      for (let i = 0; i < len; i++) {
        const v = r.i32();
        if (v === undefined) return undefined;
        out[i] = v;
      }
      return out;
    }
    case TAG_LONG_ARRAY: {
      const len = r.i32();
      if (len === undefined || len < 0 || len > MAX_ARRAY_LEN) {
        r.bad = true;
        return undefined;
      }
      // 只留前若干个当摘要：64 位数组可能是几 MB，世界列表不需要全量
      const keep = Math.min(len, 8);
      const out: number[] = [];
      for (let i = 0; i < len; i++) {
        const v = r.i64();
        if (v === undefined) return undefined;
        if (i < keep) out.push(v);
      }
      return out;
    }
    case TAG_STRING:
      return r.str();
    case TAG_LIST: {
      const itemType = r.u8();
      const len = r.i32();
      if (itemType === undefined || len === undefined || len < 0 || len > MAX_ARRAY_LEN) {
        r.bad = true;
        return undefined;
      }
      const out: NbtTagValue[] = [];
      for (let i = 0; i < len; i++) {
        const v = readPayload(r, itemType!, depth + 1);
        if (v === undefined) return undefined;
        out.push(v);
      }
      return out;
    }
    case TAG_COMPOUND:
      return readCompound(r, depth + 1);
    default:
      // 未知 tag（更高版本 NBT）无法跳过其 payload，只能放弃整条解析
      r.bad = true;
      return undefined;
  }
}

// 下面这个判断避免把 Reader 的 buf 暴露成公开字段
function rHas(r: Reader, n: number): boolean {
  return !r.bad && r.remaining() >= n;
}

function readCompound(r: Reader, depth: number): { [key: string]: NbtTag } | undefined {
  if (depth > MAX_DEPTH) {
    r.bad = true;
    return undefined;
  }
  const out: { [key: string]: NbtTag } = {};
  for (;;) {
    const type = r.u8();
    if (type === undefined || type === TAG_END) return out;
    const name = r.str();
    if (name === undefined) return out;
    const value = readPayload(r, type, depth);
    if (value === undefined) return r.bad ? undefined : out;
    out[name] = { type, value };
  }
}

/**
 * 解析一份**未压缩**的 NBT 字节流，返回根 Compound。
 *
 * 解析失败 / 截断 / 未知 tag 一律返回 `null`（不抛）——
 * 调用方据此把世界标成「元数据不可读」，而不是让整个列表挂掉。
 */
export function parseNbt(data: Uint8Array): { [key: string]: NbtTag } | null {
  try {
    const r = new Reader(data);
    const rootType = r.u8();
    if (rootType !== TAG_COMPOUND) return null;
    const rootName = r.str();
    if (rootName === undefined) return null;
    const root = readCompound(r, 0);
    // `readCompound` 返回 undefined 只可能是深度超限或游标越界（两者都会置 bad）
    return r.bad ? null : (root ?? null);
  } catch {
    // 防御性兜底：结构损坏时任何一步都可能抛（Buffer 视图越界等）
    return null;
  }
}

/** 从根 Compound 取一个字段的原始值 */
export function nbtGet(
  root: { [key: string]: NbtTag } | null,
  key: string,
): NbtTagValue | undefined {
  return root?.[key]?.value;
}

/** 取 Compound 字段里的子 Compound */
export function nbtCompound(
  root: { [key: string]: NbtTag } | null,
  key: string,
): { [key: string]: NbtTag } | undefined {
  const v = root?.[key]?.value;
  if (
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Uint8Array) &&
    !(v instanceof Int32Array)
  ) {
    return v as { [key: string]: NbtTag };
  }
  return undefined;
}
