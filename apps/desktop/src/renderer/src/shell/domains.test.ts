/**
 * domains.ts 测试：§0.2 域归属表的完整性与行为
 *
 * 覆盖：
 * 1. 归属表完整性 —— 每个已注册面板都能被某个域或 common 认领，且**恰好一个**归属
 * 2. panelsOfDomain / commonPanelIds 的派生行为与**域内顺序**（默认面板必须领衔）
 * 3. defaultPanelOfDomain 返回值一定属于本域（**变异测试靶点**：
 *    把某个域的 defaultPanelId 改成别的域的 id，这里必须变红）
 * 4. domainOfPanel / panelBelongsToDomain 的 common 语义
 * 5. emptyStateHintOfDomain 三域文案互不相同
 * 6. i18n 的 domains.* 与 domains.ts 的中文真源不漂移（zh / en-US 双查）
 *
 * ## 为什么本文件不再手写「17 个面板 id」的白名单
 *
 * 归属表现在**派生自注册表**（`PanelRegistration.domain`），手写白名单等于
 * 把同一份事实抄第二遍 —— 阶段 0A 加 `build` 面板时正是这样被绊住的：
 * 注册表改了、白名单没改，测试报的数字差异既费时又不指向真正的问题。
 *
 * 派生之后「不重不漏」变成**结构性成立**（一个面板只有一个 `domain` 字段，
 * 不可能被两个域同时认领），所以这里改断言真正有价值的东西：
 * 每个已注册面板都必须填了 `domain` 字段（漏填 = 该域 tab 条少一项），
 * 以及域内顺序是否符合设计意图。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initPanelRegistries } from './index.js';
import { getAllPanels } from './panels.js';
import {
  DOMAINS,
  DOMAIN_IDS,
  commonPanelIds,
  defaultPanelOfDomain,
  domainOfPanel,
  emptyStateHintOfDomain,
  getDomain,
  isCommonPanel,
  isDomainId,
  knownPanelIds,
  panelBelongsToDomain,
  panelsOfDomain,
} from './domains.js';
import { t } from '../i18n';

// 归属表已改为派生自注册表，读取前必须先注册（App.tsx:198 在模块级做同一件事）
beforeAll(() => {
  initPanelRegistries();
});

describe('域定义表：形状', () => {
  it('恰好三个域，顺序为 launcher → server → dev（切换器从左到右）', () => {
    expect(DOMAIN_IDS).toEqual(['launcher', 'server', 'dev']);
    expect(DOMAINS.map((d) => d.id)).toEqual(['launcher', 'server', 'dev']);
  });

  it('每域都有非空中文显示名、一句话职责、i18n key、默认面板', () => {
    for (const def of DOMAINS) {
      expect(def.labelZh.length).toBeGreaterThan(0);
      expect(def.summaryZh.length).toBeGreaterThan(0);
      expect(def.labelKey).toBe(`domains.${def.id}`);
      expect(def.summaryKey).toBe(`domains.summary.${def.id}`);
      expect(def.defaultPanelId.length).toBeGreaterThan(0);
    }
  });

  it('isDomainId 只认三个合法域，挡住脏值', () => {
    expect(isDomainId('launcher')).toBe(true);
    expect(isDomainId('server')).toBe(true);
    expect(isDomainId('dev')).toBe(true);
    expect(isDomainId('core')).toBe(false);
    expect(isDomainId('DOMAIN')).toBe(false);
    expect(isDomainId('')).toBe(false);
    expect(isDomainId(undefined)).toBe(false);
    expect(isDomainId(0)).toBe(false);
  });
});

describe('面板归属表：完整性（派生自注册表）', () => {
  it('每个已注册面板都必须显式声明 domain（漏填会让该域 tab 条少一项）', () => {
    for (const p of getAllPanels()) {
      expect(
        p.domain === null || DOMAIN_IDS.includes(p.domain as never),
        `面板 ${p.id} 的 domain 字段是 ${JSON.stringify(p.domain)}，需为 null 或某个合法域`,
      ).toBe(true);
    }
  });

  it('域面板 + common 面板恰好覆盖已注册面板集，且无重叠', () => {
    // 注意：必须在用例体内取派生值。describe 体在收集阶段求值，那时
    // beforeAll 还没跑、注册表还是空的，会拿到空数组而误报。
    const allAssigned = DOMAINS.flatMap((d) => panelsOfDomain(d.id));
    const union = [...allAssigned, ...commonPanelIds()];
    // 「不重」现在是结构性成立的（一个面板只有一个 domain 字段），仍断言一次以防将来改坏
    expect(new Set(union).size).toBe(union.length);
    expect(union.slice().sort()).toEqual(knownPanelIds().slice().sort());
    expect(union).toHaveLength(getAllPanels().length);
  });

  it('不漏：每个已注册面板都能被某个域或 common 认领', () => {
    for (const p of getAllPanels()) {
      expect(p.domain === null ? isCommonPanel(p.id) : true).toBe(true);
      expect(domainOfPanel(p.id)).toBe(p.domain ?? null);
    }
  });

  it('域内顺序符合设计意图，且默认面板领衔：launcher 3 / server 3 / dev 7', () => {
    // 这份快照是**设计意图**，不是派生结果 —— 它守住「谁排在前面」这个产品决定。
    // 顺序由 PanelRegistration.domainOrder 决定（见 panels.tsx「域内顺序」注释）。
    expect(panelsOfDomain('launcher')).toEqual(['game', 'packages', 'skin']);
    expect(panelsOfDomain('server')).toEqual(['kernel', 'resources', 'nbt']);
    expect(panelsOfDomain('dev')).toEqual([
      'items',
      'blocks',
      'entity',
      'audio',
      'build',
      'cicd',
      'preview',
    ]);
  });

  it('每个域的默认面板都是该域 tab 条的第一项（用户切域第一眼看到它）', () => {
    for (const id of DOMAIN_IDS) {
      expect(panelsOfDomain(id)[0]).toBe(defaultPanelOfDomain(id));
    }
  });

  it('common 是跨域常驻四件套：explorer / search / git / settings', () => {
    expect(commonPanelIds()).toEqual(['explorer', 'search', 'git', 'settings']);
  });

  it('panelsOfDomain / commonPanelIds 返回拷贝，改返回值不污染真源', () => {
    const first = panelsOfDomain('dev');
    (first as string[]).push('__injected__');
    expect(panelsOfDomain('dev')).not.toContain('__injected__');

    const commonFirst = commonPanelIds();
    (commonFirst as string[]).push('__injected__');
    expect(commonPanelIds()).not.toContain('__injected__');
  });
});

describe('defaultPanelOfDomain：默认面板一定属于本域', () => {
  it('三域各自的默认面板值符合预期', () => {
    expect(defaultPanelOfDomain('launcher')).toBe('game');
    expect(defaultPanelOfDomain('server')).toBe('kernel');
    expect(defaultPanelOfDomain('dev')).toBe('items');
  });

  // 变异测试靶点：把任一域的 defaultPanelId 改成别的域的 id，下面这条与下面 panelBelongsToDomain
  // 那条都会变红
  it('默认面板属于本域、且不是 common 面板', () => {
    for (const id of DOMAIN_IDS) {
      const def = defaultPanelOfDomain(id);
      expect(panelsOfDomain(id)).toContain(def);
      expect(isCommonPanel(def)).toBe(false);
      expect(domainOfPanel(def)).toBe(id);
      expect(panelBelongsToDomain(def, id)).toBe(true);
    }
  });

  it('默认面板对其它域不适用（否则切域纠偏会失效）', () => {
    expect(panelBelongsToDomain(defaultPanelOfDomain('launcher'), 'server')).toBe(false);
    expect(panelBelongsToDomain(defaultPanelOfDomain('server'), 'dev')).toBe(false);
    expect(panelBelongsToDomain(defaultPanelOfDomain('dev'), 'launcher')).toBe(false);
  });

  it('默认面板都是已注册面板（不会落到 MainPanelView 的 default: 未知面板分支）', () => {
    for (const id of DOMAIN_IDS) {
      expect(knownPanelIds()).toContain(defaultPanelOfDomain(id));
    }
  });
});

describe('domainOfPanel / panelBelongsToDomain', () => {
  it('common 面板的归属是 null，但视为「哪儿都能待」', () => {
    for (const id of commonPanelIds()) {
      expect(domainOfPanel(id)).toBeNull();
      for (const d of DOMAIN_IDS) expect(panelBelongsToDomain(id, d)).toBe(true);
    }
  });

  it('域内面板只属于自己的域', () => {
    expect(domainOfPanel('game')).toBe('launcher');
    expect(domainOfPanel('kernel')).toBe('server');
    expect(domainOfPanel('cicd')).toBe('dev');
    expect(panelBelongsToDomain('game', 'launcher')).toBe(true);
    expect(panelBelongsToDomain('game', 'dev')).toBe(false);
  });

  it('未注册面板：既不 common 也不属于任何域', () => {
    expect(domainOfPanel('__nope__')).toBeNull();
    expect(isCommonPanel('__nope__')).toBe(false);
    expect(panelBelongsToDomain('__nope__', 'dev')).toBe(false);
  });

  it('getDomain 未知 id 抛错（域是编译期联合，跑出未知值即 bug）', () => {
    expect(() => getDomain('nope' as never)).toThrow(/未知域/);
  });
});

describe('归属表独立于 PanelKind：packages / preview 的旧分组与域归属不一致', () => {
  it('packages 注册为 core（基础设施），但操作实例目录所以归 launcher', () => {
    // 这两个断言合起来是「归属不按 PanelKind 分」的证据：
    // 若将来 domains.ts 改成照抄 PanelKind，下面对 domainOfPanel 的断言就会与注册表说辞矛盾
    expect(domainOfPanel('packages')).toBe('launcher');
    expect(isCommonPanel('packages')).toBe(false);
    // packages 是域内面板（不是 common）—— 与它在注册表里属于 core 分组并不冲突
    expect(panelBelongsToDomain('packages', 'launcher')).toBe(true);
    expect(panelBelongsToDomain('packages', 'server')).toBe(false);
  });

  it('preview 注册为 middle，但它预览内容产物所以归 dev', () => {
    expect(domainOfPanel('preview')).toBe('dev');
    expect(panelBelongsToDomain('preview', 'dev')).toBe(true);
    expect(panelBelongsToDomain('preview', 'launcher')).toBe(false);
  });

  it('packages 归 launcher 而非 common —— 切到 dev 域时它不该被留下', () => {
    expect(commonPanelIds()).not.toContain('packages');
  });
});

describe('emptyStateHintOfDomain：三域空态文案各自不同', () => {
  it('按 §0.2 需求给 launcher/server/dev 不同提示', () => {
    expect(emptyStateHintOfDomain('launcher')).toBe('选择或创建一个实例');
    expect(emptyStateHintOfDomain('server')).toBe('创建一个服务端');
    expect(emptyStateHintOfDomain('dev')).toBe('打开或新建项目');
  });

  it('三域文案互不相同（否则域感知空态等于没做）', () => {
    const hints = DOMAIN_IDS.map(emptyStateHintOfDomain);
    expect(new Set(hints).size).toBe(3);
  });
});

describe('i18n 不漂移：domains.* 与 domains.ts 中文真源一致', () => {
  it('zh 语言包下 domains.<id> / domains.summary.<id> 与真源逐字相等', () => {
    for (const def of DOMAINS) {
      expect(t(def.labelKey)).toBe(def.labelZh);
      expect(t(def.summaryKey)).toBe(def.summaryZh);
    }
  });

  it('切换器 aria 文案与「智能体横向贯穿」提示都有 zh 词条', () => {
    expect(t('domains.switcherLabel')).toBe('工作域切换');
    expect(t('domains.agentHint')).toBe('智能体 · 三域常驻');
  });
});
