// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingTour } from './OnboardingTour.js';

describe('OnboardingTour', () => {
  it('step=0 渲染第 1 步提示（含「拖」字）', () => {
    render(<OnboardingTour step={0} onNext={() => {}} onSkip={() => {}} />);
    expect(screen.getByText(/拖/)).toBeTruthy();
  });

  it('显示步骤进度 1/5', () => {
    render(<OnboardingTour step={0} onNext={() => {}} onSkip={() => {}} />);
    expect(screen.getByText(/1\/5/)).toBeTruthy();
  });

  it('下一步按钮触发 onNext', () => {
    const onNext = vi.fn();
    render(<OnboardingTour step={0} onNext={onNext} onSkip={() => {}} />);
    fireEvent.click(screen.getByText('下一步'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('跳过按钮触发 onSkip', () => {
    const onSkip = vi.fn();
    render(<OnboardingTour step={0} onNext={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('跳过'));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('最后一步显示「完成」而非「下一步」', () => {
    render(<OnboardingTour step={4} onNext={() => {}} onSkip={() => {}} />);
    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.queryByText('下一步')).toBeNull();
  });

  it('step 超出范围不渲染', () => {
    const { container } = render(<OnboardingTour step={99} onNext={() => {}} onSkip={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
