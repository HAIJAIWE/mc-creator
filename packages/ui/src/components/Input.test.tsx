import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from './Input';

describe('Input · 基础渲染', () => {
  it('渲染可编辑的 textbox', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('复用 index.css 的 .mc-input', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toHaveClass('mc-input');
  });

  it('渲染 label 文本', () => {
    render(<Input label="项目名" />);
    expect(screen.getByText('项目名')).toBeInTheDocument();
  });

  it('无 label 时不渲染 label 元素', () => {
    const { container } = render(<Input />);
    expect(container.querySelector('label')).toBeNull();
  });

  it('尺寸档位追加对应 class', () => {
    render(<Input size="lg" />);
    expect(screen.getByRole('textbox')).toHaveClass('px-3', 'py-2', 'text-base');
  });

  it('fullWidth 追加 w-full 到外层容器', () => {
    const { container } = render(<Input fullWidth />);
    expect(container.firstElementChild).toHaveClass('w-full');
  });

  it('调用方 className 合并进 input', () => {
    render(<Input className="my-input" />);
    expect(screen.getByRole('textbox')).toHaveClass('mc-input', 'my-input');
  });
});

describe('Input · label 关联（无障碍）', () => {
  it('label 的 htmlFor 指向 input 的 id', () => {
    render(<Input label="项目名" />);
    const input = screen.getByLabelText('项目名');
    const label = screen.getByText('项目名');
    expect(input).toBeInTheDocument();
    expect(label).toHaveAttribute('for', input.getAttribute('id'));
  });

  it('自动生成的 id 非空且不以冒号开头（React useId 的冒号会破坏 CSS 选择器）', () => {
    render(<Input label="项目名" />);
    const id = screen.getByLabelText('项目名').getAttribute('id') ?? '';
    expect(id).not.toBe('');
    expect(id.startsWith('mc-input-')).toBe(true);
    expect(id).not.toContain(':');
  });

  it('两个 Input 的自动 id 互不相同（否则 label 会串）', () => {
    render(
      <>
        <Input label="甲" />
        <Input label="乙" />
      </>,
    );
    const a = screen.getByLabelText('甲').getAttribute('id');
    const b = screen.getByLabelText('乙').getAttribute('id');
    expect(a).not.toBe(b);
  });

  it('显式传 id 时优先用调用方的 id', () => {
    render(<Input label="项目名" id="my-field" />);
    const input = screen.getByLabelText('项目名');
    expect(input).toHaveAttribute('id', 'my-field');
    expect(screen.getByText('项目名')).toHaveAttribute('for', 'my-field');
  });
});

describe('Input · 校验错误（无障碍）', () => {
  it('有 error 时标记 aria-invalid=true', () => {
    render(<Input error="名称不能为空" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('无 error 时不输出 aria-invalid（避免 false 噪声）', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
  });

  it('错误文案带 role="alert"（读屏立刻播报）', () => {
    render(<Input error="名称不能为空" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('名称不能为空');
  });

  it('错误态用红石色（mc-redstone）', () => {
    render(<Input error="名称不能为空" />);
    expect(screen.getByRole('textbox')).toHaveClass('border-mc-redstone');
  });

  it('aria-describedby 连到错误文案', () => {
    render(<Input error="名称不能为空" />);
    const input = screen.getByRole('textbox');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent('名称不能为空');
  });
});

describe('Input · hint', () => {
  it('无 error 时渲染 hint', () => {
    render(<Input hint="支持中文与下划线" />);
    expect(screen.getByText('支持中文与下划线')).toBeInTheDocument();
  });

  it('hint 通过 aria-describedby 连到 input', () => {
    render(<Input hint="支持中文" />);
    const input = screen.getByRole('textbox');
    const describedBy = input.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)).toHaveTextContent('支持中文');
  });

  it('无 hint 无 error 时不输出 aria-describedby（不留悬空引用）', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });

  it('error 存在时 hint 让位，且 describedby 只指向 error（不悬空）', () => {
    render(<Input hint="辅助说明" error="出错了" />);
    expect(screen.queryByText('辅助说明')).not.toBeInTheDocument();

    const input = screen.getByRole('textbox');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0] as string)).toHaveTextContent('出错了');
  });
});

describe('Input · 交互与透传', () => {
  it('可以输入并触发 onChange', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'abc' } });

    expect(input).toHaveValue('abc');
    expect(onChange).toHaveBeenCalled();
  });

  it('受控 value 正常渲染', () => {
    render(<Input value="受控值" onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('受控值');
  });

  it('disabled 时不可编辑', () => {
    render(<Input disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('透传 placeholder', () => {
    render(<Input placeholder="留空则用项目名" />);
    expect(screen.getByPlaceholderText('留空则用项目名')).toBeInTheDocument();
  });

  it('透传 type=textbox 之外的类型（如 password）', () => {
    const { container } = render(<Input type="password" />);
    expect(container.querySelector('input')).toHaveAttribute('type', 'password');
  });

  it('透传 aria-* 与 data-*', () => {
    render(<Input aria-label="别名" data-testid="field" required />);
    const input = screen.getByTestId('field');
    expect(input).toHaveAttribute('aria-label', '别名');
    expect(input).toBeRequired();
  });

  it('forwardRef 把真实 input DOM 交给调用方', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });
});
