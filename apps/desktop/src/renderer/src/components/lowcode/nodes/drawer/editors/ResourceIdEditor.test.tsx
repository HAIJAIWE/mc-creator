// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ResourceIdEditor } from './ResourceIdEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = {
  version: 1,
  modId: 'test',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  subgraphs: {},
};

describe('ResourceIdEditor', () => {
  const schema: FieldSchema = {
    key: 'itemId',
    label: '物品 ID',
    type: 'resourceId',
    required: true,
  };

  it('解析 modid:path 格式', async () => {
    render(
      <ResourceIdEditor
        value="mymod:iron_sword"
        onChange={() => {}}
        schema={schema}
        graph={graph}
      />,
    );
    // D10：flush listExternalMods 异步 promise，避免在 act 外 setState
    await act(async () => {});
    expect(screen.getByDisplayValue('mymod')).toBeTruthy();
    expect(screen.getByDisplayValue('iron_sword')).toBeTruthy();
  });

  it('只有 path 时 modid 默认为 minecraft', async () => {
    render(
      <ResourceIdEditor value="iron_sword" onChange={() => {}} schema={schema} graph={graph} />,
    );
    await act(async () => {});
    expect(screen.getByDisplayValue('minecraft')).toBeTruthy();
    expect(screen.getByDisplayValue('iron_sword')).toBeTruthy();
  });

  it('编辑 path 触发 onChange 拼接 modid:path', async () => {
    const onChange = vi.fn();
    render(
      <ResourceIdEditor
        value="mymod:iron_sword"
        onChange={onChange}
        schema={schema}
        graph={graph}
      />,
    );
    await act(async () => {});
    const pathInput = screen.getByDisplayValue('iron_sword');
    fireEvent.change(pathInput, { target: { value: 'diamond_sword' } });
    expect(onChange).toHaveBeenCalledWith('mymod:diamond_sword');
  });

  it('格式不合法时显示错误', async () => {
    render(
      <ResourceIdEditor
        value="INVALID"
        onChange={() => {}}
        schema={schema}
        graph={graph}
        error="格式错误"
      />,
    );
    await act(async () => {});
    expect(screen.getByText('格式错误')).toBeTruthy();
  });
});

describe('ResourceIdEditor 外部 mod 命名空间', () => {
  const schema: FieldSchema = { key: 'id', label: 'ID', type: 'resourceId' };
  const originalMcApi = (window as { mcApi?: unknown }).mcApi;

  beforeEach(() => {
    (window as { mcApi?: unknown }).mcApi = undefined;
  });

  afterEach(() => {
    (window as { mcApi?: unknown }).mcApi = originalMcApi;
  });

  it('命名空间下拉含 minecraft + mock 外部 mod', async () => {
    render(
      <ResourceIdEditor
        value="minecraft:iron_ingot"
        onChange={() => {}}
        schema={schema}
        graph={graph}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('namespace-select')).toBeTruthy();
    });
    const select = screen.getByTestId('namespace-select') as HTMLSelectElement;
    expect(select.innerHTML).toContain('minecraft');
    expect(select.innerHTML).toContain('create');
  });

  it('切换命名空间更新 value', async () => {
    let value = 'minecraft:iron_ingot';
    render(
      <ResourceIdEditor
        value={value}
        onChange={(v) => {
          value = v;
        }}
        schema={schema}
        graph={graph}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('namespace-select')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('namespace-select'), { target: { value: 'create' } });
    expect(value.startsWith('create:')).toBe(true);
  });
});
