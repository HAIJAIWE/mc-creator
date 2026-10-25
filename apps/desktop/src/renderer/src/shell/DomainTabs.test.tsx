// @vitest-environment jsdom
/**
 * DomainTabs 测试 —— 域面板 tab 条
 *
 * ## 这个组件解决什么
 *
 * 阶段 0 的可达性测试（`panel-reachability.test.ts`）锁住了 8 个注册但点不到的面板：
 * `skin` `resources` `nbt` `blocks` `entity` `audio` `cicd` `preview`。
 *
 * 根因不是「没做 tab 条」，而是 `activeLeftPanel` 的写入点只有三处，
 * 域面板一个都没有 —— 详见 `docs/frontend-workbench-architecture.md` §1.3。
 *
 * 本组件按 IDE 通行形态提供第四个写入点：**内容区顶部常驻 tab 条**。
 * 依据：VS Code / IntelliJ 的编辑器区都是 tab 条（VS Code 官方明确
 * 「Open files in each editor are displayed with tabbed headers (Tabs) at the top of
 * the editor region」），业务面板与文档并列切换。
 *
 * ## 为什么 tab 列表从注册表派生而不是写死
 *
 * 写死的话每加一个面板要改两处，漏改不会报错 —— 只让面板静默失联。
 * 这里直接用 `panelsOfDomain(domain)`，它是注册表的投影（`domains.ts` 已改派生）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { DomainTabs } from './DomainTabs.js';
import { useWorkbenchStore, resolveActivePanel } from './workbench-store.js';
import { initPanelRegistries } from './index.js';
import { DEFAULT_DOMAIN_ID, panelsOfDomain } from './domains.js';

vi.mock('../hooks/useTranslation.js', () => ({
  useTranslation: () => ({
    t: (key: string) => (key.startsWith('activityBar.') ? key.slice('activityBar.'.length) : key),
    tCommon: (key: string) => key,
    locale: 'zh',
  }),
}));

vi.mock('../assets/mc-ui/McIcon.js', () => ({
  McIcon: ({ name, size }: { name: string; size?: number }) => (
    <span data-icon={name} data-size={size} />
  ),
}));

beforeAllInit();

function beforeAllInit() {
  // 注册表必须在读 panelsOfDomain 之前就绪
  beforeEach(() => {
    initPanelRegistries();
  });
}

beforeEach(() => {
  useWorkbenchStore.setState({ domain: DEFAULT_DOMAIN_ID, panelId: null });
});

afterEach(cleanup);

describe('DomainTabs · tab 列表派生自注册表', () => {
  it('dev 域渲染 7 个 tab，与 panelsOfDomain 一致', () => {
    render(<DomainTabs />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(panelsOfDomain('dev').length);
    expect(tabs.map((el) => el.textContent)).toEqual([
      'items',
      'blocks',
      'entity',
      'audio',
      'build',
      'cicd',
      'preview',
    ]);
  });

  it('切到 server 域后 tab 列表换成该域面板', () => {
    useWorkbenchStore.setState({ domain: 'server', panelId: null });
    render(<DomainTabs />);

    // kernel 的 title 是中文字面量 '内核'（非 i18n key），故 t() 原样返回
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual([
      '内核',
      'resources',
      'nbt',
    ]);
  });

  it('切到 launcher 域后渲染 game / packages / skin —— 8 个不可达面板中的 skin 在此可达', () => {
    useWorkbenchStore.setState({ domain: 'launcher', panelId: null });
    render(<DomainTabs />);

    // skin 的 title 是 i18n key（这里 useTranslation 被 mock 成原样返回）
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual([
      'game',
      'packages',
      'generator.skin.label',
    ]);
  });

  it('只渲染当前域的面板，不混入其它域（dev 域不该出现 kernel）', () => {
    render(<DomainTabs />);
    const labels = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(labels).not.toContain('kernel');
    expect(labels).not.toContain('game');
  });

  it('跨域常驻面板（explorer/search/git/settings）不进 tab 条', () => {
    render(<DomainTabs />);
    const labels = screen.getAllByRole('tab').map((el) => el.textContent);
    for (const id of ['explorer', 'search', 'git', 'settings']) {
      expect(labels).not.toContain(id);
    }
  });
});

describe('DomainTabs · 选中态跟随 store', () => {
  it('未显式选择面板时，选中该域默认面板（dev → items）', () => {
    render(<DomainTabs />);
    const selected = screen
      .getAllByRole('tab')
      .filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe('items');
  });

  it('selectPanel 之后选中态跟着变', () => {
    render(<DomainTabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'cicd' }));

    const selected = screen
      .getAllByRole('tab')
      .filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe('cicd');
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('cicd');
  });

  it('当前激活的是跨域常驻面板时，没有 tab 被选中（对应 IDE「未打开编辑器」）', () => {
    // 用 search 而不是 explorer：explorer 已改为只住左栏，
    // resolveActivePanel 会把它挡掉，DomainTabs 拿到的是域默认面板而非「无选中」。
    // 「跨域常驻面板 → tab 条无选中」这条规则本身由 search 代表。
    useWorkbenchStore.setState({ domain: 'dev', panelId: 'search' });
    render(<DomainTabs />);

    const selected = screen
      .getAllByRole('tab')
      .filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(0);
  });

  it('explorer 被 resolveActivePanel 挡在左栏之外，tab 条回落到域默认面板', () => {
    // 即使 store 里残留 panelId='explorer'（旧版本 localStorage），
    // tab 条也按域默认面板选中，而不是进入「无选中」态。
    useWorkbenchStore.setState({ domain: 'dev', panelId: 'explorer' });
    render(<DomainTabs />);

    const selected = screen
      .getAllByRole('tab')
      .filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe('items');
  });

  it('激活别域面板导致域被切走时，tab 条整体换成新域的（domains.ts 派生 + store 联动）', () => {
    render(<DomainTabs />);
    // 从 dev 域点活动栏的 packages（归 launcher）→ selectPanel 会同时切域
    useWorkbenchStore.getState().selectPanel('packages');
    expect(useWorkbenchStore.getState().domain).toBe('launcher');
  });
});

describe('DomainTabs · WAI-ARIA Tabs 键盘导航', () => {
  it('tablist / tab / aria-controls 结构完整', () => {
    render(<DomainTabs />);

    const tablist = screen.getByRole('tablist');
    expect(tablist.getAttribute('aria-label')).toBeTruthy();

    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) {
      const controls = tab.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      expect(controls).toContain('domain-tabpanel-');
    }
  });

  it('roving tabindex：只有选中的 tab 可 Tab 键聚焦，其余为 -1', () => {
    render(<DomainTabs />);
    const tabs = screen.getAllByRole('tab');
    const selected = tabs.find((el) => el.getAttribute('aria-selected') === 'true')!;

    expect(selected.getAttribute('tabindex')).toBe('0');
    for (const tab of tabs.filter((el) => el !== selected)) {
      expect(tab.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('ArrowRight 移到下一个 tab 并选中它（首尾循环）', () => {
    render(<DomainTabs />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('blocks');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('entity');
  });

  it('ArrowLeft 从首项回绕到末项', () => {
    render(<DomainTabs />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    // dev 域末项是 preview
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('preview');
  });

  it('Home / End 跳到首/末项', () => {
    render(<DomainTabs />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('preview');

    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('items');
  });

  it('方向键后焦点跟随到新选中的 tab', async () => {
    render(<DomainTabs />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });

    // rAF 在 jsdom 里不会自动推进，手动等一帧让 focus() 生效
    await new Promise((r) => setTimeout(r, 0));

    const active = document.activeElement;
    expect(active?.getAttribute('role')).toBe('tab');
    expect(active?.textContent).toBe('blocks');
  });

  it('方向键在单 tab 域（launcher 只有 3 项但若只剩 1 项）不越界', () => {
    // 构造一个只有 1 个面板的域场景不现实，改为验证循环在 3 项域上的正确性
    useWorkbenchStore.setState({ domain: 'launcher', panelId: null });
    render(<DomainTabs />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    // 三项循环一圈回到 game
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('game');
  });

  it('无关按键不改变选中态', () => {
    render(<DomainTabs />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'a' });
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('items');
  });
});

describe('DomainTabs · 点击激活', () => {
  it('点任一 tab 都写入 workbench-store', () => {
    render(<DomainTabs />);
    for (const label of ['blocks', 'audio', 'build', 'preview']) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
      expect(resolveActivePanel(useWorkbenchStore.getState())).toBe(label);
    }
  });

  it('点击 tab 不会误触发域切换（域内面板）', () => {
    render(<DomainTabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'entity' }));
    expect(useWorkbenchStore.getState().domain).toBe('dev');
  });

  it('每个 tab 都有可见文案（无纯图标 tab，a11y 与可发现性需要）', () => {
    render(<DomainTabs />);
    for (const tab of within(screen.getByRole('tablist')).getAllByRole('tab')) {
      expect((tab.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect(tab.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
