/**
 * Modal 的 closeLabel 注入 + Card 的 titleAction 插槽测试。
 *
 * 与 Modal.test.tsx / Card.test.tsx 分工：那边测既有行为，这边只测本轮新增的两处。
 *
 * 为什么这两处值得测：
 * - closeLabel：关闭按钮是每个对话框都要朗读的控件，硬编码中文会让英文环境读出中文
 *   （i18n §4.5 要求错误文案映射层统一多语言）。
 * - titleAction：可关闭的警告/错误条要求关闭入口在标题行右端，缺这个槽调用方
 *   只能整段自绘标题行，绕过 .mc-card 的排版规则 → 两处样式日后漂移。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Card } from './Card';
import { Modal } from './Modal';

describe('Modal · closeLabel 注入（i18n，§4.5）', () => {
  it('默认关闭按钮可访问名是「关闭」', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('传 closeLabel → 覆盖为英文（英文环境不再读中文）', () => {
    render(
      <Modal open closeLabel="Close" onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
  });

  it('closeLabel 注入后关闭按钮仍可点（不只是改文案）', () => {
    const onClose = vi.fn();
    render(
      <Modal open closeLabel="Close" onClose={onClose}>
        内容
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeLabel 仍参与 Tab 焦点循环（改名不能把它踢出可聚焦序列）', () => {
    render(
      <Modal open closeLabel="Close" onClose={() => {}}>
        <button type="button">正文按钮</button>
      </Modal>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    expect(document.activeElement).toBe(close);
    // Shift+Tab 从循环第一个绕回最后一个
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '正文按钮' }));
  });

  it('closeLabel 省略时无覆盖（默认分支行为不变）', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('有标题时 closeLabel 生效且 aria-labelledby 连线不受影响', () => {
    render(
      <Modal open title="删除实例" closeLabel="Close" onClose={() => {}}>
        不可逆
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId as string)).toHaveTextContent('删除实例');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('Card · titleAction 插槽', () => {
  it('渲染在标题行内', () => {
    render(
      <Card title="警告" titleAction={<button type="button">关闭</button>}>
        正文
      </Card>,
    );
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.getByText('警告')).toBeInTheDocument();
  });

  it('标题行改为两列布局（标题左、插槽右）', () => {
    const { container } = render(
      <Card title="警告" titleAction={<button type="button">关闭</button>}>
        正文
      </Card>,
    );
    // 标题行容器必须有 justify-between（插槽靠右）
    const header = screen.getByText('警告').parentElement?.parentElement;
    expect(header).toHaveClass('justify-between');
    expect(container).toBeTruthy();
  });

  it('无 titleAction → 标题行退化为单列，视觉与之前一致', () => {
    const { container } = render(
      <Card title="警告" subtitle="副标题">
        正文
      </Card>,
    );
    expect(container.querySelector('[role="group"]')).not.toBeInTheDocument();
    expect(screen.getByText('警告')).toBeInTheDocument();
  });

  it('只有 titleAction 没有 title 时也渲染标题行（插槽要有地方放）', () => {
    render(<Card titleAction={<button type="button">关闭</button>}>正文</Card>);
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('无 title/subtitle/titleAction → 不渲染标题行', () => {
    const { container } = render(<Card>正文</Card>);
    expect(container.querySelector('.justify-between')).not.toBeInTheDocument();
  });

  it('titleAction 里的按钮可点（插槽不是摆设）', () => {
    const onClick = vi.fn();
    render(
      <Card
        title="警告"
        titleAction={
          <button type="button" onClick={onClick}>
            关闭
          </button>
        }
      >
        正文
      </Card>,
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('title + subtitle + titleAction 三者共存', () => {
    render(
      <Card
        title="磁盘空间不足"
        subtitle="剩余 200MB"
        titleAction={<button type="button">忽略</button>}
        footer={<button type="button">清理</button>}
      >
        正文
      </Card>,
    );
    expect(screen.getByText('磁盘空间不足')).toBeInTheDocument();
    expect(screen.getByText('剩余 200MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '忽略' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清理' })).toBeInTheDocument();
  });

  it('padding="none" + titleAction 组合可用（桌面端可关闭条形容器）', () => {
    render(
      <Card padding="none" title="错误" titleAction={<button type="button">关闭</button>}>
        出错了
      </Card>,
    );
    expect(screen.getByText('出错了')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('interactive + titleAction 共存不冲突', () => {
    const onClick = vi.fn();
    render(
      <Card
        interactive
        onClick={onClick}
        title="警告"
        titleAction={<button type="button">X</button>}
      >
        正文
      </Card>,
    );
    // 卡片本体可点
    fireEvent.click(screen.getByText('正文'));
    expect(onClick).toHaveBeenCalled();
  });
});
