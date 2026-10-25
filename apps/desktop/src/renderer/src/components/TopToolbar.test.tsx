// @vitest-environment jsdom
/**
 * TopToolbar 行为测试 —— 聚焦「构建」入口（阶段 0A）
 *
 * ## 为什么这个入口需要单独测
 *
 * `BuildPanel` 注册为 `build` 面板后仍**不可达**：`activeLeftPanel` 的写入点只有三处
 * —— 初始值（域默认面板）、`ActivityBar.onChange`（只喂 core 组）、`TopToolbar`。
 * 也就是说，域面板在阶段 4 的 `DomainTabs` 落地前，**唯一的入口就是这个按钮**。
 * 按钮一旦被误删或误改成常驻可见（其他域里点会被纠偏 effect 弹回 = 假入口），
 * 构建能力就再次静默消失，且不会有任何报错 —— 与它此前的死法一模一样。
 *
 * 因此这里锁定两条契约：
 * 1. `canOpenBuild` 为假时**不得**渲染（否则在 launcher/server 域里是假入口）
 * 2. `canOpenBuild` 为真且给了 `onOpenBuild` 时，点击必须回调
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TopToolbar } from './TopToolbar.js';

const LABEL_MAP: Record<string, string> = {
  'activityBar.build': '构建与部署',
  'activityBar.settings': '设置',
  'topToolbar.build': '构建',
  'topToolbar.projectManagement': '项目管理',
  'topToolbar.saveProject': '保存项目',
  'topToolbar.existingProjects': '已有项目',
  'topToolbar.apiKeyConfigured': 'API Key 已配置',
  'topToolbar.apiKeyNotConfigured': '未配置 API Key，点击设置',
  'topToolbar.loaderNotApplicable': '当前内容类型不使用 loader',
};

vi.mock('../hooks/useTranslation.js', () => ({
  useTranslation: () => ({
    t: (key: string) => LABEL_MAP[key] ?? key,
    tCommon: (key: string) => key,
    locale: 'zh',
  }),
}));

/** McIcon 只渲染一个带 data-icon 的占位，省掉 SVG 资源依赖 */
vi.mock('../assets/mc-ui/McIcon.js', () => ({
  McIcon: ({ name, size }: { name: string; size?: number }) => (
    <span data-icon={name} data-size={size} />
  ),
}));

vi.mock('./LanguageSwitcher.js', () => ({
  LanguageSwitcher: () => <span data-testid="lang-switcher" />,
}));

/** mod-store 被调用两次（全局设置选择器 + 保存所需字段），统一用假 state 喂 */
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

beforeEach(() => {
  cleanup();
});

describe('TopToolbar · 构建入口', () => {
  it('canOpenBuild 为真时渲染「构建」按钮', () => {
    render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild onOpenBuild={vi.fn()} />);

    expect(screen.getByRole('button', { name: /构建/ })).toBeTruthy();
  });

  it('点击「构建」触发 onOpenBuild', () => {
    const onOpenBuild = vi.fn();
    render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild onOpenBuild={onOpenBuild} />);

    fireEvent.click(screen.getByRole('button', { name: /构建/ }));

    expect(onOpenBuild).toHaveBeenCalledTimes(1);
  });

  it('非 dev 域（canOpenBuild 为假）时不渲染构建按钮 —— 否则是会被弹回的假入口', () => {
    render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild={false} onOpenBuild={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /构建/ })).toBeNull();
  });

  it('未传 onOpenBuild 时不渲染按钮（避免无动作的死按钮）', () => {
    render(<TopToolbar onOpenSettings={vi.fn()} canOpenBuild />);

    expect(screen.queryByRole('button', { name: /构建/ })).toBeNull();
  });

  it('默认不展示构建按钮 —— props 省略等于非 dev 域', () => {
    render(<TopToolbar onOpenSettings={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /构建/ })).toBeNull();
  });
});
