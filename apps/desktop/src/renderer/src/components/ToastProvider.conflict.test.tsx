// @vitest-environment jsdom
/**
 * 冲突提示 toast（`showConflictToast`）的迁移回归测试。
 *
 * 这个用例是 ToastProvider 迁移的核心判据：迁移前 ui 的 Toast 不支持 actions，
 * 而冲突提示依赖三个决策按钮，迁过去等于删功能。补齐 actions 后这里就该绿。
 *
 * 覆盖：
 * - 三个决策按钮真实渲染（接受服务器 / 保留本地 / 查看差异）
 * - 各自的回调被正确触发，且互不串扰
 * - persistent：点完按钮提示**不消失**（要留到用户处理完）
 * - variant 档位映射（secondary → ghost、primary → primary）
 * - 无障碍：操作区是可访问分组、单条 toast 挂 role/aria-live
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ToastProvider } from './ToastProvider.js';
import { useToast } from './useToast.js';

const SERVER_META = { mtime: 1_700_000_000, size: 2048, hash: 'a1b2c3d4e5f60000' };
const LOCAL_META = { mtime: 1_700_000_100, size: 1024, hash: 'ffeeddccbbaa9999' };

/** 探针：暴露 showConflictToast 与手动 show（带 actions）两个入口。 */
function ConflictProbe(props: {
  onAcceptServer?: () => void;
  onKeepLocal?: () => void;
  onViewDiff?: () => void;
}) {
  const toast = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          toast.showConflictToast({
            filePath: 'config/level.dat',
            serverMeta: SERVER_META,
            localMeta: LOCAL_META,
            onAcceptServer: props.onAcceptServer ?? (() => undefined),
            onKeepLocal: props.onKeepLocal ?? (() => undefined),
            onViewDiff: props.onViewDiff ?? (() => undefined),
          })
        }
      >
        触发冲突
      </button>
      <button
        type="button"
        onClick={() =>
          toast.toast('手动提示', 'warning', {
            actions: [
              { label: '好', onClick: () => undefined },
              { label: '取消', onClick: () => undefined },
            ],
          })
        }
      >
        触发普通操作
      </button>
    </div>
  );
}

function renderProvider(props: Parameters<typeof ConflictProbe>[0] = {}): void {
  render(
    <ToastProvider>
      <ConflictProbe {...props} />
    </ToastProvider>,
  );
}

/** 只在可见 toast 栈里查（避开朗读区的重复文本）。 */
const stack = () => within(screen.getByTestId('toast-stack'));
const trigger = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('冲突提示 toast（迁移回归：actions 能力）', () => {
  it('渲染三个决策按钮', () => {
    renderProvider();
    trigger('触发冲突');
    expect(stack().getByRole('button', { name: '接受服务器版本' })).toBeTruthy();
    expect(stack().getByRole('button', { name: '保留本地版本' })).toBeTruthy();
    expect(stack().getByRole('button', { name: '查看差异' })).toBeTruthy();
  });

  it('文案含文件路径与两侧元信息（决策需要这些上下文）', () => {
    renderProvider();
    trigger('触发冲突');
    const text = stack().getByTestId('mc-toast').textContent ?? '';
    expect(text).toContain('config/level.dat');
    expect(text).toContain(SERVER_META.hash.slice(0, 8));
    expect(text).toContain(LOCAL_META.hash.slice(0, 8));
  });

  it('点「接受服务器版本」只触发它自己的回调', () => {
    const onAccept = vi.fn();
    const onKeep = vi.fn();
    const onDiff = vi.fn();
    renderProvider({ onAcceptServer: onAccept, onKeepLocal: onKeep, onViewDiff: onDiff });
    trigger('触发冲突');
    fireEvent.click(stack().getByRole('button', { name: '接受服务器版本' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
    expect(onDiff).not.toHaveBeenCalled();
  });

  it('点「保留本地版本」只触发它自己的回调', () => {
    const onKeep = vi.fn();
    renderProvider({ onKeepLocal: onKeep });
    trigger('触发冲突');
    fireEvent.click(stack().getByRole('button', { name: '保留本地版本' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('点「查看差异」只触发它自己的回调', () => {
    const onDiff = vi.fn();
    renderProvider({ onViewDiff: onDiff });
    trigger('触发冲突');
    fireEvent.click(stack().getByRole('button', { name: '查看差异' }));
    expect(onDiff).toHaveBeenCalledTimes(1);
  });

  it('persistent：点完按钮提示**不消失**（用户要留到处理完）', () => {
    renderProvider();
    trigger('触发冲突');
    fireEvent.click(stack().getByRole('button', { name: '查看差异' }));
    // 按钮点了提示仍在 —— 这正是 persistent 的语义
    expect(stack().getByRole('button', { name: '接受服务器版本' })).toBeTruthy();
    expect(stack().getByTestId('mc-toast')).toBeTruthy();
  });

  it('persistent：手动关闭按钮仍能关掉（否则会永久赖着）', () => {
    renderProvider();
    trigger('触发冲突');
    fireEvent.click(stack().getAllByLabelText('关闭')[0]);
    expect(screen.queryByRole('button', { name: '接受服务器版本' })).toBeNull();
  });

  it('操作区是可访问分组（读屏会念「操作」）', () => {
    renderProvider();
    trigger('触发冲突');
    expect(stack().getByRole('group', { name: '操作' })).toBeTruthy();
  });

  it('variant 档位映射：查看差异(primary) 是主按钮，两个 secondary 是 ghost', () => {
    renderProvider();
    trigger('触发冲突');
    // desktop 自己的 vitest 配置没装 jest-dom 匹配器，用原生断言
    expect(stack().getByRole('button', { name: '查看差异' }).className).toContain('mc-btn-primary');
    expect(stack().getByRole('button', { name: '接受服务器版本' }).className).toContain(
      'mc-btn-ghost',
    );
    expect(stack().getByRole('button', { name: '保留本地版本' }).className).toContain(
      'mc-btn-ghost',
    );
  });

  it('无障碍：warning 用 polite（不打断读屏）', () => {
    renderProvider();
    trigger('触发冲突');
    const node = stack().getByTestId('mc-toast');
    expect(node.getAttribute('aria-live')).toBe('polite');
    expect(node.getAttribute('role')).toBe('status');
  });

  it('朗读区同步最新消息（既有契约：live-region-toast-announcer）', () => {
    renderProvider();
    trigger('触发冲突');
    const region = screen.getByTestId('live-region-toast-announcer');
    expect(region.textContent).toContain('文件冲突');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });
});

describe('非 persistent 的操作提示：点完自动消失', () => {
  it('普通 toast 带 actions（非 persistent）→ 点完关闭', () => {
    renderProvider();
    trigger('触发普通操作');
    expect(stack().getByRole('button', { name: '好' })).toBeTruthy();
    fireEvent.click(stack().getByRole('button', { name: '好' }));
    expect(screen.queryByRole('button', { name: '好' })).toBeNull();
  });

  it('多档 variant 混排时按 variant 取默认时长（warning 4s）', () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      act(() => {
        trigger('触发普通操作');
      });
      expect(stack().getByRole('button', { name: '好' })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(4100);
      });
      expect(screen.queryByRole('button', { name: '好' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
