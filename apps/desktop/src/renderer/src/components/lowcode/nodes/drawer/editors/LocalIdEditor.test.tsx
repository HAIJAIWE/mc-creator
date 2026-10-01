// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalIdEditor } from './LocalIdEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

function makeGraph(modId: string): NodeGraph {
  return {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    subgraphs: {},
  };
}

/**
 * 定义型 ID 编辑器：命名空间只读展示，输入框只承载本地名。
 * 关键不变量：onChange 发出的值永远是裸 id，绝不含命名空间。
 */
describe('LocalIdEditor', () => {
  const schema: FieldSchema = {
    key: 'itemId',
    label: '物品 ID',
    type: 'localId',
    required: true,
  };

  it('只读展示当前 mod 命名空间，输入框只含本地名', () => {
    render(
      <LocalIdEditor
        value="ruby_sword"
        onChange={() => {}}
        schema={schema}
        graph={makeGraph('mymod')}
      />,
    );
    expect(screen.getByTestId('local-id-namespace').textContent).toBe('mymod');
    const input = screen.getByLabelText('物品 ID（本地名，不含命名空间）') as HTMLInputElement;
    expect(input.value).toBe('ruby_sword');
    // 命名空间不进入输入框（否则又会被写回数据层）
    expect(input.value).not.toContain(':');
  });

  it('编辑后 onChange 只发出裸 id', () => {
    const onChange = vi.fn();
    render(
      <LocalIdEditor
        value="ruby_sword"
        onChange={onChange}
        schema={schema}
        graph={makeGraph('mymod')}
      />,
    );
    const input = screen.getByLabelText('物品 ID（本地名，不含命名空间）');
    fireEvent.change(input, { target: { value: 'ruby_axe' } });

    expect(onChange).toHaveBeenCalledWith('ruby_axe');
    expect(onChange).not.toHaveBeenCalledWith('mymod:ruby_axe');
  });

  it('modId 为空时命名空间显示占位，不阻塞编辑', () => {
    const onChange = vi.fn();
    render(<LocalIdEditor value="" onChange={onChange} schema={schema} graph={makeGraph('')} />);
    expect(screen.getByTestId('local-id-namespace').textContent).toBe('(未设置)');

    fireEvent.change(screen.getByLabelText('物品 ID（本地名，不含命名空间）'), {
      target: { value: 'ruby' },
    });
    expect(onChange).toHaveBeenCalledWith('ruby');
  });

  it('外部 value 变化时回写输入框', () => {
    const { rerender } = render(
      <LocalIdEditor value="a" onChange={() => {}} schema={schema} graph={makeGraph('m')} />,
    );
    rerender(
      <LocalIdEditor value="b" onChange={() => {}} schema={schema} graph={makeGraph('m')} />,
    );
    const input = screen.getByLabelText('物品 ID（本地名，不含命名空间）') as HTMLInputElement;
    expect(input.value).toBe('b');
  });
});
