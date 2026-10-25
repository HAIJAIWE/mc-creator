/**
 * 最小 zip 读取器。
 *
 * 这里**造真实的 zip 字节**而不是用 mock：手写的字节级 fixture 才能覆盖
 * 「中央目录被伪造」「本地头偏移错位」这类 bug —— 而这些正是要写盘时
 * 最危险的输入。实现自己会崩的地方，mock 一律看不见。
 */
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';

import { readZipEntries, readZipFile, unzip, safePath, DEFAULT_ZIP_LIMITS } from './zip.js';

/** 造一个最小合法 zip（stored 或 deflate，单条目）。 */
function makeZip(files: Array<{ name: string; content: string | Buffer; method?: 0 | 8 }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf-8');
    const raw = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf-8');
    const method = f.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

/** CRC32（zip 头里要填；读取时其实不校验，但 fixture 要合法）。 */
function crc32(buf: Buffer): number {
  let c: number;
  const table = crc32.table ?? (crc32.table = buildTable());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    crc = (crc >>> 8) ^ table[c];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
crc32.table = undefined as unknown as Int32Array;
function buildTable(): Int32Array {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
}

describe('zip 读取器 · 基本', () => {
  it('读出单个 deflate 条目', () => {
    const zip = makeZip([{ name: 'modrinth.index.json', content: '{"name":"x"}' }]);
    const m = unzip(zip);
    expect(m.get('modrinth.index.json')?.toString('utf-8')).toBe('{"name":"x"}');
  });

  it('读出多个条目，内容各自正确', () => {
    const zip = makeZip([
      { name: 'a.txt', content: 'AAAA' },
      { name: 'b/c.txt', content: 'BBBB' },
      { name: 'd.bin', content: Buffer.alloc(1000, 7) },
    ]);
    const m = unzip(zip);
    expect([...m.keys()].sort()).toEqual(['a.txt', 'b/c.txt', 'd.bin']);
    expect(m.get('b/c.txt')?.toString()).toBe('BBBB');
    expect(m.get('d.bin')?.length).toBe(1000);
  });

  it('stored（method 0）与 deflate（method 8）都支持', () => {
    const zip = makeZip([
      { name: 'stored.txt', content: 'hello', method: 0 },
      { name: 'deflated.txt', content: 'hello', method: 8 },
    ]);
    const m = unzip(zip);
    expect(m.get('stored.txt')?.toString()).toBe('hello');
    expect(m.get('deflated.txt')?.toString()).toBe('hello');
  });

  it('大文件能正确解（跨 inflateRaw 分块）', () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 0xab);
    const zip = makeZip([{ name: 'big.jar', content: big }]);
    const out = unzip(zip).get('big.jar');
    expect(out?.length).toBe(big.length);
    expect(out?.equals(big)).toBe(true);
  });

  it('目录条目（以 / 结尾）被跳过', () => {
    const zip = makeZip([
      { name: 'overrides/', content: '' },
      { name: 'x.txt', content: 'y' },
    ]);
    expect([...unzip(zip).keys()]).toEqual(['x.txt']);
  });
});

