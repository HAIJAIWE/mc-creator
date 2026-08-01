// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollaborationPanel } from './CollaborationPanel.js';
import { useModStore } from '../store/mod-store.js';

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    exportSpec: vi.fn(),
    importSpec: vi.fn(),
  },
}));

import { ipcClient } from '../lib/ipc-client.js';

const mockExport = ipcClient.exportSpec as ReturnType<typeof vi.fn>;
const mockImport = ipcClient.importSpec as ReturnType<typeof vi.fn>;

function resetStore(spec: unknown = { modId: 'test', name: 'Test', items: [] }) {
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'mod',
    spec: spec as never,
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
}

describe('CollaborationPanel', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('导出按钮调用 exportSpec', async () => {
    mockExport.mockResolvedValue({ ok: true, canceled: false, savedPath: 'C:/spec.mc-spec.json' });
    render(<CollaborationPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText('导出'));
    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith({
        spec: { modId: 'test', name: 'Test', items: [] },
        generatorType: 'mod',
        description: '',
      });
    });
    expect(screen.getByText(/已导出到/)).toBeTruthy();
  });

  it('导入快照后显示差异统计与合并按钮', async () => {
    mockImport.mockResolvedValue({
      canceled: false,
      snapshot: {
        meta: {
          exportedAt: '2026-08-01T00:00:00.000Z',
          exporter: '',
          description: '',
          generatorType: 'mod',
        },
        spec: { modId: 'test', name: 'Test', items: [], version: '1.0.0' },
      },
    });
    render(<CollaborationPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText('导入 Spec'));
    await waitFor(() => {
      expect(screen.getByText('差异预览')).toBeTruthy();
    });
    // version 是新增字段 → +1
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('version')).toBeTruthy();
    expect(screen.getByText('合并导入版本')).toBeTruthy();
  });

  it('合并导入版本写回 store', async () => {
    const importedSpec = { modId: 'test', name: 'Test', version: '2.0.0', items: [] };
    mockImport.mockResolvedValue({
      canceled: false,
      snapshot: {
        meta: {
          exportedAt: '2026-08-01T00:00:00.000Z',
          exporter: '',
          description: '',
          generatorType: 'mod',
        },
        spec: importedSpec,
      },
    });
    render(<CollaborationPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText('导入 Spec'));
    await waitFor(() => {
      expect(screen.getByText('合并导入版本')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('合并导入版本'));
    expect(useModStore.getState().spec).toEqual(importedSpec);
    expect(screen.getByText(/已合并导入版本/)).toBeTruthy();
  });

  it('导入格式错误显示错误', async () => {
    mockImport.mockResolvedValue({
      canceled: false,
      snapshot: null,
      error: 'Spec 快照格式无效',
    });
    render(<CollaborationPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText('导入 Spec'));
    await waitFor(() => {
      expect(screen.getByText('Spec 快照格式无效')).toBeTruthy();
    });
  });

  it('无差异快照显示提示', async () => {
    const same = { modId: 'test', name: 'Test', items: [] };
    mockImport.mockResolvedValue({
      canceled: false,
      snapshot: {
        meta: {
          exportedAt: '2026-08-01T00:00:00.000Z',
          exporter: '',
          description: '',
          generatorType: 'mod',
        },
        spec: same,
      },
    });
    render(<CollaborationPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText('导入 Spec'));
    await waitFor(() => {
      expect(screen.getByText('与当前 Spec 没有差异')).toBeTruthy();
    });
  });
});
