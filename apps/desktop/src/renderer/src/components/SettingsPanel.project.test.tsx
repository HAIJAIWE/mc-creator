/**
 * 「内容类型 / 加载器 / MC 版本」从 TopToolbar 迁到 SettingsPanel「项目」分组的回归网。
 *
 * ## 为什么这组测试存在
 *
 * 这三个字段原先是 TopToolbar 中间的三个 `<select>`，是项目创建之后**唯一**的编辑入口
 * （`ProjectCreateDialog` 用局部 state 只在新建时提交；`SettingsPanel` 此前只读不写）。
 * 按 IDE 惯例（VS Code 官方列出的六个区域里没有「工具栏」，IntelliJ 主工具栏也只有动作按钮）
 * 把它们从顶部挪走。
 *
 * 挪走这件事本身没有测试能自动发现「功能丢了」—— 所以这里锁死迁移后的三条硬约束：
 *  1. 编辑入口确实存在（三个 select 都在，且都能改 store）；
 *  2. 可访问名称不靠 aria-label 糊（用 `<label htmlFor>` 真实关联）；
 *  3. 「非 mod 类型置灰 loader」这条领域规则跟着搬过来了，没在迁移中丢掉。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel.js';

const state = {
  generatorType: 'mod' as string,
  loader: 'fabric' as string,
  mcVersion: '1.21.11' as string,
  loading: false,
  setGeneratorType: vi.fn(),
  setLoader: vi.fn(),
  setMcVersion: vi.fn(),
};

vi.mock('../store/mod-store.js', () => ({
  useModStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.generatorType = 'mod';
  state.loader = 'fabric';
  state.mcVersion = '1.21.11';
  state.loading = false;

  // jsdom 没有 matchMedia；SettingsPanel 挂载时会读系统配色（themes.ts getEffectiveMode）
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // 「依赖预热」分组在挂载时就订阅进度通道，与「项目」分组无关但同样会跑 effect。
  // 不给桩的话 render 阶段 TypeError（window.mcApi undefined），全部用例一起假红。
  (window as unknown as { mcApi: unknown }).mcApi = {
    onWarmDepsProgress: vi.fn(() => vi.fn()),
    warmDeps: vi.fn(),
    cancelWarmDeps: vi.fn(),
    buildWithFix: vi.fn(),
    checkJava: vi.fn(),
    listModelProfiles: vi.fn(async () => ({ profiles: [] as { id: string }[], activeId: null })),
    saveModelProfile: vi.fn(async () => ({ ok: true })),
    deleteModelProfile: vi.fn(async () => ({ ok: true })),
    testModelProfile: vi.fn(async () => ({ ok: true, message: 'ok' })),
    saveCurseForgeKey: vi.fn(async () => ({ ok: true })),
    loadCurseForgeConfig: vi.fn(async () => ({ apiKey: '', hasKey: false })),
    loadSourcePreference: vi.fn(async () => ({ preferOfficial: false })),
  };
});

describe('SettingsPanel · 项目分组（项目配置的唯一编辑入口）', () => {
  it('默认落在「项目」tab —— 顶部已无入口，这里必须是第一个到达的地方', () => {
    render(<SettingsPanel />);
    // 「项目」是新建的 tab，若不是默认，迁走顶部下拉框后用户会找不到修改入口
    expect(screen.getByRole('combobox', { name: /内容类型|Content type/i })).toBeTruthy();
  });

  it('三个下拉框齐全：内容类型 / 加载器 / MC 版本', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('combobox', { name: /内容类型|Content type/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /加载器|Loader/i })).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: /Minecraft 版本|MC version|MC Version/i }),
    ).toBeTruthy();
  });

  it('可访问名称来自真实 <label htmlFor>，不是 aria-label 糊上去的', () => {
    const { container } = render(<SettingsPanel />);
    const labelled = container.querySelectorAll('label[for]');
    const ids = Array.from(labelled).map((l) => l.getAttribute('for'));
    for (const id of ids) {
      expect(document.getElementById(id!), `label[for="${id}"] 必须指向真实控件`).toBeTruthy();
    }
    // 三个 select 都应被某个 label 覆盖
    const selects = Array.from(container.querySelectorAll('select')).map((s) => s.id);
    expect(selects.filter((id) => ids.includes(id))).toHaveLength(3);
  });

  it('改内容类型 → 调用 setGeneratorType', () => {
    render(<SettingsPanel />);
    fireEvent.change(screen.getByRole('combobox', { name: /内容类型|Content type/i }), {
      target: { value: 'datapack' },
    });
    expect(state.setGeneratorType).toHaveBeenCalledWith('datapack');
  });

  it('改加载器 → 调用 setLoader', () => {
    render(<SettingsPanel />);
    fireEvent.change(screen.getByRole('combobox', { name: /加载器|Loader/i }), {
      target: { value: 'neoforge' },
    });
    expect(state.setLoader).toHaveBeenCalledWith('neoforge');
  });

  it('改 MC 版本 → 调用 setMcVersion', () => {
    render(<SettingsPanel />);
    fireEvent.change(
      screen.getByRole('combobox', { name: /Minecraft 版本|MC version|MC Version/i }),
      { target: { value: '1.20.1' } },
    );
    expect(state.setMcVersion).toHaveBeenCalledWith('1.20.1');
  });

  it('非 mod 类型时加载器置灰（领域规则 needsLoader 跟着迁移过来了）', () => {
    state.generatorType = 'datapack';
    render(<SettingsPanel />);
    // datapack 的产物不由 loader 决定 —— 原 TopToolbar 就是这么禁用的，
    // 迁移时最容易悄悄丢掉这条规则
    expect(screen.getByRole('combobox', { name: /加载器|Loader/i })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('mod 类型时加载器可用', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('combobox', { name: /加载器|Loader/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  /**
   * 加载器开放范围（用户拍板：与启动器一致，只留 Fabric + NeoForge）。
   *
   * 这组断言的存在理由是一次真实事故：开放范围原先在两处 UI 各手写一份，
   * 结果都写歪了 —— `ProjectCreateDialog` 给了 `vanilla`（生成器没有它的
   * adapter，选完直接抛错），`SettingsPanel` 又漏了有可用 adapter 的 `forge`。
   * 现在两边都从 `SUPPORTED_GENERATOR_LOADERS` 取，这里从**渲染出来的 DOM**
   * 上再钉一遍，防止有人哪天又手写回去。
   */
  it('只开放 Fabric + NeoForge，没有 vanilla（vanilla 会让生成器抛错）', () => {
    render(<SettingsPanel />);
    const select = screen.getByRole('combobox', { name: /加载器|Loader/i });
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toEqual(['fabric', 'neoforge']);
    expect(values).not.toContain('vanilla');
  });

  it('历史项目的旧加载器仍然可见并被标为禁用 —— 不能悄悄重置掉', () => {
    state.loader = 'quilt';
    render(<SettingsPanel />);
    const select = screen.getByRole('combobox', {
      name: /加载器|Loader/i,
    }) as HTMLSelectElement;

    // 值必须仍是 quilt：静默重置成 fabric 会**改变生成产物**（不同 adapter
    // 产出另一套源码），这种事只能由用户自己决定。
    expect(select.value).toBe('quilt');

    // 且必须作为可选项列出来。若只过滤掉，select 的 value 落在列表外，
    // 浏览器显示空白 —— 用户既看不出项目用的什么，也无从改回来。
    const legacy = select.querySelector('option[value="quilt"]');
    expect(legacy, '旧值要显式列为禁用项，否则下拉会显示空白').toBeTruthy();
    expect(legacy).toHaveProperty('disabled', true);
    expect(legacy?.textContent).toContain('Quilt');
  });

  it('开放中的加载器不会同时冒出一个「已不在支持列表」的重复项', () => {
    render(<SettingsPanel />);
    const select = screen.getByRole('combobox', { name: /加载器|Loader/i });
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