describe('zip 读取器 · 拒绝畸形/恶意输入', () => {
  it('不是 zip → 明确报错，不是返回空', () => {
    expect(() => unzip(Buffer.from('hello world'))).toThrow(/不是有效的 zip/);
  });

  it('ZIP64 明确拒绝（不猜偏移）', () => {
    const zip = makeZip([{ name: 'a.txt', content: 'a' }]);
    // 在 EOCD 前 20 字节处插一个 ZIP64 EOCD 签名
    zip.writeUInt32LE(0x06064b50, zip.length - 22 - 20);
    expect(() => unzip(zip)).toThrow(/ZIP64/);
  });

  it('不支持的压缩方法报错，不返回垃圾', () => {
    const zip = makeZip([{ name: 'a.txt', content: 'a' }]);
    // 把本地头与中央目录里的 method 都改成 12（bzip2，我们不支持）
    zip.writeUInt16LE(12, 8);
    const eocd = zip.length - 22;
    const cdOff = zip.readUInt32LE(eocd + 16);
    zip.writeUInt16LE(12, cdOff + 10);
    expect(() => unzip(zip)).toThrow(/不支持的压缩方法/);
  });

  it('本地文件头偏移被改成别的条目 → 报名字不符，不返回错误数据', () => {
    // 两个条目，把第二个的 localOffset 指向第一个 → 读出来的名字会对不上
    const zip = makeZip([
      { name: 'first.txt', content: 'FIRST' },
      { name: 'second.txt', content: 'SECOND' },
    ]);
    const eocd = zip.length - 22;
    const cdOff = zip.readUInt32LE(eocd + 16);
    const secondCentral = cdOff + 46 + 'first.txt'.length;
    zip.writeUInt32LE(0, secondCentral + 42); // localOffset = 0（指向 first 的头）
    const entries = readZipEntries(zip);
    const second = entries.find((e) => e.name === 'second.txt');
    expect(second).toBeDefined();
    expect(() => readZipFile(zip, second!)).toThrow(/名字不符/);
  });

  it('条目数超上限 → 拒绝', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, content: 'x' }));
    const zip = makeZip(files);
    expect(() => readZipEntries(zip, { ...DEFAULT_ZIP_LIMITS, maxEntries: 3 })).toThrow(/条目过多/);
  });

  it('单文件解压后超上限 → 拒绝（zip bomb 防御）', () => {
    const zip = makeZip([{ name: 'bomb.bin', content: Buffer.alloc(50_000) }]);
    expect(() => unzip(zip, { ...DEFAULT_ZIP_LIMITS, maxFileSize: 1000 })).toThrow(/单个文件过大/);
  });

  it('总量超上限 → 拒绝', () => {
    const zip = makeZip([
      { name: 'a.bin', content: Buffer.alloc(2000) },
      { name: 'b.bin', content: Buffer.alloc(2000) },
    ]);
    expect(() =>
      unzip(zip, { ...DEFAULT_ZIP_LIMITS, maxFileSize: 10_000, maxTotalSize: 3000 }),
    ).toThrow(/总量过大/);
  });

  it('符号链接条目 → 拒绝（能指向盘外）', () => {
    const zip = makeZip([{ name: 'evil', content: '/etc/passwd' }]);
    const eocd = zip.length - 22;
    const cdOff = zip.readUInt32LE(eocd + 16);
    // unix 模式 S_IFLNK | 0777 = 0xA1FF，高 16 位
    zip.writeUInt32LE((0xa1ff << 16) >>> 0, cdOff + 38);
    expect(() => readZipEntries(zip)).toThrow(/符号链接/);
  });
});

describe('safePath · 写盘前的最后一道闸', () => {
  it('正常相对路径规整', () => {
    expect(safePath('overrides/config/x.json')).toBe('overrides/config/x.json');
    expect(safePath('overrides//config/./x.json')).toBe('overrides/config/x.json');
  });

  it('目录穿越一律拒绝', () => {
    for (const bad of ['../etc/passwd', 'a/../../etc/passwd', '..', '../']) {
      expect(safePath(bad), `${bad} 必须被拒`).toBeNull();
    }
  });

  it('反斜杠也当分隔符（畸形打包器 / 恶意构造）', () => {
    expect(safePath('overrides\\..\\..\\evil')).toBeNull();
    expect(safePath('overrides\\config\\x.json')).toBe('overrides/config/x.json');
  });

  it('绝对路径与盘符被拒', () => {
    expect(safePath('/etc/passwd')).toBeNull();
    expect(safePath('C:/Windows/System32/x.dll')).toBeNull();
    expect(safePath('c:\\windows\\x.dll')).toBeNull();
  });

  it('空路径 / 全是分隔符被拒', () => {
    expect(safePath('')).toBeNull();
    expect(safePath('///')).toBeNull();
    expect(safePath('.')).toBeNull();
  });
});
