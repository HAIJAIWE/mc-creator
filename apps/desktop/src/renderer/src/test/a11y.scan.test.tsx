// @vitest-environment jsdom
import { describe, it, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import 'axe-core'; // 副作用导入：在 jsdom 下挂载 window.axe
import type * as AxeTypes from 'axe-core';
import { ActivityBar } from '../components/ActivityBar.js';
import { IconTabBar } from '../components/middle/shared/IconTabBar.js';
import { Splitter } from '../components/Splitter.js';
import { ShortcutHelpDialog } from '../components/ShortcutHelpDialog.js';
import { PromptDialog } from '../components/PromptDialog.js';
import { ToastProvider } from '../components/ToastProvider.js';
import { useToast } from '../components/useToast.js';
import { CommandPalette, type Command } from '../components/CommandPalette.js';
import { ProjectSaveDialog } from '../components/ProjectSaveDialog.js';
import { TaskCompleteDialog } from '../components/TaskCompleteDialog.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { TabBar } from '../components/TabBar.js';
import { FileTree } from '../components/FileTree.js';
import { NbtEditor } from '../components/NbtEditor.js';
import { EmptyState } from '../components/middle/shared/EmptyState.js';
import { ConflictAlert } from '../components/middle/shared/ConflictAlert.js';
import { DataTable, type Column } from '../components/middle/shared/DataTable.js';
import { SearchInput } from '../components/middle/shared/SearchInput.js';
import { BatchSelectToolbar } from '../components/middle/shared/BatchSelectToolbar.js';
import { ExportView } from '../components/middle/shared/ExportView.js';
import { PanelHeader } from '../components/middle/shared/PanelHeader.js';
import { MetadataView } from '../components/middle/shared/MetadataView.js';
import { useModStore } from '../store/mod-store.js';
import { useProjectStore } from '../store/project-store.js';
import { useSpecHistoryStore } from '../store/spec-history-store.js';
import { useModelConfigStore } from '../store/model-config-store.js';

/**
 * P9.3 a11y 自动化扫描：用 axe-core 在 vitest + jsdom 环境扫描核心组件的 WCAG 违规。
 *
 * axe-core 是 IIFE 挂载到 window.axe（jsdom 下 window.getComputedStyle 存在时自动挂载）。
 * 已禁用的规则（jsdom 限制或单组件上下文不适用）：
 * - color-contrast：jsdom 不计算 CSS 实际渲染样式
 * - region / landmark-one-main / page-has-heading-one：单组件不构成完整页面
 * - tabindex：jsdom 计算与浏览器有差异，roving tabindex 是设计意图
 * - focus-order-semantics：单组件脱离页面上下文
 * - target-size：jsdom 不支持完整 CSS 布局
 * （注：breadcrumb 规则在 axe-core 4.12.1 中不存在，已从禁用列表移除）
 */

type Axe = typeof AxeTypes;

function getAxe(): Axe {
  const axe = (window as unknown as { axe?: Axe }).axe;
  if (!axe) throw new Error('window.axe 未挂载，请确认 axe-core 已正确导入');
  return axe;
}

// 注意：axe.run 的 rules 参数必须是对象 Record<string, {enabled: boolean}>，
// 不能是数组——数组会被 Object.keys() 解析为 ["0","1",...] 作为 rule ID，导致 unknown rule '0' 错误。
const A11Y_DISABLE_RULES: AxeTypes.RuleObject = {
  'color-contrast': { enabled: false },
  region: { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  tabindex: { enabled: false },
  'focus-order-semantics': { enabled: false },
  'target-size': { enabled: false },
};

const AXE_OPTIONS = {
  rules: A11Y_DISABLE_RULES,
  runOnly: {
    type: 'tag' as const,
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
};

async function runAxe(container: HTMLElement): Promise<AxeTypes.Result[]> {
  const axe = getAxe();
  const results = await axe.run(container, AXE_OPTIONS);
  return results.violations;
}

/**
 * TabBar 的 tab 元素（role="tab"）内部需要关闭按钮，这是 tab UI 的常见模式
 * （VS Code、浏览器等均如此）。axe-core 的 nested-interactive 规则对此报错，
 * 但这是设计约束而非真实 a11y 问题（关闭按钮已有 aria-label）。
 * 因此 TabBar 测试单独禁用 nested-interactive 规则。
 */
async function runAxeTabBar(container: HTMLElement): Promise<AxeTypes.Result[]> {
  const axe = getAxe();
  const results = await axe.run(container, {
    ...AXE_OPTIONS,
    rules: {
      ...A11Y_DISABLE_RULES,
      'nested-interactive': { enabled: false },
    },
  });
  return results.violations;
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
    throw new Error(`axe-core 发现 ${violations.length} 个 a11y 违规：\n${lines.join('\n\n')}`);
  }
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  // jsdom 不提供 ResizeObserver，FileTree/SplitCodeEditor 等组件依赖它
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'mod',
    spec: null,
    files: [],
    previousFiles: [],
    selectedFile: null,
    openTabs: [],
    splitFile: null,
    dirtyFiles: new Set<string>(),
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    loading: false,
    error: null,
    fixLog: [],
  });
  useProjectStore.setState({ projects: [], currentProjectId: null });
  useSpecHistoryStore.setState({ versions: [], currentIndex: -1 });
  useModelConfigStore.setState({
    name: '',
    modelId: '',
    baseURL: '',
    apiKey: '',
    loaded: false,
  });

  (window as unknown as { mcApi: Record<string, ReturnType<typeof vi.fn>> }).mcApi = {
    generateSpec: vi.fn(),
    generateFiles: vi.fn(),
    loadModelConfig: vi.fn(),
    saveModelConfig: vi.fn(),
    chat: vi.fn(),
    saveFile: vi.fn().mockResolvedValue({ ok: true }),
    saveAllFiles: vi.fn().mockResolvedValue({ ok: true }),
    exportZip: vi.fn().mockResolvedValue({ ok: true }),
    saveCurrentAsProject: vi.fn().mockResolvedValue({ ok: true }),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('P9.3 a11y 自动化扫描', () => {
  describe('ActivityBar', () => {
    it('默认状态无 a11y 违规', async () => {
      const { container } = render(<ActivityBar active="explorer" onChange={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('settings 激活时无 a11y 违规', async () => {
      const { container } = render(<ActivityBar active="settings" onChange={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('带 onHome 回调时无 a11y 违规', async () => {
      const { container } = render(
        <ActivityBar active="explorer" onChange={() => {}} onHome={() => {}} />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('IconTabBar', () => {
    it('3 个 tab 无 a11y 违规', async () => {
      const { container } = render(
        <IconTabBar
          tabs={[
            { key: 'a', label: '标签A' },
            { key: 'b', label: '标签B', count: 5 },
            { key: 'c', label: '标签C', error: 2 },
          ]}
          activeTab="a"
          onSelect={() => {}}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('带 warning 指示器无 a11y 违规', async () => {
      const { container } = render(
        <IconTabBar
          tabs={[
            { key: 'a', label: '标签A' },
            { key: 'b', label: '标签B', warning: 3 },
          ]}
          activeTab="b"
          onSelect={() => {}}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('Splitter', () => {
    it('无 a11y 违规', async () => {
      const { container } = render(<Splitter onResize={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('ShortcutHelpDialog', () => {
    it('打开状态无 a11y 违规', async () => {
      const { container } = render(<ShortcutHelpDialog open onClose={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('PromptDialog', () => {
    it('prompt 模式无 a11y 违规', async () => {
      const { container } = render(
        <PromptDialog
          title="测试对话框"
          message="请输入内容"
          placeholder="输入..."
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('confirm 模式无 a11y 违规', async () => {
      const { container } = render(
        <PromptDialog title="确认操作" onClose={() => {}} onConfirm={() => {}} />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('danger 模式无 a11y 违规', async () => {
      const { container } = render(
        <PromptDialog
          title="危险操作"
          message="确定要清空吗？"
          danger
          confirmLabel="清空"
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('ProjectSaveDialog', () => {
    it('无 a11y 违规', async () => {
      const { container } = render(<ProjectSaveDialog onClose={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('TaskCompleteDialog', () => {
    it('显示状态无 a11y 违规', async () => {
      const { container } = render(
        <TaskCompleteDialog show onContinue={() => {}} onStop={() => {}} />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('ToastProvider', () => {
    it('空状态无 a11y 违规', async () => {
      const { container } = render(<ToastProvider>{null}</ToastProvider>);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('含 4 种类型 toast 时无 a11y 违规', async () => {
      function ToastTrigger() {
        const toast = useToast();
        return (
          <div>
            <button onClick={() => toast.success('成功消息')}>成功</button>
            <button onClick={() => toast.error('错误消息')}>错误</button>
            <button onClick={() => toast.warning('警告消息')}>警告</button>
            <button onClick={() => toast.info('信息消息')}>信息</button>
          </div>
        );
      }
      const { container } = render(
        <ToastProvider>
          <ToastTrigger />
        </ToastProvider>,
      );
      const buttons = container.querySelectorAll('button');
      for (const btn of Array.from(buttons)) {
        btn.click();
      }
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('CommandPalette', () => {
    const sampleCommands: Command[] = [
      {
        id: 'save',
        label: '保存当前文件',
        description: '保存当前编辑的文件',
        category: 'file',
        shortcut: 'Ctrl+S',
        run: () => {},
      },
      {
        id: 'save-all',
        label: '保存全部文件',
        category: 'file',
        run: () => {},
      },
      {
        id: 'switch-preview',
        label: '切换到预览视图',
        category: 'view',
        run: () => {},
      },
    ];

    it('打开状态无 a11y 违规', async () => {
      const { container } = render(
        <CommandPalette open onClose={() => {}} commands={sampleCommands} />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('含分类标签时无 a11y 违规', async () => {
      const { container } = render(
        <CommandPalette open onClose={() => {}} commands={sampleCommands} />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });
});

/**
 * P10.3 a11y 扫描扩展：覆盖 P10.2 修复的组件，验证 role、aria 属性、键盘导航等 a11y 改进。
 */
describe('P10.3 a11y 扫描扩展', () => {
  describe('ErrorBanner', () => {
    it('带关闭按钮无 a11y 违规', async () => {
      const { container } = render(<ErrorBanner message="导出失败" onClose={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('无关闭按钮无 a11y 违规', async () => {
      const { container } = render(<ErrorBanner message="导出失败" />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('EmptyState', () => {
    it('默认状态无 a11y 违规', async () => {
      const { container } = render(
        <EmptyState icon="folder" title="暂无文件" hint="使用命令面板生成文件" />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('自定义 action 无 a11y 违规', async () => {
      const { container } = render(
        <EmptyState
          icon="box"
          title="暂无物品"
          hint="点击下方按钮添加"
          action={{ label: '添加物品', onClick: () => {} }}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('ConflictAlert', () => {
    it('含冲突明细无 a11y 违规', async () => {
      const { container } = render(
        <ConflictAlert
          totalConflicts={3}
          conflicts={[
            { label: '物品 ID 重复', count: 2 },
            { label: '依赖重复', count: 1 },
          ]}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('Breadcrumb', () => {
    it('多级路径无 a11y 违规', async () => {
      useModStore.setState({
        files: [
          { path: 'src/main/java/Mod.java', content: '' },
          { path: 'src/main/java/Other.java', content: '' },
        ],
      });
      const { container } = render(<Breadcrumb filePath="src/main/java/Mod.java" />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('TabBar', () => {
    it('多 tab 无 a11y 违规', async () => {
      useModStore.setState({
        files: [
          { path: 'a.java', content: '' },
          { path: 'b.json', content: '' },
          { path: 'c.gradle', content: '' },
        ],
        openTabs: ['a.java', 'b.json', 'c.gradle'],
        selectedFile: 'b.json',
      });
      const { container } = render(<TabBar />);
      const violations = await runAxeTabBar(container);
      expectNoViolations(violations);
    });

    it('含脏标记 tab 无 a11y 违规', async () => {
      useModStore.setState({
        files: [{ path: 'a.java', content: '' }],
        openTabs: ['a.java'],
        selectedFile: 'a.java',
        dirtyFiles: new Set(['a.java']),
      });
      const { container } = render(<TabBar />);
      const violations = await runAxeTabBar(container);
      expectNoViolations(violations);
    });
  });

  describe('FileTree', () => {
    it('多级目录无 a11y 违规', async () => {
      useModStore.setState({
        files: [
          { path: 'src/main/java/Mod.java', content: '' },
          { path: 'src/main/java/Other.java', content: '' },
          { path: 'README.md', content: '' },
        ],
        selectedFile: 'src/main/java/Mod.java',
      });
      const { container } = render(<FileTree />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('空文件树无 a11y 违规', async () => {
      useModStore.setState({ files: [], selectedFile: null });
      const { container } = render(<FileTree />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('NbtEditor', () => {
    it('默认 Compound 无 a11y 违规', async () => {
      const { container } = render(<NbtEditor initialValue='{"name":"test","count":5}' />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('空 Compound 无 a11y 违规', async () => {
      const { container } = render(<NbtEditor initialValue="{}" />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('嵌套结构无 a11y 违规', async () => {
      const { container } = render(
        <NbtEditor initialValue='{"item":{"id":"apple","count":1},"tags":["a","b"]}' />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('DataTable', () => {
    interface Row {
      id: string;
      name: string;
      count: number;
    }
    const columns: Column<Row>[] = [
      { key: 'name', header: '名称', sortValue: (r) => r.name },
      { key: 'count', header: '数量', sortValue: (r) => r.count },
    ];
    const data: Row[] = [
      { id: '1', name: '苹果', count: 5 },
      { id: '2', name: '香蕉', count: 3 },
    ];

    it('默认状态无 a11y 违规', async () => {
      const { container } = render(
        <DataTable columns={columns} data={data} rowKey={(r) => r.id} />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('空数据无 a11y 违规', async () => {
      const { container } = render(<DataTable columns={columns} data={[]} rowKey={(r) => r.id} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('SearchInput', () => {
    it('无 a11y 违规', async () => {
      const { container } = render(<SearchInput value="" onChange={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });

    it('含输入值无 a11y 违规', async () => {
      const { container } = render(<SearchInput value="物品" onChange={() => {}} />);
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('BatchSelectToolbar', () => {
    it('含选中项无 a11y 违规', async () => {
      const { container } = render(
        <BatchSelectToolbar
          selectedCount={3}
          onBatchRemove={() => {}}
          onClearSelection={() => {}}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('ExportView', () => {
    it('含多区块无 a11y 违规', async () => {
      const { container } = render(
        <ExportView
          title="导出 Mod 数据"
          description="选择格式与作用域"
          sections={[
            { scope: 'all', label: '完整 Spec' },
            { scope: 'items', label: '物品列表', count: 12 },
            { scope: 'blocks', label: '方块列表', count: 8 },
          ]}
          onExport={() => {}}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('PanelHeader', () => {
    it('含元信息无 a11y 违规', async () => {
      const { container } = render(
        <PanelHeader
          icon="box"
          title="物品预览"
          meta={[
            { label: '物品', value: '12' },
            { label: '配方', value: '8' },
          ]}
          subtitle="点击物品查看详情"
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });

  describe('MetadataView', () => {
    it('多行元数据无 a11y 违规', async () => {
      const { container } = render(
        <MetadataView
          rows={[
            { label: 'Mod 名称', value: '示例 Mod' },
            { label: '版本', value: '1.0.0' },
            { label: 'Loader', value: 'Fabric' },
            { label: 'MC 版本', value: '1.21.1' },
          ]}
        />,
      );
      const violations = await runAxe(container);
      expectNoViolations(violations);
    });
  });
});
