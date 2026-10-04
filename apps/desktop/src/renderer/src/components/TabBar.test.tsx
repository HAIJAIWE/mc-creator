// @vitest-environment jsdom
/**
 * 文件标签栏（TabBar）测试。
 *
 * ## 为什么先有这批测试
 *
 * TabBar 迁移到 `@mc-creator/ui` 的 `Tabs` 之前是**零测试**组件。它挂在
 * MiddlePanel 的「code」视图上（App → MainPanelView → MiddlePanel → TabBar），
 * 是真实生产路径，却没有任何行为被锁住 —— 迁移等于在无网高空改发动机。
 *
 * 所以这批用例有两层身份：
 * ① **迁移前的基线**：对着老实现写，先跑绿，确认它能捕捉现有行为；
 * ② **迁移后的回归网**：迁移过程中行为若漂移，这里立刻变红。
 *
 * ## 测什么
 *
 * - 基本渲染（文件名 / 选中态 / tablist 可访问名）
 * - 文件类型图标（按扩展名取 McIcon，且对读屏隐藏）
 * - 脏标记（金色圆点 + 可访问名）
 * - tab 内关闭按钮（含「不误触选中」）
 * - 中键关闭
 * - 右键菜单三项（关闭 / 关闭其他 / 关闭全部）+ 点外部关闭 + 视口内约束
 * - 空状态
 *
 * ## 为什么直接用真实 store 而不是 mock
 *
 * mod-store 是纯 zustand 单例，`closeTab` / `closeOtherTabs` / `closeAllTabs`
 * 的真正语义（关掉选中项后选中谁）全在 reducer 里。mock 掉 action 只能验证
 * 「回调被调用」，验证不了「关掉选中项后 selectedFile 落到谁」——而这恰恰是
 * 标签栏最容易出回归的地方。这里走 `useModStore.setState` 播种、断言真实
 * state 迁移（与 a11y.scan.test.tsx 同风格）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react';
import { useModStore } from '../store/mod-store.js';
import { getFileIconName } from '../lib/file-utils.js';
import { TabBar } from './TabBar.js';

const FILE_A = 'src/main/java/Mod.java';
const FILE_B = 'data/config.json';
const FILE_C = 'build.gradle';

/** 三个不同扩展名的文件：覆盖 java(terminal) / json(file-text) / gradle(terminal)。 */
const FILES = [
  { path: FILE_A, content: '' },
  { path: FILE_B, content: '' },
  { path: FILE_C, content: '' },
];

/** 播种 store。默认三个文件全开、选中 B。 */
function seed(overrides: Partial<ReturnType<typeof useModStore.getState>> = {}): void {
  useModStore.setState({
    files: [...FILES],
    openTabs: [FILE_A, FILE_B, FILE_C],
    selectedFile: FILE_B,
    splitFile: null,
    dirtyFiles: new Set<string>(),
    ...overrides,
  });
}

/** 当前的 openTabs（真实 reducer 结果，不是 spy）。 */
function openTabs(): string[] {
  return useModStore.getState().openTabs;
}

/** 全部 tab（按 DOM 顺序 = openTabs 顺序）。 */
function tabs(): HTMLElement[] {
  return Array.from(screen.getAllByRole('tab')) as HTMLElement[];
}

/** 按文件名找 tab（断言只用文件名，避免绑死可访问名计算细节）。 */
function tabByName(name: string): HTMLElement {
  const found = tabs().find((el) => (el.textContent ?? '').includes(name));
  if (!found) throw new Error(`未找到名为 ${name} 的 tab`);
  return found;
}

const tablist = () => screen.getByRole('tablist', { name: '打开的文件' });

/**
 * 派发中键/辅助键点击。
 *
 * testing-library 这版的 fireEvent 没有 auxClick 快捷方法，只能手动构造
 * `auxclick` 事件 —— React 的 `onAuxClick` 正是挂在这个原生事件上的。
 *
 * 返回 `dispatchEvent` 的结果：事件被 preventDefault 时为 false，
 * 于是「中键是否被拦掉」可以直接断言。
 */
