/**
 * MC百科 别名解析测试。
 *
 * ## 这里的 HTML 片段是**实测**抓下来的
 *
 * （`https://www.mcmod.cn/modlist.html?key=钠` 第一条），不是手写的 ——
 * 解析器的全部风险就在于「它以为的页面结构」和「真实结构」不一致，用真实
 * 片段才能真测出来。条目块结构：
 *
 *   <div class="modlist-block">
 *     <div class="intro">…<span>简介</span></div>
 *     <div class="cover"><a href="/class/2785.html"><img alt="钠 (Sodium)" …></a></div>
 *     <div class="title">
 *       <p class="name"><a href="/class/2785.html">钠</a></p>
 *       <p class="ename"><a href="/class/2785.html">Sodium</a></p>
 *     </div>
 *   </div>
 */
import { describe, it, expect } from 'vitest';

import { parseMcmodAliasPage, pickEnglishNames, mcmodEntryUrl } from './alias.js';

/** 实测抓下来的两条（节选）。 */
const REAL_PAGE = `
<div class="modlist-block"><div class="intro"><i class="fa fa-info-circle intro-button"></i><a href="/class/2785.html" target="_blank" class="intro-content"><span>大大提高性能的 Minecraft 现代渲染引擎。</span></a></div><div class="cover"><a href="/class/2785.html" target="_blank"><img alt="钠 (Sodium)" src="//i.mcmod.cn/class/cover/20210430/1619789231_14273_KuIL.jpg@170x115.jpg" onerror="this.src=('/pages/class/images/none.jpg')"/></a></div><div class="title"><p class="name"><a href="/class/2785.html" target="_blank">钠</a></p><p class="ename"><a href="/class/2785.html" target="_blank">Sodium</a></p></div><div class="items"><p class="empty">暂无物品~</p></div></div>
<div class="modlist-block"><div class="intro"><i class="fa fa-info-circle intro-button"></i><a href="/class/3158.html" target="_blank" class="intro-content"><span>非官方的 Forge 1.16.2~1.16.5 版本的钠。</span></a></div><div class="cover"><a href="/class/3158.html" target="_blank"><img alt="氯 (Chlorine)" src="//i.mcmod.cn/class/cover/20201106/1604594194_14273_KhOb.jpg@170x115.jpg" onerror="this.src=('/pages/class/images/none.jpg')"/></a></div><div class="title"><p class="name"><a href="/class/3158.html" target="_blank">氯</a></p><p class="ename"><a href="/class/3158.html" target="_blank">Chlorine</a></p></div><div class="items"><p class="empty">暂无物品~</p></div></div>
`;

describe('parseMcmodAliasPage', () => {
  it('解出两条，中英文名与 id 都对', () => {
    const out = parseMcmodAliasPage(REAL_PAGE);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      mcmodId: '2785',
      cnName: '钠',
      enName: 'Sodium',
      summary: '大大提高性能的 Minecraft 现代渲染引擎。',
    });
    expect(out[1]).toEqual({
      mcmodId: '3158',
      cnName: '氯',
      enName: 'Chlorine',
      summary: '非官方的 Forge 1.16.2~1.16.5 版本的钠。',
    });
  });

  it('ename 是 &nbsp; 时当空串（拿空英文名去搜 Modrinth 没意义）', () => {
    const html = `<div class="modlist-block"><div class="title"><p class="name"><a href="/class/6945.html">No Indium?</a></p><p class="ename"><a href="/class/6945.html">&nbsp;</a></p></div></div>`;
    const out = parseMcmodAliasPage(html);
    expect(out[0]?.enName).toBe('');
    expect(out[0]?.cnName).toBe('No Indium?');
  });

  it('中英文都空的条目直接丢掉', () => {
    const html = `<div class="modlist-block"><div class="title"><p class="name"><a href="/class/1.html">&nbsp;</a></p><p class="ename"><a href="/class/1.html">&nbsp;</a></p></div></div>`;
    expect(parseMcmodAliasPage(html)).toEqual([]);
  });

  it('HTML 实体解出来（&amp; 之类）', () => {
    const html = `<div class="modlist-block"><div class="title"><p class="name"><a href="/class/1.html">A &amp; B</a></p><p class="ename"><a href="/class/1.html">A &amp; B</a></p></div></div>`;
    expect(parseMcmodAliasPage(html)[0]?.cnName).toBe('A & B');
  });

  it('没有条目块时返回空数组（不抛，上层显示"没查到"）', () => {
    expect(parseMcmodAliasPage('<html><body>什么都没有</body></html>')).toEqual([]);
  });

  it('没有 intro/简介的条目 summary 为空，不影响解析', () => {
    const html = `<div class="modlist-block"><div class="title"><p class="name"><a href="/class/1.html">甲</a></p><p class="ename"><a href="/class/1.html">Jia</a></p></div></div>`;
    expect(parseMcmodAliasPage(html)[0]).toEqual({
      mcmodId: '1',
      cnName: '甲',
      enName: 'Jia',
      summary: '',
    });
  });

  it('每块只取第一个 /class/<id>.html（块内有 4 个同 id 链接）', () => {
    const html = `<div class="modlist-block"><div class="intro"><a href="/class/99.html"><span>x</span></a></div><div class="cover"><a href="/class/99.html">c</a></div><div class="title"><p class="name"><a href="/class/99.html">甲</a></p><p class="ename"><a href="/class/99.html">Jia</a></p></div></div>`;
    expect(parseMcmodAliasPage(html)[0]?.mcmodId).toBe('99');
  });
});

describe('pickEnglishNames', () => {
  it('搜「钠」时把 Sodium 排在第一位（中文名完全相等最可信）', () => {
    const out = pickEnglishNames(parseMcmodAliasPage(REAL_PAGE), '钠');
    expect(out[0]).toBe('Sodium');
  });

  it('过滤掉没有英文名的条目（拿去搜 Modrinth 也没用）', () => {
    const aliases = [
      { mcmodId: '1', cnName: '甲', enName: '', summary: '' },
      { mcmodId: '2', cnName: '乙', enName: 'Yi', summary: '' },
    ];
    expect(pickEnglishNames(aliases, '甲')).toEqual(['Yi']);
  });

  it('去重（同一个英文名出现多次只给一次）', () => {
    const aliases = [
      { mcmodId: '1', cnName: '甲', enName: 'Dup', summary: '' },
      { mcmodId: '2', cnName: '甲', enName: 'dup', summary: '' },
    ];
    expect(pickEnglishNames(aliases, '甲')).toEqual(['Dup']);
  });

  it('遵守 limit', () => {
    const aliases = [1, 2, 3, 4, 5].map((n) => ({
      mcmodId: String(n),
      cnName: `n${n}`,
      enName: `E${n}`,
      summary: '',
    }));
    expect(pickEnglishNames(aliases, 'n', 2)).toHaveLength(2);
  });

  it('一条都不匹配时也给得出候选（比搜不到结果强）', () => {
    const out = pickEnglishNames(parseMcmodAliasPage(REAL_PAGE), '完全不相干的词');
    expect(out.length).toBeGreaterThan(0);
  });

  it('没有可用英文名时返回空数组', () => {
    expect(pickEnglishNames([], '钠')).toEqual([]);
  });
});

describe('mcmodEntryUrl', () => {
  it('拼出词条页（UI 的「转到 MC 百科」外链）', () => {
    expect(mcmodEntryUrl('2785')).toBe('https://www.mcmod.cn/class/2785.html');
  });
});
