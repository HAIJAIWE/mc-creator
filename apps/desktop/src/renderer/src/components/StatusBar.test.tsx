/**
 * 底部 StatusBar —— IDE 标准层的回归网。
 *
 * ## 为什么加这一层
 *
 * 设计文档 §1.8 把它列为「此前缺失的 IDE 结构性层级」。补它的直接动因是：
 * 「内容类型 / 加载器 / MC 版本」按 IDE 惯例要从顶部挪走（VS Code / IntelliJ 顶部都不放
 * 项目配置），但挪走之后用户在工作中就看不到当前构建上下文了。状态栏是它们该在的位置
 * —— VS Code 显示语言/缩进/行列，IntelliJ 显示编码/行号，都是底部只读上下文。
 *
 * 这里锁三件事：
 *  1. 只读展示，且**不吞点击**（点得到设置才是「显示 + 跳转」而不是「装饰」）；
 *  2. 「非 mod 类型不显示 loader」这条规则与 `needsLoader` 一致；
 *  3. 无项目时不显示 undefined / 空串这类占位垃圾。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StatusBar } from './StatusBar.js';

const state = {
  generatorType: 'mod' as string,
  loader: 'fabric' as string,
  mcVersion: '1.21.11' as string,
  project: { id: 'p1', name: '我的整合包' },
};

vi.mock('../store/mod-store.js', () => ({
  useModStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

vi.mock('../store/project-store.js', () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({
      currentProjectId: state.project?.id ?? null,
      projects: state.project ? [state.project] : [],
    }),
}));

const selectPanel = vi.fn();
vi.mock('../shell/workbench-store.js', () => ({
  useWorkbenchStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ selectPanel }),
  // 选择器本身也是被 import 的符号，必须是函数（组件里写作 useWorkbenchStore(selectSelectPanel)）
  selectSelectPanel: (s: { selectPanel: unknown }) => s.selectPanel,
}));

vi.mock('../assets/mc-ui/McIcon.js', () => ({
  McIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.generatorType = 'mod';
  state.loader = 'fabric';
  state.mcVersion = '1.21.11';
  state.project = { id: 'p1', name: '我的整合包' };
});

describe('StatusBar · 底部项目上下文', () => {
  it('role=status 且有可访问名称', () => {
    render(<StatusBar />);
    const bar = screen.getByRole('status');
    expect(bar.getAttribute('aria-label')).toBeTruthy();
  });

  it('展示项目名 / 内容类型 / 加载器 / MC 版本', () => {
    render(<StatusBar />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('我的整合包');
    expect(text).toContain('Fabric');
    expect(text).toContain('1.21.11');
  });

  it('不渲染任何表单控件 —— 状态栏只做只读展示，编辑归设置面板', () => {
    render(<StatusBar />);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('点击任意上下文项 → 跳到 settings 面板', () => {
    render(<StatusBar />);
    fireEvent.click(screen.getByText('1.21.11'));
    expect(selectPanel).toHaveBeenCalledWith('settings');
  });

  it('非 mod 类型时不显示 loader（与 needsLoader 一致）', () => {
    state.generatorType = 'datapack';
    render(<StatusBar />);
    expect(screen.getByRole('status').textContent).not.toContain('Fabric');
  });

  it('无项目时显示占位文案，不渲染 undefined', () => {
    state.project = null as unknown as { id: string; name: string };
    render(<StatusBar />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