function auxClick(el: Element, button: number): boolean {
  return fireEvent(el, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button }));
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TabBar 基本渲染', () => {
  it('渲染 tablist 且有可访问名「打开的文件」', () => {
    render(<TabBar />);
    expect(tablist()).toBeTruthy();
  });

  it('每个打开的文件渲染一个 tab', () => {
    render(<TabBar />);
    expect(tabs()).toHaveLength(3);
  });

  it('tab 只显示文件名，不显示完整路径', () => {
    render(<TabBar />);
    const el = tabByName('Mod.java');
    expect(el.textContent).toContain('Mod.java');
    // 路径分隔部分不该出现在标签文字里
    expect(el.textContent).not.toContain('src/main/java');
  });

  it('只渲染 openTabs 里的文件（files 里有但未打开的不出 tab）', () => {
    seed({ openTabs: [FILE_A] });
    render(<TabBar />);
    expect(tabs()).toHaveLength(1);
    expect(screen.queryByText(/config\.json/)).toBeNull();
  });

  it('选中项由 selectedFile 决定，标 aria-selected 与选中样式', () => {
    render(<TabBar />);
    const selected = tabByName('config.json');
    const idle = tabByName('Mod.java');
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.className).toContain('mc-tab-selected');
    expect(idle.getAttribute('aria-selected')).toBe('false');
    expect(idle.className).toContain('mc-tab-idle');
  });

  it('点 tab 切到对应文件', () => {
    render(<TabBar />);
    fireEvent.click(tabByName('Mod.java'));
    expect(useModStore.getState().selectedFile).toBe(FILE_A);
  });

  it('有 tab 但 selectedFile 为 null 时仍有 tab 高亮（不能一个都不亮）', () => {
    seed({ selectedFile: null });
    render(<TabBar />);
    const selected = tabs().filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });
});

describe('TabBar 文件类型图标', () => {
  it('按扩展名渲染对应 McIcon', () => {
    render(<TabBar />);
    // getFileIconName 是图标名的唯一事实来源，图标组件直接用它做 aria-label
    const icon = tabByName('config.json').querySelector('.mc-icon-svg');
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute('aria-label')).toBe(getFileIconName(FILE_B));
    expect(getFileIconName(FILE_B)).toBe('file-text');
  });

  it('java 文件用 terminal 图标', () => {
    render(<TabBar />);
    const icon = tabByName('Mod.java').querySelector('.mc-icon-svg');
    expect(icon?.getAttribute('aria-label')).toBe(getFileIconName(FILE_A));
    expect(getFileIconName(FILE_A)).toBe('terminal');
  });

  it('图标对读屏隐藏（文件名已表达内容，图标是纯装饰）', () => {
    render(<TabBar />);
    const icon = tabByName('Mod.java').querySelector('.mc-icon-svg');
    // 图标自身或某个祖先带 aria-hidden —— 两种实现都算达标
    const hidden =
      icon?.getAttribute('aria-hidden') === 'true' ||
      icon?.closest('[aria-hidden="true"]') !== null;
    expect(hidden).toBe(true);
  });
});

describe('TabBar 脏标记', () => {
  it('dirty 文件显示未保存圆点', () => {
    seed({ dirtyFiles: new Set([FILE_A]) });
    render(<TabBar />);
    expect(tabByName('Mod.java').textContent).toContain('●');
  });

  it('非 dirty 文件不显示圆点', () => {
    seed({ dirtyFiles: new Set([FILE_A]) });
    render(<TabBar />);
    expect(tabByName('config.json').textContent).not.toContain('●');
  });

  it('圆点带可访问名（纯视觉元素对读屏必须可感知）', () => {
    seed({ dirtyFiles: new Set([FILE_A]) });
    render(<TabBar />);
    const mark = tabByName('Mod.java').querySelector('[aria-label="未保存的更改"]');
    expect(mark).toBeTruthy();
  });

  it('无 dirty 文件时全部 tab 都没有圆点', () => {
    render(<TabBar />);
    for (const tab of tabs()) {
      expect(tab.textContent).not.toContain('●');
    }
  });
});

