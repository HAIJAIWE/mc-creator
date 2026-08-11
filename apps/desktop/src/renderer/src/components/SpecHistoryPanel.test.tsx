// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpecHistoryPanel } from './SpecHistoryPanel.js';
import { useSpecHistoryStore } from '../store/spec-history-store.js';
import { useModStore } from '../store/mod-store.js';

const SPEC_A = { items: [{ id: 'a' }] };
const SPEC_B = { items: [{ id: 'b' }] };

function seedStore() {
  useSpecHistoryStore.setState({ versions: [], currentIndex: -1 });
  const s1 = useSpecHistoryStore.getState();
  s1.pushVersion({ generatorType: 'mod', description: '第一版', spec: SPEC_A });
  s1.pushVersion({ generatorType: 'mod', description: '第二版', spec: SPEC_B });
}

describe('SpecHistoryPanel', () => {
  beforeEach(() => {
    seedStore();
    useModStore.setState({ spec: SPEC_B as never });
    vi.restoreAllMocks();
  });

  it('展示历史版本并标记当前版本', () => {
    render(<SpecHistoryPanel />);
    expect(screen.getByText((t) => t.includes('共 2 个版本'))).toBeTruthy();
    expect(screen.getAllByText('当前')).toHaveLength(1);
  });

  it('回滚到指定版本并同步 mod-store', () => {
    render(<SpecHistoryPanel />);
    const rollbackButtons = screen.getAllByTitle('回滚到此版本');
    fireEvent.click(rollbackButtons[0]);
    expect(useModStore.getState().spec).toEqual(SPEC_A);
  });

  it('删除需要确认，确认后移除', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SpecHistoryPanel />);
    const deleteButtons = screen.getAllByTitle('删除此版本');
    fireEvent.click(deleteButtons[0]);
    expect(confirmSpy).toHaveBeenCalled();
    expect(useSpecHistoryStore.getState().versions.length).toBe(1);
  });

  it('取消确认则不删除', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SpecHistoryPanel />);
    fireEvent.click(screen.getAllByTitle('删除此版本')[0]);
    expect(confirmSpy).toHaveBeenCalled();
    expect(useSpecHistoryStore.getState().versions.length).toBe(2);
  });

  it('清空需要确认', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SpecHistoryPanel />);
    fireEvent.click(screen.getByText('清空'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(useSpecHistoryStore.getState().versions.length).toBe(0);
  });

  it('取消清空则保留', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SpecHistoryPanel />);
    fireEvent.click(screen.getByText('清空'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(useSpecHistoryStore.getState().versions.length).toBe(2);
  });

  it('空历史时展示空态', () => {
    useSpecHistoryStore.setState({ versions: [], currentIndex: -1 });
    render(<SpecHistoryPanel />);
    expect(screen.getByText('暂无历史版本')).toBeTruthy();
  });
});
