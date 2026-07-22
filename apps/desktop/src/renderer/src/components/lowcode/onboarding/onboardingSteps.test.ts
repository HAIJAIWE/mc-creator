import { describe, it, expect } from 'vitest';
import { ONBOARDING_STEPS, type OnboardingStep } from './onboardingSteps.js';

describe('onboardingSteps', () => {
  it('有 5 个步骤', () => {
    expect(ONBOARDING_STEPS).toHaveLength(5);
  });

  it('每个步骤有 target、title、content', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.target).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.content).toBeTruthy();
    }
  });

  it('每个 target 是合法 CSS 属性选择器', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.target).toMatch(/^\[data-onboarding="[^"]+"\]$/);
    }
  });

  it('第 1 步引导拖入节点', () => {
    expect(ONBOARDING_STEPS[0].content).toContain('拖');
  });

  it('第 5 步引导编译/保存', () => {
    expect(ONBOARDING_STEPS[4].content).toContain('编译');
  });

  it('满足 OnboardingStep 类型', () => {
    const s: OnboardingStep = ONBOARDING_STEPS[0];
    expect(s).toBeDefined();
  });
});
