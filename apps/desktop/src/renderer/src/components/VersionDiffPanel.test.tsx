// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VersionDiffPanel } from './VersionDiffPanel.js';
import type { SpecVersion } from '../store/spec-history-store.js';

function makeVersion(id: string, label: string, spec: unknown): SpecVersion {
  return { id, timestamp: 1, label, spec, description: '', generatorType: 'mod' };
}

const V1 = makeVersion('v1', 'v1 旧版', {
  modId: 'test',
  name: 'Test Mod',
  items: [{ id: 'ruby', maxStackSize: 64 }],
});
const V2 = makeVersion('v2', 'v2 新版', {
  modId: 'test',
  name: 'Test Mod',
  version: '1.0.0',
  items: [{ id: 'ruby', maxStackSize: 32 }],
});

describe('VersionDiffPanel', () => {
  it('默认对比最近两个版本并展示差异', () => {
    render(<VersionDiffPanel versions={[V1, V2]} onClose={() => {}} />);
    // 统计条：+1 新增（version）、~1 修改（items[0].maxStackSize）
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('~1')).toBeTruthy();
    expect(screen.getByText('共 2 处差异')).toBeTruthy();
    // 差异路径
    expect(screen.getByText('version')).toBeTruthy();
    expect(screen.getByText('items[0].maxStackSize')).toBeTruthy();
  });

  it('版本下拉可切换', () => {
    render(<VersionDiffPanel versions={[V1, V2]} onClose={() => {}} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: 'v2' } });
    fireEvent.change(selects[1], { target: { value: 'v1' } });
    // 互换后仍 2 处差异
    expect(screen.getByText('共 2 处差异')).toBeTruthy();
  });

  it('无差异时显示提示', () => {
    const same = makeVersion('a', 'a', { modId: 'x' });
    render(
      <VersionDiffPanel versions={[same, { ...same, id: 'b', label: 'b' }]} onClose={() => {}} />,
    );
    expect(screen.getByText('两个版本没有差异')).toBeTruthy();
  });
});
