import { describe, it, expect } from 'vitest';

import {
  checkInstanceName,
  checkInstanceNameAgainst,
  dedupeInstanceName,
  MAX_INSTANCE_NAME_LENGTH,
} from './instance-name.js';

describe('checkInstanceName · 正常名字', () => {
  it('英文 / 数字 / 中文 / 空格 / 常见符号', () => {
    for (const n of [
      '1.21.1',
      'Fabulously Optimized',
      '我的空岛整合包',
      '空岛生存-生存',
      'Vanilla 1.21.1 (Fabric)',
      'ATMP-空岛 v3.2',
      'a',
    ]) {
      expect(checkInstanceName(n), `${n} 应该合法`).toEqual({ ok: true });
    }
  });

  it('emoji 也放行（文件系统只挡控制字符）', () => {
    expect(checkInstanceName('🏝 生存').ok).toBe(true);
  });
});

describe('checkInstanceName · 非法名字，且理由要说清', () => {
  it('空 / 纯空白 / . / ..', () => {
    expect(checkInstanceName('').ok).toBe(false);
    expect(checkInstanceName('   ').ok).toBe(false);
    expect(checkInstanceName('.').ok).toBe(false);
    expect(checkInstanceName('..').ok).toBe(false);
  });

  it('首尾空格 —— Windows 会自动去掉，导致目录名和显示名对不上', () => {
    const r = checkInstanceName(' 我的世界');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/首尾/);
    expect(checkInstanceName('我的世界 ').ok).toBe(false);
  });

  it('结尾的点 —— 同上（Windows 静默去掉）', () => {
    const r = checkInstanceName('整合包.');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/以「.」/);
  });

  it('Windows 非法字符逐个', () => {
    for (const ch of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
      const r = checkInstanceName(`我的${ch}世界`);
      expect(r.ok, `含 ${ch} 应该被拒`).toBe(false);
      // 理由里要点名是哪个字符，不然用户不知道要改什么
      expect(r.ok === false && r.reason).toContain(ch);
    }
  });

  it('控制字符也挡（0x00-0x1f）', () => {
    expect(checkInstanceName('a\u0000b').ok).toBe(false);
    expect(checkInstanceName('a\u001Fb').ok).toBe(false);
  });

  it('保留设备名（含带扩展名的形态）', () => {
    for (const n of ['CON', 'con', 'NUL', 'COM1', 'LPT9', 'CON.txt', 'aux']) {
      const r = checkInstanceName(n);
      expect(r.ok, `${n} 应该被拒`).toBe(false);
      expect(r.ok === false && r.reason).toMatch(/保留设备名/);
    }
  });

  it('⚠️ CON (1) 这种带后缀的是合法的（主名不是 CON）', () => {
    // 保留名规则只作用于点号前的主名，不能把「和 CON 沾边」的全拒了
    expect(checkInstanceName('CON (1)').ok).toBe(true);
    expect(checkInstanceName('CONS').ok).toBe(true);
    expect(checkInstanceName('COM10').ok).toBe(true);
  });

  it('超长', () => {
    const ok = 'x'.repeat(MAX_INSTANCE_NAME_LENGTH);
    expect(checkInstanceName(ok).ok).toBe(true);
    const tooLong = 'x'.repeat(MAX_INSTANCE_NAME_LENGTH + 1);
    const r = checkInstanceName(tooLong);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/太长/);
  });

  it('理由都要是可展示的中文，不能是原始异常', () => {
    for (const n of ['', 'a/b', 'CON', 'x'.repeat(200), 'a.']) {
      const r = checkInstanceName(n);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason.length).toBeGreaterThan(4);
      // 不能把控制字符原样塞进提示语
      const CTRL = new RegExp('[' + '\u0000-\u001F' + ']');
      expect(r.ok === false && !CTRL.test(r.reason)).toBe(true);
    }
  });
});

