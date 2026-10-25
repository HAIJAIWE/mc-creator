// @vitest-environment jsdom
/**
 * Workbench 核心集成测试（无完整 App 渲染）——聚焦 store 与核心组件行为
 *
 * 覆盖：
 * 1. workbench-store 状态机：切域重置、selectPanel 跨域切域
 * 2. DomainTabs：列表派生、选中态、点击、键盘导航
 * 3. TopToolbar：构建按钮仅 dev 域可见、点击触发 selectPanel
 * 4. ActivityBar：core 面板点击
 * 4. 核心 a11y：ActivityBar、DomainTabs
 *
 * 不渲染完整 App（避免 lazy-loaded 组件在测试环境失效）
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import 'axe-core';
import type * as AxeTypes from 'axe-core';
import { DomainTabs } from '../shell/DomainTabs.js';
import { ActivityBar } from '../components/ActivityBar.js';
import { TopToolbar } from '../components/TopToolbar.js';
import { useWorkbenchStore, resolveActivePanel } from '../shell/workbench-store.js';
import { initPanelRegistries } from '../shell/index.js';
import { DEFAULT_DOMAIN_ID, panelsOfDomain } from '../shell/domains.js';

type Axe = typeof import('axe-core');
function getAxe(): Axe {
  const axe = (window as unknown as { axe?: Axe }).axe;
  if (!axe) throw new Error('window.axe 未就绪，需先 import axe-core');
  return axe;
}

function expectNoViolations(violations: AxeTypes.Result[]): void {
  if (violations.length > 0) {
    const lines = violations.map((v) => {
      const nodes = v.nodes
        .map((n) => {
          const target = Array.isArray(n.target) ? n.target.join(', ') : String(n.target);
          return `    - target: ${target}\n      ${n.failureSummary ?? '(no summary)'}`;
        })
        .join('\n');
      return `[${v.id}] ${v.help}\n  impact: ${v.impact}\n  help: ${v.helpUrl}\n  nodes:\n${nodes}`;
    });
    throw new Error(`axe-core 检出 ${violations.length} 个 a11y 违规\n${lines.join('\n\n')}`);
  }
}

// runAxe removed - using axe.run directly in tests

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

vi.mock('../components/LanguageSwitcher.js', () => ({
  LanguageSwitcher: () => <span data-testid="lang-switcher" />,
}));

const MOD_STATE = {
  generatorType: 'mod',
  loader: 'fabric',
  mcVersion: '1.20.1',
  loading: false,
  setGeneratorType: vi.fn(),
  setLoader: vi.fn(),
  setMcVersion: vi.fn(),
  spec: null,
  files: [],
  description: '',
  setError: vi.fn(),
};

vi.mock('../store/mod-store.js', () => ({
  useModStore: (selector: (s: typeof MOD_STATE) => unknown) => selector(MOD_STATE),
}));

vi.mock('../store/model-config-store.js', () => ({
  useModelConfigStore: () => ({ apiKey: 'sk-test' }),
}));

vi.mock('../store/project-store.js', () => ({
  useProjectStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      projects: [],
      loadProjects: vi.fn(),
      loadProject: vi.fn(),
      importProject: vi.fn(),
      saveCurrentAsProject: vi.fn(),
      currentProjectId: null,
    }),
}));

beforeAll(() => {
  initPanelRegistries();
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useWorkbenchStore.setState({ domain: DEFAULT_DOMAIN_ID, panelId: null });
});

afterEach(() => {
  cleanup();
});

describe('Workbench · 核心集成（store + 核心组件）', () => {
  describe('workbench-store 状态机', () => {
    it('初始状态：dev 域，panelId=null，解析为 items', () => {
      const s = useWorkbenchStore.getState();
      expect(s.domain).toBe('dev');
      expect(s.panelId).toBeNull();
      expect(resolveActivePanel(s)).toBe('items');
    });

    it('setDomain(d) → 重置 panelId=null，解析为该域默认面板', () => {
      const { setDomain } = useWorkbenchStore.getState();
      setDomain('server');
      const s = useWorkbenchStore.getState();
      expect(s.domain).toBe('server');
      expect(s.panelId).toBeNull();
      expect(resolveActivePanel(s)).toBe('kernel');
    });

    it('selectPanel(归属别域面板) → 同步切域', () => {
      const { selectPanel } = useWorkbenchStore.getState();
      selectPanel('packages'); // packages 归 launcher
      const s = useWorkbenchStore.getState();
      expect(s.domain).toBe('launcher');
      expect(resolveActivePanel(s)).toBe('packages');
    });

    it('selectPanel(跨域常驻面板) → 不切域', () => {
      const { selectPanel } = useWorkbenchStore.getState();
      selectPanel('search');
      const s = useWorkbenchStore.getState();
      expect(s.domain).toBe('dev');
      expect(resolveActivePanel(s)).toBe('search');
    });

    it('resolveActivePanel：失效值兜底为该域默认面板', () => {
      expect(resolveActivePanel({ domain: 'dev', panelId: '__bad__' })).toBe('items');
      expect(resolveActivePanel({ domain: 'server', panelId: 'explorer' })).toBe('kernel');
      expect(resolveActivePanel({ domain: 'launcher', panelId: 'build' })).toBe('game');
      expect(resolveActivePanel({ domain: 'dev', panelId: null })).toBe('items');
    });

    it('跨域常驻面板在任何域都合法', () => {
      for (const id of ['search', 'git', 'settings']) {
        expect(resolveActivePanel({ domain: 'launcher', panelId: id })).toBe(id);
        expect(resolveActivePanel({ domain: 'server', panelId: id })).toBe(id);
        expect(resolveActivePanel({ domain: 'dev', panelId: id })).toBe(id);
      }
    });
  });

  describe('DomainTabs', () => {
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

    it('切到 server 域后 tab 列表更新', () => {
      useWorkbenchStore.setState({ domain: 'server', panelId: null });
      render(<DomainTabs />);
      expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual([
        '内核',
        'resources',
        'nbt',
      ]);
    });

    it('点击 tab → workbench-store.selectPanel 被调用', async () => {
      const { selectPanel } = useWorkbenchStore.getState();
      const original = selectPanel;
      const spy = vi.fn((id) => original(id));
      useWorkbenchStore.setState({ selectPanel: spy });

      render(<DomainTabs />);
      fireEvent.click(screen.getByRole('tab', { name: 'entity' }));

      await waitFor(() => expect(spy).toHaveBeenCalledWith('entity'));
    });

    it('roving tabindex：只有选中 tab tabindex=0', () => {
      render(<DomainTabs />);
      const tabs = screen.getAllByRole('tab');
      const selected = tabs.find((el) => el.getAttribute('aria-selected') === 'true')!;
      expect(selected.getAttribute('tabindex')).toBe('0');
      for (const tab of tabs.filter((el) => el !== selected)) {
        expect(tab.getAttribute('tabindex')).toBe('-1');
      }
    });

    it('ArrowRight 循环切换', () => {
      render(<DomainTabs />);
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
      expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('blocks');
    });

    it('a11y：无违规（aria-valid-attr-value 已恢复启用 —— tabpanel 由组件自己渲染）', async () => {
      render(<DomainTabs />);
      const axe = getAxe();
      // 扫整个容器而不只是 tablist：aria-controls 指向的 tabpanel 在同一组件里，
      // 扫 tablist 单独片段无法证明引用真实存在
      const violations = await axe.run(document.body, {
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
        runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa'] },
      });
      expectNoViolations(violations.violations);
    });

    it('每个 tab 的 aria-controls 都指向真实存在的 tabpanel', () => {
      render(<DomainTabs />);
      const tabs = screen.getAllByRole('tab');
      for (const tab of tabs) {
        const controls = tab.getAttribute('aria-controls');
        expect(controls, 'tab 必须有 aria-controls').toBeTruthy();
        expect(
          document.getElementById(controls!),
          `aria-controls="${controls}" 指向的 tabpanel 必须存在于 DOM 中`,
        ).toBeTruthy();
      }
    });
  });

  describe('TopToolbar', () => {
    it('dev 域显示「构建」按钮', () => {
      render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild onOpenBuild={vi.fn()} />);
      expect(screen.getByRole('button', { name: /构建|Build/i })).toBeTruthy();
    });

    it('非 dev 域不显示构建按钮', () => {
      render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild={false} onOpenBuild={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /构建|Build/i })).toBeNull();
    });

    it('点击「构建」触发 onOpenBuild', () => {
      const onOpenBuild = vi.fn();
      render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild onOpenBuild={onOpenBuild} />);
      fireEvent.click(screen.getByRole('button', { name: /构建|Build/i }));
      expect(onOpenBuild).toHaveBeenCalledTimes(1);
    });

    it('a11y：无违规（select 已加 aria-label，不再禁用 select-name）', async () => {
      render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild onOpenBuild={vi.fn()} />);
      const toolbar =
        screen.getByRole('button', { name: /构建|Build/i }).closest('[role="toolbar"]') ??
        document.body;
      const axe = getAxe();
      const violations = await axe.run(toolbar, {
        // 只禁用 jsdom 无法判定的对比度；select-name / label 已在组件侧修复，
        // 保留启用 —— 若有人删掉 aria-label，这条会立刻变红
        rules: { 'color-contrast': { enabled: false } },
        runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa'] },
      });
      expectNoViolations(violations.violations);
    });

    it('顶部不再有任何项目配置下拉框（按 IDE 惯例迁至 SettingsPanel「项目」）', () => {
      render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild onOpenBuild={vi.fn()} />);
      // 依据 VS Code / IntelliJ：两者顶部都不放项目配置。
      // 原本这里是「内容类型 / 加载器 / MC 版本」三个 select，现已迁至
      // SettingsPanel 的「项目」分组（见 SettingsPanel.project.test.tsx）。
      // 这条断言防止它们被无声塞回顶部 —— 那正是这次要消除的布局问题。
      expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    });
  });

  describe('ActivityBar', () => {
    it('渲染 5 个 core 面板按钮', () => {
      render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={vi.fn()} />);
      // ActivityBar 按钮是 role="button"，不是 role="tab"
      const buttons = screen.getAllByRole('button', {
        name: /explorer|search|git|packages|settings/,
      });
      expect(buttons).toHaveLength(5);
    });

    it('点击 core 面板 → onChange', () => {
      const onChange = vi.fn();
      render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: /设置|Settings/i }));
      expect(onChange).toHaveBeenCalledWith('settings');
    });

    it('a11y：无违规', async () => {
      render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={vi.fn()} />);
      const axe = getAxe();
      const violations = await axe.run(screen.getByRole('toolbar'), {
        rules: { 'color-contrast': { enabled: false } },
        runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa'] },
      });
      expectNoViolations(violations.violations);
    });
  });
});
