// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomNodeImporter } from './CustomNodeImporter.js';
import { customNodeRegistry } from './customNodeRegistry.js';

describe('CustomNodeImporter', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('渲染导入按钮 + 隐藏文件输入', () => {
    render(<CustomNodeImporter onClose={() => {}} />);
    expect(screen.getByText('导入自定义节点')).toBeTruthy();
    expect(screen.getByTestId('file-input')).toBeTruthy();
  });

  it('选择合法 JSON 文件后注册成功并显示提示', async () => {
    const onClose = vi.fn();
    render(<CustomNodeImporter onClose={onClose} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const schema = {
      typeId: 'mymod:test',
      label: '测试',
      description: '',
      icon: '',
      color: 'mc-code',
      ports: [],
      fields: [],
      codeTemplate: '',
    };
    const file = new File([JSON.stringify(schema)], 'test.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(customNodeRegistry.has('mymod:test')).toBe(true);
      expect(screen.getByText(/导入成功/)).toBeTruthy();
    });
  });

  it('选择非法 JSON 显示错误', async () => {
    render(<CustomNodeImporter onClose={() => {}} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText(/导入失败/)).toBeTruthy();
    });
  });
});