describe('dedupeInstanceName', () => {
  it('没冲突就原样返回', () => {
    expect(dedupeInstanceName('我的世界', ['别的'])).toBe('我的世界');
  });

  it('冲突时加 (2) / (3)', () => {
    const taken = ['我的世界', '我的世界 (2)'];
    expect(dedupeInstanceName('我的世界', taken)).toBe('我的世界 (3)');
  });

  it('大小写不敏感地判冲突（Windows 上同名）', () => {
    expect(dedupeInstanceName('My World', ['my world'])).toBe('My World (2)');
  });

  it('生成的名字本身仍要合法', () => {
    const n = dedupeInstanceName('整合包', ['整合包', '整合包 (2)']);
    expect(checkInstanceName(n).ok).toBe(true);
  });

  it('空列表', () => {
    expect(dedupeInstanceName('x', [])).toBe('x');
  });
});

/**
 * `checkInstanceNameAgainst` —— 起名弹框用的校验（格式 + 撞名一起判）。
 *
 * 为什么不能把撞名丢给 `dedupeInstanceName` 静默加后缀：实例 id 就是磁盘目录名，
 * 改名会让界面名与目录名当场不一致；而 `InstanceRegistry.create()` 撞到同 id
 * 时是**就地更新**，会把那个实例的 `versionId` 一起改掉 ——
 * 等于把别人装好的实例悄悄换成另一个 MC 版本。
 */
describe('checkInstanceNameAgainst', () => {
  const existing = [
    { id: '我的空岛', versionId: '1.21.1' },
    { id: 'Fabulously Optimized', versionId: '1.20.1' },
  ];

  it('格式非法时直接把原因带出来（复用 checkInstanceName 的理由）', () => {
    for (const bad of ['', 'a/b', 'CON', 'x'.repeat(200), 'a.', ' 前后空格 ']) {
      const r = checkInstanceNameAgainst(bad, '1.21.1', existing);
      expect(r.error, `${bad} 应被拦住`).toBeTruthy();
      expect(r.hint).toBeUndefined();
    }
  });

  it('全新的名字放行', () => {
    expect(checkInstanceNameAgainst('全新的世界', '1.21.1', existing)).toEqual({});
  });

  it('撞上同名实例、但装的是同一个 MC 版本 → 只提示，不挡（那本来就是更新它）', () => {
    const r = checkInstanceNameAgainst('我的空岛', '1.21.1', existing);
    expect(r.error).toBeUndefined();
    expect(r.hint).toContain('1.21.1');
  });

  it('撞上同名实例、装的是别的 MC 版本 → 拦住（否则会把人家实例改成这个版本）', () => {
    const r = checkInstanceNameAgainst('我的空岛', '1.20.1', existing);
    expect(r.error).toContain('我的空岛');
    expect(r.error).toContain('1.21.1');
  });

  it('只有大小写不同也算撞（Windows 上目录不分大小写）', () => {
    const r = checkInstanceNameAgainst('fabulously optimized', '1.20.1', existing);
    expect(r.error).toContain('Fabulously Optimized');
    expect(r.error).toMatch(/大小写/);
  });

  it('大小写不同 + 同版本也拦住：主进程按精确 id 比对，会造出指向同一文件夹的两条记录', () => {
    const r = checkInstanceNameAgainst('fabulously optimized', '1.20.1', [
      { id: 'Fabulously Optimized', versionId: '1.20.1' },
    ]);
    expect(r.error).toBeTruthy();
  });

  it('空实例列表 = 只做格式校验', () => {
    expect(checkInstanceNameAgainst('随便起', '1.21.1', [])).toEqual({});
  });

  it('拦住的理由一定是能给用户看的中文，且不含控制字符', () => {
    const CTRL = new RegExp('[' + '\u0000-\u001F' + ']');
    for (const name of ['a/b', '我的空岛', 'fabulously optimized']) {
      const r = checkInstanceNameAgainst(name, '1.20.1', existing);
      if (r.error) {
        expect(r.error.length).toBeGreaterThan(4);
        expect(CTRL.test(r.error)).toBe(false);
      }
    }
  });
});
