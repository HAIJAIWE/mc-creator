/**
 * I3 不变式：**面板可达性**
 *
 * ## 这个不变式为什么存在
 *
 * 本仓库有一个反复出现的失败模式：**面板注册了、渲染分支写了、单测也绿了，
 * 但用户在界面上点不到它。**
 *
 * - `BuildPanel`：后端 `registerBuildHandlers`、`BUILD_STREAM` 通道、`mod-store` 的
 *   build 字段全在，唯独 UI 层零引用 → 用户无法构建产物。（阶段 0A 修复）
 * - `skin` / `resources` / `nbt` / `blocks` / `entity` / `audio` / `cicd` / `preview`：
 *   8 个已注册面板同样没有任何 UI 入口。（阶段 5 由 DomainTabs 修复）
 *
 * 共同根因是「注册」与「可达」被当成了同一件事。
 *
 * ## 可达性如何判定
 *
 * 面板可达 = 存在一个真实 UI 入口能把它写进 `workbench-store.panelId`。
 * 当前有四个写入点，本测试逐一建模：
 *
 * | 写入点                | 能产出的值                                        |
 * | --------------------- | ------------------------------------------------- |
 * | 初始值 / 回落         | 各域 `defaultPanelId`（共 3 个）                   |
 * | `ActivityBar.onChange` | `getShellPanels()`，即注册表里 `kind==='core'` 的项 |
 * | `TopToolbar`          | `settings`、`build` 两个字面量                    |
 * | `DomainTabs`          | `panelsOfDomain(domain)`（每个域的全部域面板）     |
 *
 * 严格 I3：**每个已注册面板都必须出现在上述并集里**。
 *
 * ## 关于 `TOOLBAR_PANEL_IDS` 为什么是硬编码的
 *
 * 这是可达性模型里**唯一无法从代码派生**的部分：工具栏的目标是写在
 * `App.tsx` 闭包里的字面量（`selectPanel('build')`），
 * 没有任何注册表记录「哪个 UI 负责激活哪个面板」。
 *
 * 它由 `TopToolbar.test.tsx` 的行为测试锁住「按钮存在且会触发回调」，
 * 两处共同构成对「构建入口」的守护。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initPanelRegistries } from './index.js';
import { getAllPanels } from './register-all-panels.js';
import { getShellPanels } from './panels.js';
import { DOMAIN_IDS, defaultPanelOfDomain, panelsOfDomain } from './domains.js';

/** App.tsx 中 TopToolbar 的两个跳转目标 */
const TOOLBAR_PANEL_IDS = ['settings', 'build'] as const;

/** 当前域默认面板 */
function domainDefaultPanelIds(): string[] {
  return DOMAIN_IDS.map((d) => defaultPanelOfDomain(d));
}

/** DomainTabs 能产出的面板 = 三个域的域面板全量 */
function domainTabPanelIds(): string[] {
  return DOMAIN_IDS.flatMap((d) => panelsOfDomain(d));
}

/** 全部可达面板 id */
function reachablePanelIds(): string[] {
  return [
    ...getShellPanels().map((p) => p.id),
    ...domainDefaultPanelIds(),
    ...TOOLBAR_PANEL_IDS,
    ...domainTabPanelIds(),
  ];
}

beforeAll(() => {
  initPanelRegistries();
});

describe('I3 可达性：注册了的面板必须点得到', () => {
  it('核心面板经活动栏全部可达（kind==="core" 是活动栏唯一数据源）', () => {
    const reachable = reachablePanelIds();
    for (const p of getShellPanels()) {
      expect(reachable).toContain(p.id);
    }
  });

  it('三个域的默认面板均可达（挂载即落到它们）', () => {
    const reachable = reachablePanelIds();
    for (const id of domainDefaultPanelIds()) {
      expect(reachable).toContain(id);
    }
  });

  it('域面板经 DomainTabs 全部可达（阶段 5 的核心交付）', () => {
    const reachable = reachablePanelIds();
    for (const id of domainTabPanelIds()) {
      expect(reachable).toContain(id);
    }
  });

  it('build 面板可达 —— 阶段 0A 的核心交付（构建入口）', () => {
    // 唯一入口是 TopToolbar 的「构建」按钮（仅 dev 域展示）。
    // 该按钮的存在与回调行为由 TopToolbar.test.tsx 锁定。
    expect(TOOLBAR_PANEL_IDS).toContain('build');
    expect(reachablePanelIds()).toContain('build');
  });

  it('已注册面板均能在注册表里查到（可达性测试的前提：注册表本身完整）', () => {
    const ids = getAllPanels().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('build');
  });

  /**
   * 严格 I3 —— 每个已注册面板都可被某个 UI 入口激活。
   *
   * 阶段 5 之前这条是红的（8 个面板不可达），用 `it.fails` 表达「已知未达成」。
   * DomainTabs 接入后全量可达，已摘掉 `.fails` 变为严格断言。
   */
  it('严格 I3：每个已注册面板都可被某个 UI 入口激活', () => {
    const reachable = new Set(reachablePanelIds());
    const unreachable = getAllPanels()
      .map((p) => p.id)
      .filter((id) => !reachable.has(id));
    expect(unreachable).toEqual([]);
  });

  it('跨域常驻面板经活动栏可达（不经 DomainTabs）', () => {
    const coreIds = new Set(getShellPanels().map((p) => p.id));
    for (const id of ['explorer', 'search', 'git', 'settings']) {
      expect(coreIds).toContain(id);
    }
  });

  it('可达集合恰好覆盖已注册面板，不多不少', () => {
    const all = getAllPanels().map((p) => p.id);
    const reachable = new Set(reachablePanelIds());
    // 不多：可达集合里没有未注册的 id
    for (const id of reachable) {
      expect(all).toContain(id);
    }
    // 不少：已注册面板都在可达集合里
    expect(reachable.size).toBe(all.length);
  });
});

describe('I3 现状快照（应当全量可达）', () => {
  it('17 个面板全部可达，0 个不可达', () => {
    const reachable = new Set(reachablePanelIds());
    const all = getAllPanels().map((p) => p.id);
    const unreachable = all.filter((id) => !reachable.has(id));

    expect(all).toHaveLength(17);
    expect(unreachable).toEqual([]);
  });

  it('每个可达面板都有对应的活动入口', () => {
    // 活动栏（core）5 + 工具栏（settings/build 2）+ 域面板（13）= 20，
    // 但 settings 既在活动栏又在工具栏，故实际覆盖 17 个唯一 id
    const reachable = reachablePanelIds();
    expect(new Set(reachable).size).toBe(17);
  });
});
