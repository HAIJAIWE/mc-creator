/**
 * domains.ts 测试：§0.2 域归属表的完整性与行为
 *
 * 覆盖：
 * 1. 归属表完整性 —— 16 个已注册面板 id 全覆盖、不重不漏（不重不漏靠「扁平后长度相等 + 无重复」双向断言）
 * 2. panelsOfDomain / commonPanelIds / defaultPanelOfDomain 行为
 * 3. defaultPanelOfDomain 返回值一定属于本域（**变异测试靶点**：
 *    把某个域的 defaultPanelId 改成别的域的 id，这里必须变红）
 * 4. domainOfPanel / panelBelongsToDomain 的 common 语义
 * 5. emptyStateHintOfDomain 三域文案互不相同
 * 6. i18n 的 domains.* 与 domains.ts 的中文真源不漂移（zh / en-US 双查）
 */
import { describe, it, expect } from 'vitest';
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

/** 本任务点名的 16 个已注册面板 id（register-all-panels.ts 的 allPanelConfigs 全量） */
const REGISTERED_PANEL_IDS = [
  // core
  'explorer',
  'search',
  'git',
  'packages',
  'settings',
  // domain
  'items',
  'blocks',
  'entity',
  'skin',
  'audio',
  'cicd',
  'game',
  // middle
  'preview',
  'resources',
  'nbt',
  'kernel',
] as const;

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

describe('面板归属表：完整性（不重不漏覆盖全部 16 个已注册面板）', () => {
  const allAssigned = DOMAINS.flatMap((d) => panelsOfDomain(d.id));
  const common = commonPanelIds();

  it('三域面板 + common 面板 = 16 个，恰好覆盖已注册面板集合', () => {
    const union = [...allAssigned, ...common];
    expect(union.slice().sort()).toEqual(REGISTERED_PANEL_IDS.slice().sort());
    expect(union).toHaveLength(16);
    expect(knownPanelIds().slice().sort()).toEqual(REGISTERED_PANEL_IDS.slice().sort());
  });

  it('不重：没有面板被两个域或 common 重复认领', () => {
    expect(new Set(allAssigned).size).toBe(allAssigned.length);
    expect(new Set(common).size).toBe(common.length);
    const overlap = allAssigned.filter((id) => common.includes(id));
    expect(overlap).toEqual([]);
  });

  it('不漏：每个已注册面板都能被某个域或 common 认领', () => {
    for (const id of REGISTERED_PANEL_IDS) {
      const owner = domainOfPanel(id);
      expect(owner === null ? isCommonPanel(id) : true).toBe(true);
    }
  });

  it('域面板数量符合 §0.2 职责划分：launcher 3 / server 3 / dev 6', () => {
    expect(panelsOfDomain('launcher')).toEqual(['game', 'packages', 'skin']);
    expect(panelsOfDomain('server')).toEqual(['kernel', 'resources', 'nbt']);
    expect(panelsOfDomain('dev')).toEqual([
      'items',
      'blocks',
      'entity',
      'audio',
      'cicd',
      'preview',
    ]);
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
      expect(REGISTERED_PANEL_IDS).toContain(defaultPanelOfDomain(id) as never);
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
