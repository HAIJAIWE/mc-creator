import { describe, it, expect } from 'vitest';

import { WIKI_ORIGIN, wikiUrlFor } from './wiki-links.js';

/**
 * 更新日志链接的规则。
 *
 * 这条规则错了**不会报错**，只会静默跳到 404 —— 所以必须钉死。
 * 依据：用户实测 PCL 的更新日志按钮**按版本**走，
 * 中文 Wiki 的页面标题形如「Java版26.3」。
 */
describe('wikiUrlFor · 版本更新日志链接', () => {
  it('用中文 Wiki，版本号拼在「Java版」后', () => {
    expect(wikiUrlFor('26.3')).toBe('https://zh.minecraft.wiki/w/Java版26.3');
    expect(wikiUrlFor('1.21.11')).toBe('https://zh.minecraft.wiki/w/Java版1.21.11');
  });

  it('快照版同规则（实测 Java版26.4-snapshot-3 返回 200）', () => {
    expect(wikiUrlFor('26.4-snapshot-3')).toBe('https://zh.minecraft.wiki/w/Java版26.4-snapshot-3');
  });

  it('远古版 / 预览版形态（b1.7.3、15w14a、1.2.5）', () => {
    expect(wikiUrlFor('b1.7.3')).toBe('https://zh.minecraft.wiki/w/Java版b1.7.3');
    expect(wikiUrlFor('15w14a')).toBe('https://zh.minecraft.wiki/w/Java版15w14a');
    expect(wikiUrlFor('1.2.5')).toBe('https://zh.minecraft.wiki/w/Java版1.2.5');
  });

  it('版本号做 URL 编码 —— 不能把用户给的字符串裸拼进地址', () => {
    // 真实版本号不会被改动（见上），但畸形输入不能拼出畸形 URL
    expect(wikiUrlFor('1.21/../admin')).not.toContain('/../');
    expect(wikiUrlFor('a b')).toBe('https://zh.minecraft.wiki/w/Java版a%20b');
  });

  it('固定用中文 Wiki 前缀（不发错到英文站）', () => {
    expect(wikiUrlFor('26.3').startsWith(WIKI_ORIGIN)).toBe(true);
    expect(wikiUrlFor('26.3')).not.toContain('minecraft.wiki/w/Java_Edition');
  });
});
