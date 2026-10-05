import { describe, it, expect } from 'vitest';
import { MODEL_PRESETS } from './SettingsPanel.js';

// 只断言预设数据：不断网、不渲染组件。
describe('SettingsPanel MODEL_PRESETS：本地免费模型（dsh 转发）', () => {
  const preset = MODEL_PRESETS.find((p) => p.name === '本地免费模型（dsh 转发）');

  it('该预设存在', () => {
    expect(preset).toBeDefined();
  });

  it('local 为 true', () => {
    expect(preset?.local).toBe(true);
  });

  it('baseURL 指向回环地址', () => {
    expect(preset?.baseURL).toContain('127.0.0.1');
  });

  it('models 非空', () => {
    expect(preset?.models?.length).toBeGreaterThan(0);
  });
});
