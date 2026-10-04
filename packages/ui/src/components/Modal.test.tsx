import { createRef, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Modal, getFocusableElements } from './Modal';

describe('Modal · 渲染与无障碍语义', () => {
  it('open=false 时不渲染任何 DOM', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('open=true 时渲染 role="dialog"', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('aria-modal="true"（背景内容惰化）', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('标题通过 aria-labelledby 关联到 heading', () => {
    render(
      <Modal open title="删除确认" onClose={() => {}}>
        内容
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toHaveTextContent('删除确认');
  });

  it('正文通过 aria-describedby 关联', () => {
    render(
      <Modal open title="标题" onClose={() => {}}>
        危险操作说明
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)).toHaveTextContent('危险操作说明');
  });

  it('无标题时不输出 aria-labelledby（不留悬空引用）', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby');
  });

  it('面板本身 tabIndex=-1（可被程序化聚焦，不进 Tab 序列）', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('tabindex', '-1');
  });
});

describe('Modal · portal', () => {
  it('挂载到 document.body 而非 render 容器内', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('body')).not.toBeNull();
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('遮罩层挂在 body 上并标记 aria-hidden（纯装饰）', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    const overlay = screen.getByTestId('mc-modal-overlay');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(document.body.contains(overlay)).toBe(true);
  });

  it('两个 Modal 的 id 不互相冲突', () => {
    render(
      <>
        <Modal open title="甲" onClose={() => {}}>
          A
        </Modal>
        <Modal open title="乙" onClose={() => {}}>
          B
        </Modal>
      </>,
    );
    const [first, second] = screen.getAllByRole('dialog');
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
  });
});