describe('TabBar tab 内关闭按钮', () => {
  it('每个 tab 都有一个「关闭 <文件名>」按钮', () => {
    render(<TabBar />);
    expect(screen.getByRole('button', { name: '关闭 Mod.java' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭 config.json' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭 build.gradle' })).toBeTruthy();
  });

  it('点关闭按钮关掉对应文件', () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 Mod.java' }));
    expect(openTabs()).toEqual([FILE_B, FILE_C]);
  });

  it('关掉非选中项不会改变当前选中文件（关闭按钮不误触选中）', () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 Mod.java' }));
    expect(openTabs()).toEqual([FILE_B, FILE_C]);
    expect(useModStore.getState().selectedFile).toBe(FILE_B);
  });

  it('关掉选中项后选中落到相邻 tab（真实 reducer 语义）', () => {
    // 选中 B（索引 1），关掉它 → 应落到同索引处的 C
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 config.json' }));
    expect(openTabs()).toEqual([FILE_A, FILE_C]);
    expect(useModStore.getState().selectedFile).toBe(FILE_C);
  });

  it('关掉最后一个 tab 后选中文件为 null', () => {
    seed({ openTabs: [FILE_B], selectedFile: FILE_B });
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 config.json' }));
    expect(openTabs()).toEqual([]);
    expect(useModStore.getState().selectedFile).toBeNull();
  });
});

describe('TabBar 中键关闭', () => {
  it('中键点击关掉对应文件', () => {
    render(<TabBar />);
    auxClick(tabByName('Mod.java'), 1);
    expect(openTabs()).toEqual([FILE_B, FILE_C]);
  });

  it('中键关闭同样不改变选中文件', () => {
    render(<TabBar />);
    auxClick(tabByName('Mod.java'), 1);
    expect(useModStore.getState().selectedFile).toBe(FILE_B);
  });

  it('中键关闭选中项时按相邻规则迁移选中', () => {
    render(<TabBar />);
    auxClick(tabByName('config.json'), 1);
    expect(openTabs()).toEqual([FILE_A, FILE_C]);
    expect(useModStore.getState().selectedFile).toBe(FILE_C);
  });

  it('中键被 preventDefault（X11 中键=粘贴主选区，标签栏上是纯噪音）', () => {
    render(<TabBar />);
    expect(auxClick(tabByName('Mod.java'), 1)).toBe(false);
  });

  it('左键不触发关闭（只走选中）', () => {
    render(<TabBar />);
    auxClick(tabByName('Mod.java'), 0);
    expect(openTabs()).toHaveLength(3);
  });
});

