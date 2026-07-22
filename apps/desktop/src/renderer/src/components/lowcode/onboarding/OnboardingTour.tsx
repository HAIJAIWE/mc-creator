import { memo } from 'react';
import { ONBOARDING_STEPS } from './onboardingSteps.js';

interface OnboardingTourProps {
  /** 当前步骤索引（0-based），null 或越界时不渲染 */
  step: number;
  /** 进入下一步 */
  onNext: () => void;
  /** 跳过引导 */
  onSkip: () => void;
}

function OnboardingTourComponent({ step, onNext, onSkip }: OnboardingTourProps) {
  const current = ONBOARDING_STEPS[step];
  if (!current) return null;
  const total = ONBOARDING_STEPS.length;
  const isLast = step === total - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
    >
      <div
        className="rounded-mc border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-surface p-4 shadow-[4px_4px_0_rgba(0,0,0,0.5)]"
        style={{ width: 340 }}
      >
        <div className="mb-1 text-[10px] text-mc-mute">
          步骤 {step + 1}/{total} · {current.title}
        </div>
        <div className="mb-3 text-[12px] leading-relaxed text-mc-text">{current.content}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-mc border border-mc-border bg-mc-btn px-3 py-1 text-[11px] text-mc-text transition-colors hover:bg-mc-btn-hover"
          >
            跳过
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-mc border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-3 py-1 text-[11px] text-mc-text transition-colors hover:bg-mc-btn-hover active:bg-mc-btn-active"
          >
            {isLast ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const OnboardingTour = memo(OnboardingTourComponent);
