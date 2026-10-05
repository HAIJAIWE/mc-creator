import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Progress, clampProgress } from './Progress';
import { MC_COLORS, TONE_COLOR_VAR } from '../theme/index';

describe('clampProgress · 边界归一', () => {
  it('区间内原样返回', () => {
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(42.5)).toBe(42.5);
    expect(clampProgress(100)).toBe(100);
  });

  it('上界越界夹到 100', () => {
    expect(clampProgress(120)).toBe(100);
    expect(clampProgress(99999)).toBe(100);
  });

  it('下界越界夹到 0', () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(-0.5)).toBe(0);
  });

  it('NaN 归一到 0（外部脏数据不该让整条进度条崩掉）', () => {
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  it('Infinity / -Infinity 归一到 0', () => {
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('Progress · 基础渲染与语义', () => {
  it('渲染 role="progressbar"', () => {
    render(<Progress value={40} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('无障碍上下界固定为 0 / 100', () => {
    render(<Progress value={40} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('确定态输出 aria-valuenow', () => {
    render(<Progress value={40} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('渲染标签', () => {
    render(<Progress value={10} label="构建进度" />);
    expect(screen.getByText('构建进度')).toBeInTheDocument();
  });

  it('字符串 label 同时作为可访问名', () => {
    render(<Progress value={10} label="构建进度" />);
    expect(screen.getByRole('progressbar', { name: '构建进度' })).toBeInTheDocument();
  });

  it('aria-valuetext 带 label 读起来更完整', () => {
    render(<Progress value={40} label="构建进度" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '构建进度 40%');
  });

  it('无 label 时 aria-valuetext 只有百分比', () => {
    render(<Progress value={40} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '40%');
  });

  it('非字符串 label 不污染可访问名（ReactNode 无法转 aria-label）', () => {
    render(<Progress value={40} label={<span data-testid="fancy-label">复杂</span>} />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-label');
    expect(screen.getByTestId('fancy-label')).toBeInTheDocument();
  });

  it('填充条宽度按百分比内联', () => {
    render(<Progress value={40} />);
    expect(screen.getByTestId('mc-progress-fill')).toHaveStyle({ width: '40%' });
  });
});

describe('Progress · 不确定态', () => {
  it('不传 value 即为不确定态，不输出 aria-valuenow', () => {
    render(<Progress />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
  });

  it('不确定态 aria-valuetext 退化为「加载中」', () => {
    render(<Progress />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '加载中');
  });

  it('不确定态 + label 时 aria-valuetext 用 label', () => {
    render(<Progress label="连接服务器" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '连接服务器');
  });

  it('不确定态填充条不带具体宽度（改用动画占位）', () => {
    render(<Progress />);
    const fill = screen.getByTestId('mc-progress-fill');
    expect(fill.style.width).toBe('');
    expect(fill).toHaveClass('animate-pulse');
  });

  it('显式 indeterminate 会覆盖已有的 value', () => {
    render(<Progress value={70} indeterminate />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('不确定态不显示百分比（显示一个假的 0% 会误导）', () => {
    render(<Progress showPercent />);
    expect(screen.queryByTestId('mc-progress-percent')).not.toBeInTheDocument();
  });
});

describe('Progress · showPercent', () => {
  it('显示百分比文本', () => {
    render(<Progress value={42} showPercent />);
    expect(screen.getByTestId('mc-progress-percent')).toHaveTextContent('42%');
  });

  it('默认不显示百分比', () => {
    render(<Progress value={42} />);
    expect(screen.queryByTestId('mc-progress-percent')).not.toBeInTheDocument();
  });

  it('百分比走 clamp 后的值', () => {
    render(<Progress value={150} showPercent />);
    expect(screen.getByTestId('mc-progress-percent')).toHaveTextContent('100%');
  });

  it('无 label 时也不渲染标签行', () => {
    const { container } = render(<Progress value={42} />);
    expect(container.querySelector('.justify-between')).toBeNull();
  });
});

describe('Progress · value 越界', () => {
  it('value=120 时 aria-valuenow 夹到 100', () => {
    render(<Progress value={120} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('value=120 时填充条宽度夹到 100%', () => {
    render(<Progress value={120} />);
    expect(screen.getByTestId('mc-progress-fill')).toHaveStyle({ width: '100%' });
  });

  it('value=-20 时 aria-valuenow 夹到 0', () => {
    render(<Progress value={-20} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('value=NaN 时不崩，归一到 0', () => {
    render(<Progress value={Number.NaN} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Progress · tone', () => {
  it('默认 accent 用 --mc-accent 变量（换肤可联动）', () => {
    render(<Progress value={40} />);
    expect(screen.getByTestId('mc-progress-fill').style.background).toContain('var(--mc-accent)');
  });

  it('tone=gold 引用 --mc-gold 变量', () => {
    render(<Progress value={40} tone="gold" />);
    expect(screen.getByTestId('mc-progress-fill').style.background).toContain('var(--mc-gold)');
  });

  it('tone=redstone 引用 --mc-redstone 变量', () => {
    render(<Progress value={40} tone="redstone" />);
    expect(screen.getByTestId('mc-progress-fill').style.background).toContain('var(--mc-redstone)');
  });

  it('填充色引用 CSS 变量而非硬编码三元组（否则换肤失效）', () => {
    render(<Progress value={40} />);
    expect(screen.getByTestId('mc-progress-fill').style.background).not.toContain(MC_COLORS.accent);
  });

  it('tone 映射表覆盖三个语义色', () => {
    expect(Object.keys(TONE_COLOR_VAR)).toEqual(['accent', 'gold', 'redstone']);
  });
});

describe('Progress · 透传', () => {
  it('透传 className 与 data-testid', () => {
    render(<Progress value={40} className="my-progress" data-testid="p1" />);
    const outer = screen.getByTestId('p1');
    expect(outer).toHaveClass('my-progress');
  });

  it('透传 style（与内联填充色共存）', () => {
    render(<Progress value={40} data-testid="p1" style={{ marginTop: '8px' }} />);
    expect(screen.getByTestId('p1')).toHaveStyle({ marginTop: '8px' });
  });
});