describe('TabBar 右键菜单', () => {
  /** 右键点开某个 tab 的菜单。 */
  function openMenuOn(name: string): void {
    fireEvent.contextMenu(tabByName(name));
  }

  it('右键弹出菜单，含关闭 / 关闭其他 / 关闭全部三项', () => {
    render(<TabBar />);
    openMenuOn('Mod.java');
    expect(screen.getByRole('button', { name: /关闭$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭其他' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭全部' })).toBeTruthy();
  });

  it('菜单在右键前不存在', () => {
    render(<TabBar />);
    expect(screen.queryByRole('button', { name: '关闭全部' })).toBeNull();
  });

  it('「关闭」只关掉右键点中的那个文件', () => {
    render(<TabBar />);
    openMenuOn('Mod.java');
    fireEvent.click(screen.getByRole('button', { name: /关闭$/ }));
    expect(openTabs()).toEqual([FILE_B, FILE_C]);
  });

  it('「关闭其他」只保留右键点中的那个文件，并选中它', () => {
    render(<TabBar />);
    openMenuOn('Mod.java');
    fireEvent.click(screen.getByRole('button', { name: '关闭其他' }));
    expect(openTabs()).toEqual([FILE_A]);
    expect(useModStore.getState().selectedFile).toBe(FILE_A);
  });

  it('「关闭全部」清空所有 tab 并把选中置空', () => {
    render(<TabBar />);
    openMenuOn('Mod.java');
    fireEvent.click(screen.getByRole('button', { name: '关闭全部' }));
    expect(openTabs()).toEqual([]);
    expect(useModStore.getState().selectedFile).toBeNull();
  });

  it('菜单项点完后菜单消失', () => {
    render(<TabBar />);
    openMenuOn('Mod.java');
    fireEvent.click(screen.getByRole('button', { name: /关闭$/ }));
    expect(screen.queryByRole('button', { name: '关闭全部' })).toBeNull();
  });

  it('点击菜单外部关闭菜单（不误伤 tab 状态）', () => {
    render(<TabBar />);
    openMenuOn('Mod.java');
    fireEvent.click(document.body);
    expect(screen.queryByRole('button', { name: '关闭全部' })).toBeNull();
    expect(openTabs()).toEqual([FILE_A, FILE_B, FILE_C]);
  });

  it('右键被 preventDefault（否则会同时弹浏览器原生菜单）', () => {
    render(<TabBar />);
    const notPrevented = fireEvent.contextMenu(tabByName('Mod.java'));
    expect(notPrevented).toBe(false);
  });

  it('菜单被约束在视口内（贴右下角时不会溢出屏幕）', () => {
    render(<TabBar />);
    fireEvent.contextMenu(tabByName('Mod.java'), {
      clientX: window.innerWidth - 5,
      clientY: window.innerHeight - 5,
    });
    const menu = screen.getByRole('button', { name: '关闭全部' }).parentElement as HTMLElement;
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight);
  });

  /**
   * 迁移前**就是红的**（老实现把菜单渲染在 `role="tablist"` 内部）。
   *
   * 这是一条真实存在的 a11y 缺陷，不是测试写错：`aria-required-children`
   * 要求 tablist 的子节点只能是 tab/role=tab，塞 3 个 button 会违规 ——
   * 现有 a11y 扫描之所以没报，是因为两条用例都没真正打开过右键菜单。
   * 迁移到 ui `Tabs` 后菜单会挪到 tablist 外侧，这条断言随之转绿。
   *
   * 保留它在基线里是刻意的：让「迁移到底修没修掉这个缺陷」有个客观判据，
   * 而不是靠人肉读 diff。
   */
  it('菜单在 tablist 之外（不能是 tablist 的子节点，否则违反 aria-required-children）', () => {
    render(<TabBar />);
    openMenuOn('Mod.java');
    const list = tablist();
    expect(list.contains(screen.getByRole('button', { name: '关闭全部' }))).toBe(false);
  });
});

describe('TabBar 空状态', () => {
  it('没有打开的文件时显示空态文案', () => {
    seed({ openTabs: [], selectedFile: null });
    render(<TabBar />);
    expect(screen.getByText('暂无打开的文件')).toBeTruthy();
  });

  it('空状态不渲染任何 tab', () => {
    seed({ openTabs: [], selectedFile: null });
    render(<TabBar />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('空状态不渲染关闭按钮', () => {
    seed({ openTabs: [], selectedFile: null });
    render(<TabBar />);
    expect(screen.queryByRole('button', { name: /^关闭 / })).toBeNull();
  });

  it('从空态开一个文件后切到正常标签栏', () => {
    seed({ openTabs: [], selectedFile: null });
    render(<TabBar />);
    act(() => {
      useModStore.getState().selectFile(FILE_A);
    });
    expect(screen.queryByText('暂无打开的文件')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('关掉最后一个文件后回到空态', () => {
    seed({ openTabs: [FILE_B], selectedFile: FILE_B });
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 config.json' }));
    expect(screen.getByText('暂无打开的文件')).toBeTruthy();
  });
});

describe('TabBar 键盘可达性', () => {
  it('tablist 内至少有一个可聚焦的 tab（roving tabindex 或全可聚焦都不算不可达）', () => {
    render(<TabBar />);
    const focusable = tabs().filter((el) => el.getAttribute('tabindex') !== '-1');
    expect(focusable.length).toBeGreaterThanOrEqual(1);
  });

  it('当前选中文件对应的 tab 是 aria-selected', () => {
    render(<TabBar />);
    const selected = tabs().filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent ?? '').toContain('config.json');
  });

  it('关闭按钮在 tab 内但可访问名独立（读屏念得到「关闭 X」）', () => {
    render(<TabBar />);
    const btn = screen.getByRole('button', { name: '关闭 Mod.java' });
    expect(within(tabByName('Mod.java')).getByRole('button', { name: '关闭 Mod.java' })).toBe(btn);
  });
});
