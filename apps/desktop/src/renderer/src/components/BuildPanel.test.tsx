// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BuildPanel } from './BuildPanel.js';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';

vi.mock('../store/mod-store.js', () => ({
  useModStore: vi.fn(),
}));

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    checkJava: vi
      .fn()
      .mockResolvedValue({ ok: true, java: 21, need: 21, message: '', downloadUrl: '' }),
    prepareBuildDir: vi.fn().mockResolvedValue({ projectPath: '/tmp/test', estimatedSteps: 5 }),
    buildWithFix: vi
      .fn()
      .mockResolvedValue({ success: true, log: '', jarPath: 'test.jar', fixLog: [], attempts: 1 }),
    buildStream: vi.fn(),
    abortBuild: vi.fn().mockResolvedValue({ ok: true, killed: 1 }),
    fixSuggest: vi.fn(),
    locateMc: vi.fn(),
    chooseMcDir: vi.fn(),
    installMod: vi.fn(),
    launchMc: vi.fn(),
  },
}));

vi.mock('lucide-react', () => ({
  Wrench: () => <span data-testid="wrench" />,
  X: () => <span data-testid="x" />,
  Loader2: () => <span data-testid="loader2" />,
}));

const createMockStore = (overrides: Partial<ReturnType<typeof useModStore>> = {}) => ({
  files: [{ path: 'test.java', content: 'test' }],
  buildLog: '',
  buildSuccess: null,
  jarPath: null,
  loading: false,
  fixLog: [],
  buildStats: null,
  mcVersion: '1.21.11',
  setBuildResult: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  error: null,
  setFixLog: vi.fn(),
  setBuildStats: vi.fn(),
  ...overrides,
});

describe('BuildPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders build buttons when not loading', () => {
    const mockStore = createMockStore();
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    expect(screen.getByText('编译 .jar')).toBeTruthy();
    expect(screen.getByText('流式编译')).toBeTruthy();
    expect(screen.queryByText('清空日志')).toBeFalsy();
  });

  it('shows cancel button when loading', () => {
    const mockStore = createMockStore({ loading: true });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    expect(screen.getByText('取消')).toBeTruthy();
  });

  it('displays build stats when available', () => {
    const mockStore = createMockStore({
      buildStats: {
        total: 10,
        cached: 7,
        regenerated: 3,
        filesTotal: 50,
        filesUnchanged: 35,
      },
    });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    expect(screen.getByText(/缓存命中 7\/10 类别/)).toBeTruthy();
    expect(screen.getByText(/重编 3/)).toBeTruthy();
  });

  it('shows JDK download link when precheck fails', async () => {
    vi.mocked(ipcClient.checkJava).mockResolvedValueOnce({
      ok: false,
      message: 'JDK 版本过低',
      downloadUrl: 'https://adoptium.net/temurin/releases/',
      java: 17,
      need: 21,
    });

    const mockStore = createMockStore({ mcVersion: '1.21.11' });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    const buildBtn = screen.getByText('编译 .jar');
    fireEvent.click(buildBtn);

    await waitFor(() => {
      expect(screen.getByText('JDK 下载：')).toBeTruthy();
      expect(screen.getByText('https://adoptium.net/temurin/releases/')).toBeTruthy();
    });
  });

  it('shows AI fix suggestion panel when build fails', async () => {
    const mockStore = createMockStore({
      buildSuccess: false,
      buildLog: 'error: test error',
    });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);

    // Click AI 诊断修复 button
    const fixBtn = screen.getByText('AI 诊断修复');
    fireEvent.click(fixBtn);

    await waitFor(() => {
      expect(screen.getByText('AI 修复建议（点击展开）')).toBeTruthy();
    });

    // Details should be closed by default (collapsed)
    const details = screen.getByText('AI 修复建议（点击展开）').closest('details');
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('displays fix log when available', () => {
    const mockStore = createMockStore({
      fixLog: ['修复了 ModItems.java', '修复了 ModBlocks.java'],
    });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    expect(screen.getByText('修复过程')).toBeTruthy();
    expect(screen.getByText('• 修复了 ModItems.java')).toBeTruthy();
    expect(screen.getByText('• 修复了 ModBlocks.java')).toBeTruthy();
  });

  it('shows build count', () => {
    const mockStore = createMockStore();
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    expect(screen.getByText('构建次数：0')).toBeTruthy();
  });

  it('shows phase text during build', () => {
    const mockStore = createMockStore({ loading: true });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    // Phase text appears when loading || streamBuilding
    expect(screen.getByText(/准备构建目录|编译中/)).toBeTruthy();
  });

  it('有 jarPath + sha256 时展示 SHA-256（monospace break-all）', () => {
    const hash = 'a'.repeat(64);
    const mockStore = createMockStore({ jarPath: 'test.jar', sha256: hash });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    render(<BuildPanel />);
    const el = screen.getByText(new RegExp(hash));
    expect(el).toBeTruthy();
    expect(el.className).toMatch(/font-mono/);
    expect(el.className).toMatch(/break-all/);
  });

  it('sha256 为 null 时不展示 SHA-256 行', () => {
    const mockStore = createMockStore({ jarPath: 'test.jar', sha256: null });
    (useModStore as any).mockImplementation((selector: any) => selector(mockStore));

    const { container } = render(<BuildPanel />);
    expect(container.textContent).not.toMatch(/SHA-256/);
  });
});
