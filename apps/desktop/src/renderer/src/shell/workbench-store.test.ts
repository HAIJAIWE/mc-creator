/**
 * workbench-store 测试：D2「切域重置」语义 + 失效值兜底
 *
 * ## 为什么这些规则必须写成测试
 *
 * 重构前这套逻辑住在 `App.tsx` 的 `useState` + 域纠偏 `useEffect` 里，
 * 表现为「点了没反应 / 被静默弹回」，而且**没有任何测试覆盖** ——
 * `packages` 弹回 bug 就是这么活下来的。
 *
 * 现在规则集中在这里，纯函数化，可直接断言。三条不可让步的行为：
 *
 * 1. 切域 → 重置为该域默认面板（D2，用户拍板）
 * 2. 激活归属别域的面板 → **同时切域**，而不是弹回（取代旧的静默纠偏）
 * 3. 激活跨域常驻面板 → 不动域（否则点活动栏的「资源管理器」会把用户拽去别的域）
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useWorkbenchStore, resolveActivePanel } from './workbench-store.js';
import { initPanelRegistries } from './index.js';
import { defaultPanelOfDomain, DEFAULT_DOMAIN_ID } from './domains.js';

beforeAll(() => {
  initPanelRegistries();
});

beforeEach(() => {
  useWorkbenchStore.setState({ domain: DEFAULT_DOMAIN_ID, panelId: null });
});

describe('D2：切换工作域即重置面板', () => {
  it('初始状态：未显式选择面板（null），解析为该域默认面板', () => {
    const s = useWorkbenchStore.getState();
    expect(s.panelId).toBeNull();
    expect(resolveActivePanel(s)).toBe('items');
  });

  it('切到 server → 面板重置为 kernel', () => {
    const { setDomain } = useWorkbenchStore.getState();
    setDomain('server');
    const s = useWorkbenchStore.getState();
    expect(s.panelId).toBeNull();
    expect(resolveActivePanel(s)).toBe('kernel');
  });

  it('切到 launcher → 面板重置为 game', () => {
    const { setDomain } = useWorkbenchStore.getState();
    setDomain('launcher');
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('game');
  });

  it('域内切换面板后换域，原选择被丢弃（D2 的「重置」语义，不是按域记忆）', () => {
    const { selectPanel, setDomain } = useWorkbenchStore.getState();
    selectPanel('blocks');
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('blocks');

    setDomain('launcher');
    // 回到 dev 域时**不会**恢复 blocks —— 这正是 D2 选定的行为
    setDomain('dev');
    expect(useWorkbenchStore.getState().panelId).toBeNull();
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('items');
  });

  it('切到当前域自己：面板同样被重置（幂等，不保留原选择）', () => {
    const { selectPanel, setDomain } = useWorkbenchStore.getState();
    selectPanel('cicd');
    setDomain('dev');
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('items');
  });
});

describe('selectPanel：激活面板而非弹回', () => {
  it('激活本域面板：只改面板，域不动', () => {
    const { selectPanel } = useWorkbenchStore.getState();
    selectPanel('entity');
    const s = useWorkbenchStore.getState();
    expect(s.domain).toBe('dev');
    expect(s.panelId).toBe('entity');
  });

  it('激活归属别域的面板：同时切到那个域（取代旧的静默弹回）', () => {
    // packages 是 core（活动栏基础设施）但归 launcher —— 这正是原弹回 bug 的现场
    const { selectPanel } = useWorkbenchStore.getState();
    selectPanel('packages');
    const s = useWorkbenchStore.getState();
    expect(s.domain).toBe('launcher');
    expect(resolveActivePanel(s)).toBe('packages');
  });

  it('在 dev 域激活 server 域面板 → 切到 server 且面板可用', () => {
    const { selectPanel } = useWorkbenchStore.getState();
    selectPanel('nbt');
    const s = useWorkbenchStore.getState();
    expect(s.domain).toBe('server');
    expect(resolveActivePanel(s)).toBe('nbt');
  });

  it('激活跨域常驻面板：不改变当前域', () => {
    const { selectPanel } = useWorkbenchStore.getState();
    selectPanel('search');
    const s = useWorkbenchStore.getState();
    expect(s.domain).toBe('dev');
    expect(resolveActivePanel(s)).toBe('search');

    selectPanel('settings');
    expect(useWorkbenchStore.getState().domain).toBe('dev');
  });

  it("selectPanel('explorer') 不改域，但中栏解析回落到域默认面板", () => {
    // explorer 只住在左栏，中栏永不渲它（否则屏幕上两个文件树）。
    // 这里锁的是「即使有代码误调 selectPanel('explorer')，中栏也不会跟着变成文件树」。
    const { selectPanel } = useWorkbenchStore.getState();
    selectPanel('explorer');
    const s = useWorkbenchStore.getState();
    expect(s.domain).toBe('dev');
    expect(s.panelId).toBe('explorer');
    expect(resolveActivePanel(s)).toBe('items');
  });
});

describe('resolveActivePanel：失效值的唯一兜底点', () => {
  it('panelId 为 null → 域默认面板', () => {
    expect(resolveActivePanel({ domain: 'dev', panelId: null })).toBe('items');
    expect(resolveActivePanel({ domain: 'server', panelId: null })).toBe('kernel');
    expect(resolveActivePanel({ domain: 'launcher', panelId: null })).toBe('game');
  });

  it('panelId 未注册（面板被删 / localStorage 旧版本残留）→ 域默认面板', () => {
    // 这是真实场景：重构中删除面板后，用户 localStorage 里还留着它的 id
    expect(resolveActivePanel({ domain: 'dev', panelId: 'lowcode' })).toBe('items');
    expect(resolveActivePanel({ domain: 'dev', panelId: '__never_registered__' })).toBe('items');
  });

  it('panelId 已注册但归属别的域 → 域默认面板（不做跨域跳转）', () => {
    // 与 selectPanel 的行为刻意不同：selectPanel 是**用户主动点击**，
    // 带着意图，应当跟着走；这里是无来源的脏状态，应当就地收敛。
    expect(resolveActivePanel({ domain: 'launcher', panelId: 'kernel' })).toBe('game');
    expect(resolveActivePanel({ domain: 'dev', panelId: 'resources' })).toBe('items');
  });

  it('跨域常驻面板在任何域都合法（explorer 除外：它只住左栏）', () => {
    for (const id of ['search', 'git', 'settings']) {
      expect(resolveActivePanel({ domain: 'launcher', panelId: id })).toBe(id);
      expect(resolveActivePanel({ domain: 'server', panelId: id })).toBe(id);
      expect(resolveActivePanel({ domain: 'dev', panelId: id })).toBe(id);
    }
  });

  it('explorer 是左栏专属面板：中栏一律回落到域默认面板', () => {
    // 与上一条对照：explorer 虽同属 kind:'core' / domain:null，
    // 但它只住在左栏。若这里放行，中栏就会再渲一份 FileTree，
    // 和左栏常驻那份叠成两个文件树（见 file-tree-single-instance.test.tsx）。
    expect(resolveActivePanel({ domain: 'launcher', panelId: 'explorer' })).toBe('game');
    expect(resolveActivePanel({ domain: 'server', panelId: 'explorer' })).toBe('kernel');
    expect(resolveActivePanel({ domain: 'dev', panelId: 'explorer' })).toBe('items');
  });

  it('已注册且归属本域的面板原样返回', () => {
    expect(resolveActivePanel({ domain: 'dev', panelId: 'build' })).toBe('build');
    expect(resolveActivePanel({ domain: 'server', panelId: 'resources' })).toBe('resources');
  });

  it('resolveActivePanel 的回落结果对三域都满足 defaultPanelOfDomain', () => {
    // 兜底不能自己造一个 id，必须与域定义表的 defaultPanelId 一致
    for (const domain of ['launcher', 'server', 'dev'] as const) {
      expect(resolveActivePanel({ domain, panelId: '__garbage__' })).toBe(
        defaultPanelOfDomain(domain),
      );
    }
  });
});
