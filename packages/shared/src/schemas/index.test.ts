import { describe, it, expect } from 'vitest';
import { CustomNodeSchema } from './index.js';

describe('schemas index 导出', () => {
  it('CustomNodeSchema 从 index 导出', () => {
    expect(CustomNodeSchema).toBeDefined();
  });
});
