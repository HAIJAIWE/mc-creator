import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card · 基础渲染', () => {
  it('渲染子内容', () => {
    render(<Card>卡片正文</Card>);
    expect(screen.getByText('卡片正文')).toBeInTheDocument();
  });

  it('复用 index.css 的 .mc-card', () => {
    const { container } = render(<Card>正文</Card>);
    expect(container.firstElementChild).toHaveClass('mc-card');
  });

  it('渲染标题区', () => {
    render(<Card title="构建配置">正文</Card>);
    expect(screen.getByRole('heading', { name: '构建配置' })).toBeInTheDocument();
  });

  it('渲染副标题', () => {
    render(
      <Card title="构建配置" subtitle="仅影响 release">
        正文
      </Card>,
    );
    expect(screen.getByText('仅影响 release')).toBeInTheDocument();
  });

  it('渲染页脚区', () => {
    render(<Card footer={<button type="button">确定</button>}>正文</Card>);
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
  });

  it('无 title / subtitle 时不渲染标题区容器', () => {
    const { container } = render(<Card>正文</Card>);
    // 标题区有 border-b，若存在应有分隔线样式
    expect(container.querySelectorAll('.border-b')).toHaveLength(0);
  });

  it('title 默认为 h3', () => {
    render(<Card title="标题">正文</Card>);
    expect(screen.getByRole('heading', { name: '标题', level: 3 })).toBeInTheDocument();
  });

  it('titleAs 可指定标题层级（避免硬编码 h3 破坏文档大纲）', () => {
    render(
      <Card title="标题" titleAs="h2">
        正文
      </Card>,
    );
    expect(screen.getByRole('heading', { name: '标题', level: 2 })).toBeInTheDocument();
  });

  it('titleAs 支持 h4', () => {
    render(
      <Card title="标题" titleAs="h4">
        正文
      </Card>,
    );
    expect(screen.getByRole('heading', { name: '标题', level: 4 })).toBeInTheDocument();
  });

  it('只有 subtitle 没有 title 时也渲染标题区', () => {
    render(<Card subtitle="仅副标题">正文</Card>);
    expect(screen.getByText('仅副标题')).toBeInTheDocument();
  });

  it('只有 title 没有 subtitle 时不渲染副标题元素', () => {
    const { container } = render(<Card title="仅标题">正文</Card>);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('Card · padding', () => {
  it('默认 md 档位（p-4）', () => {
    const { container } = render(<Card>正文</Card>);
    const body = container.querySelector('.p-4');
    expect(body).toHaveTextContent('正文');
  });

  it('padding=sm 追加 p-2', () => {
    const { container } = render(<Card padding="sm">正文</Card>);
    expect(container.querySelector('.p-2')).toHaveTextContent('正文');
  });

  it('padding=lg 追加 p-6', () => {
    const { container } = render(<Card padding="lg">正文</Card>);
    expect(container.querySelector('.p-6')).toHaveTextContent('正文');
  });

  it('padding=none 时内容区无内边距类', () => {
    const { container } = render(<Card padding="none">正文</Card>);
    expect(container.querySelector('.p-4')).toBeNull();
  });
});

describe('Card · interactive', () => {
  it('interactive 追加 cursor-pointer 与 hover 面', () => {
    const { container } = render(<Card interactive>正文</Card>);
    expect(container.firstElementChild).toHaveClass('cursor-pointer', 'hover:bg-mc-surface-3');
  });

  it('默认（非 interactive）不加 hover 态', () => {
    const { container } = render(<Card>正文</Card>);
    expect(container.firstElementChild).not.toHaveClass('cursor-pointer');
  });

  it('interactive + onClick 自动补 role="button"', () => {
    render(
      <Card interactive onClick={() => {}}>
        点我
      </Card>,
    );
    expect(screen.getByRole('button', { name: '点我' })).toBeInTheDocument();
  });

  it('interactive + onClick 自动补 tabIndex=0（键盘可达）', () => {
    render(
      <Card interactive onClick={() => {}}>
        点我
      </Card>,
    );
    expect(screen.getByRole('button', { name: '点我' })).toHaveAttribute('tabindex', '0');
  });

  it('interactive 但无 onClick 时不冒充 button', () => {
    const { container } = render(<Card interactive>正文</Card>);
    expect(container.firstElementChild).not.toHaveAttribute('role');
    expect(container.firstElementChild).not.toHaveAttribute('tabindex');
  });

  it('有 onClick 但没有 interactive 时不补 role（保持语义诚实）', () => {
    const { container } = render(<Card onClick={() => {}}>正文</Card>);
    expect(container.firstElementChild).not.toHaveAttribute('role');
  });

  it('interactive + onClick 时点击触发回调', () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        点我
      </Card>,
    );
    fireEvent.click(screen.getByRole('button', { name: '点我' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Enter 键触发点击（键盘等价路径）', () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        点我
      </Card>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '点我' }), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Space 键触发点击且阻止默认滚动', () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        点我
      </Card>,
    );
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('button', { name: '点我' }), event);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('其他按键（如字母 a）不触发点击', () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        点我
      </Card>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '点我' }), { key: 'a' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('调用方 onKeyDown 与内置键盘激活共存', () => {
    const onKeyDown = vi.fn();
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick} onKeyDown={onKeyDown}>
        点我
      </Card>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '点我' }), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('调用方 onKeyDown 里 preventDefault 会抑制内置激活（尊重外层拦截）', () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick} onKeyDown={(event) => event.preventDefault()}>
        点我
      </Card>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '点我' }), { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Card · 透传', () => {
  it('透传 className', () => {
    const { container } = render(<Card className="my-card">正文</Card>);
    expect(container.firstElementChild).toHaveClass('mc-card', 'my-card');
  });

  it('透传 data-testid 与 aria-label', () => {
    render(
      <Card data-testid="card-1" aria-label="构建卡片">
        正文
      </Card>,
    );
    const card = screen.getByTestId('card-1');
    expect(card).toHaveAttribute('aria-label', '构建卡片');
  });
});