describe('Modal · 关闭路径', () => {
  it('Escape 触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        内容
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnEscape=false 时 Escape 无效', () => {
    const onClose = vi.fn();
    render(
      <Modal open closeOnEscape={false} onClose={onClose}>
        内容
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击遮罩触发 onClose（默认开启）', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        内容
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('mc-modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnOverlayClick=false 时点遮罩不关闭', () => {
    const onClose = vi.fn();
    render(
      <Modal open closeOnOverlayClick={false} onClose={onClose}>
        内容
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('mc-modal-overlay'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击面板内部不关闭（不能误触）', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <span data-testid="inside">面板内容</span>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('inside'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('右上角关闭按钮可点击（键盘用户不只剩 Escape 一条路）', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        内容
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('关闭按钮没有 title 时也有可访问名（aria-label）', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('button', { name: '关闭' })).toHaveAttribute('aria-label', '关闭');
  });

  it('无标题时关闭按钮依然存在', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });
});

describe('Modal · 初始焦点', () => {
  it('打开时聚焦面板内第一个可聚焦元素（跳过关闭按钮）', () => {
    render(
      <Modal open onClose={() => {}}>
        <button type="button">第一个</button>
        <button type="button">第二个</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '第一个' }));
  });

  it('初始焦点不落在关闭按钮上（避免手一抖就关掉弹窗）', () => {
    render(
      <Modal open onClose={() => {}}>
        <button type="button">唯一</button>
      </Modal>,
    );
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '关闭' }));
  });

  it('initialFocusRef 指定的元素获得焦点', () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Modal open initialFocusRef={ref} onClose={() => {}}>
          <button type="button">第一个</button>
          <button type="button" ref={ref}>
            第二个
          </button>
        </Modal>
      );
    }
    render(<Harness />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '第二个' }));
  });

  it('initialFocusRef 指向已卸载元素时安全降级（不崩、不丢焦点）', () => {
    const staleRef = { current: null };
    render(
      <Modal open initialFocusRef={staleRef} onClose={() => {}}>
        <button type="button">唯一</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '唯一' }));
  });

  it('面板内无可聚焦元素（除关闭按钮）时焦点落在面板上', () => {
    render(
      <Modal open onClose={() => {}}>
        纯文本内容
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('关闭后把焦点归还给打开它的元素', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开
          </button>
          <Modal open={open} onClose={() => setOpen(false)}>
            <button type="button">面板内</button>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    // 焦点必须回到触发按钮，而不是凭空落到 body
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Modal · 焦点陷阱（WCAG 2.1.2）', () => {
  /**
   * 面板内的 Tab 循环顺序是 DOM 顺序：
   * `[关闭按钮, ...正文里的可聚焦元素...]`。
   * 关闭按钮虽然不是初始焦点，但它**必须**留在循环里 ——
   * 否则 `closeOnEscape={false}` 时键盘用户就没有关闭入口了。
   */
  it('焦点在最后一个元素时按 Tab 绕回循环的第一个（关闭按钮）', () => {
    render(
      <Modal open onClose={() => {}}>
        <button type="button">第一个</button>
        <button type="button">最后一个</button>
      </Modal>,
    );
    const closeButton = screen.getByRole('button', { name: '关闭' });
    const last = screen.getByRole('button', { name: '最后一个' });
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(closeButton);
  });

  it('焦点在循环第一个时按 Shift+Tab 绕回最后一个', () => {
    render(
      <Modal open onClose={() => {}}>
        <button type="button">第一个</button>
        <button type="button">最后一个</button>
      </Modal>,
    );
    const closeButton = screen.getByRole('button', { name: '关闭' });
    const last = screen.getByRole('button', { name: '最后一个' });
    closeButton.focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('焦点在面板本身时按 Tab 进入循环第一个', () => {
    render(
      <Modal open onClose={() => {}}>
        <button type="button">第一个</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  });

  it('焦点在中间元素时按 Tab 不被劫持（交给浏览器原生顺序）', () => {
    render(
      <Modal open onClose={() => {}}>
        <button type="button">第一个</button>
        <button type="button">中间</button>
        <button type="button">最后一个</button>
      </Modal>,
    );
    const middle = screen.getByRole('button', { name: '中间' });
    middle.focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(middle);
  });

  it('面板内只有关闭按钮可聚焦时，正向 Tab 从面板送进关闭按钮', () => {
    render(
      <Modal open onClose={() => {}}>
        纯文本
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    dialog.focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  });

  it('焦点在面板本身时 Shift+Tab 绕到循环最后一个', () => {
    render(
      <Modal open onClose={() => {}}>
        <button type="button">唯一</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    dialog.focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '唯一' }));
  });

  it('getFocusableElements 排除 disabled 与 tabindex=-1', () => {
    render(
      <div data-testid="host">
        <button type="button">可用</button>
        <button type="button" disabled>
          禁用
        </button>
        <button type="button" tabIndex={-1}>
          不可 tab
        </button>
        <a href="https://example.com">链接</a>
        <input type="text" />
        <input type="hidden" />
      </div>,
    );
    const host = screen.getByTestId('host');
    const focusables = getFocusableElements(host);
    const names = focusables.map((el) => el.textContent || el.tagName);
    expect(names).toContain('可用');
    expect(names).toContain('链接');
    expect(names).toContain('INPUT');
    expect(names).not.toContain('禁用');
    // 关键回归：逗号选择器是「或」，`:not([tabindex="-1"])` 必须逐条写，
    // 否则 button:not([disabled]) 会把 tabIndex=-1 的按钮捞进来
    expect(names).not.toContain('不可 tab');
    // hidden input 不可聚焦
    expect(focusables.filter((el) => (el as HTMLInputElement).type === 'hidden')).toHaveLength(0);
  });

  it('getFocusableElements 不包含 tabindex=-1 的容器', () => {
    render(
      <div data-testid="host">
        <div tabIndex={-1} data-testid="inner">
          内部
        </div>
      </div>,
    );
    const focusables = getFocusableElements(screen.getByTestId('host'));
    expect(focusables).toHaveLength(0);
  });

  it('getFocusableElements(null) 返回空数组（不崩）', () => {
    expect(getFocusableElements(null)).toEqual([]);
  });
});

describe('Modal · footer / size / className', () => {
  it('渲染 footer 操作区', () => {
    render(
      <Modal open onClose={() => {}} footer={<button type="button">确定</button>}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
  });

  it('无 footer 时不渲染操作区', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: '确定' })).not.toBeInTheDocument();
  });

  it('默认 md 档位（max-w-md，与 ConfirmDialog 对齐）', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('max-w-md');
  });

  it('size=xl 追加 max-w-4xl', () => {
    render(
      <Modal open size="xl" onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('max-w-4xl');
  });

  it('复用 index.css 的 .mc-pop 浮层样式', () => {
    render(
      <Modal open onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('mc-pop');
  });

  it('调用方 className 合并进面板', () => {
    render(
      <Modal open className="my-modal" onClose={() => {}}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('mc-pop', 'my-modal');
  });

  it('正文保留换行（whitespace-pre-wrap，提示文案不该被压成一行）', () => {
    render(
      <Modal open onClose={() => {}}>
        第一行
        {'\n'}
        第二行
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const body = document.getElementById(dialog.getAttribute('aria-describedby') as string);
    expect(body).toHaveClass('whitespace-pre-wrap');
  });

  it('initialFocusRef 用 RefObject 而非 callback 时也能工作（类型约束成立）', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <div>
        <button type="button" ref={ref}>
          目标
        </button>
      </div>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: '目标' }));
  });
});

describe('Modal · 受控开关', () => {
  it('onClose 里改 open=false 即刻卸载（真实受控用法）', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)}>
          内容
        </Modal>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
