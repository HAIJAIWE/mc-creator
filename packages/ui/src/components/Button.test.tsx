import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button · 变体与尺寸', () => {
  it('默认渲染 primary 变体（mc-btn-primary）', () => {
    render(<Button>构建</Button>);
    const btn = screen.getByRole('button', { name: '构建' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveClass('mc-btn-primary');
  });

  it('ghost 变体映射 mc-btn-ghost', () => {
    render(<Button variant="ghost">取消</Button>);
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('mc-btn-ghost');
  });

  it('danger 变体映射 mc-btn-danger', () => {
    render(<Button variant="danger">删除</Button>);
    expect(screen.getByRole('button', { name: '删除' })).toHaveClass('mc-btn-danger');
  });

  it('size=lg 追加大号偏移 class', () => {
    render(<Button size="lg">大</Button>);
    expect(screen.getByRole('button', { name: '大' })).toHaveClass('px-4', 'py-2', 'text-sm');
  });

  it('size=sm 追加小号偏移 class', () => {
    render(<Button size="sm">小</Button>);
    expect(screen.getByRole('button', { name: '小' })).toHaveClass('px-2', 'py-1');
  });

  it('size=md 不额外追加间距 class（间距由 index.css 单点定义）', () => {
    render(<Button size="md">中</Button>);
    expect(screen.getByRole('button', { name: '中' }).className).toBe('mc-btn-primary');
  });

  it('fullWidth 追加 w-full', () => {
    render(<Button fullWidth>全宽</Button>);
    expect(screen.getByRole('button', { name: '全宽' })).toHaveClass('w-full');
  });

  it('调用方 className 合并在末尾（可覆盖库内样式）', () => {
    render(<Button className="my-custom">自定义</Button>);
    const btn = screen.getByRole('button', { name: '自定义' });
    expect(btn).toHaveClass('mc-btn-primary', 'my-custom');
    expect(btn.className.endsWith('my-custom')).toBe(true);
  });
});

describe('Button · 表单安全（type 默认值）', () => {
  it('默认 type="button"，绝不污染表单提交', () => {
    render(<Button>点我</Button>);
    expect(screen.getByRole('button', { name: '点我' })).toHaveAttribute('type', 'button');
  });

  it('显式 type 可覆盖（submit 场景）', () => {
    render(<Button type="submit">提交</Button>);
    expect(screen.getByRole('button', { name: '提交' })).toHaveAttribute('type', 'submit');
  });

  it('显式 type="reset" 也能透传', () => {
    render(<Button type="reset">重置</Button>);
    expect(screen.getByRole('button', { name: '重置' })).toHaveAttribute('type', 'reset');
  });
});

describe('Button · 交互', () => {
  it('点击触发 onClick 一次', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>点击</Button>);
    fireEvent.click(screen.getByRole('button', { name: '点击' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled 时不触发 onClick', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        禁用
      </Button>,
    );
    const btn = screen.getByRole('button', { name: '禁用' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('透传标准 DOM 属性（aria-label / data-testid / title）', () => {
    render(
      <Button aria-label="构建项目" data-testid="build-btn" title="快捷键 Ctrl+B">
        B
      </Button>,
    );
    const btn = screen.getByTestId('build-btn');
    expect(btn).toHaveAttribute('aria-label', '构建项目');
    expect(btn).toHaveAttribute('title', '快捷键 Ctrl+B');
  });

  it('forwardRef 把真实 button DOM 交给调用方', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>聚焦我</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });
});

describe('Button · loading 态', () => {
  it('loading 时 aria-busy=true 且被禁用', () => {
    render(<Button loading>处理中</Button>);
    const btn = screen.getByRole('button', { name: /处理中/ });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('非 loading 时不输出 aria-busy 属性（避免 false 噪声）', () => {
    render(<Button>空闲</Button>);
    expect(screen.getByRole('button', { name: '空闲' })).not.toHaveAttribute('aria-busy');
  });

  it('loading 时不触发 onClick（防重复提交）', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        提交
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading 时渲染 spinner（aria-hidden 的内联 svg）', () => {
    const { container } = render(<Button loading>处理中</Button>);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('loading 时保留文案（避免按钮宽度跳动）', () => {
    render(<Button loading>处理中</Button>);
    expect(screen.getByRole('button', { name: /处理中/ })).toHaveTextContent('处理中');
  });

  it('loading 标记 data-loading 供样式钩子使用', () => {
    render(<Button loading>处理中</Button>);
    expect(screen.getByRole('button', { name: /处理中/ })).toHaveAttribute('data-loading', 'true');
  });

  it('loading 时隐藏 iconRight（避免与 spinner 视觉打架）', () => {
    const { container } = render(
      <Button loading iconRight={<span data-testid="right">R</span>}>
        处理中
      </Button>,
    );
    expect(screen.queryByTestId('right')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

describe('Button · 图标', () => {
  it('渲染 iconLeft', () => {
    render(<Button iconLeft={<span data-testid="left">L</span>}>带图标</Button>);
    expect(screen.getByTestId('left')).toBeInTheDocument();
  });

  it('渲染 iconRight', () => {
    render(<Button iconRight={<span data-testid="right">R</span>}>带图标</Button>);
    expect(screen.getByTestId('right')).toBeInTheDocument();
  });

  it('图标与文案同时存在', () => {
    render(
      <Button iconLeft={<span>L</span>} iconRight={<span>R</span>}>
        中间
      </Button>,
    );
    expect(screen.getByRole('button', { name: /中间/ })).toHaveTextContent('L中间R');
  });

  it('无图标时不渲染 mc-icon-svg 包装层', () => {
    const { container } = render(<Button>纯文案</Button>);
    expect(container.querySelector('.mc-icon-svg')).toBeNull();
  });
});
