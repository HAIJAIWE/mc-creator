import { describe, it, expect, vi } from 'vitest';
import { detectJavaVersion } from './jdk.js';

describe('detectJavaVersion', () => {
  it('从 java -version 输出解析主版本', async () => {
    const run = vi.fn().mockResolvedValue('openjdk version "21.0.3" 2024-04-16');
    expect(await detectJavaVersion(run)).toBe(21);
  });

  it('解析 Java 25', async () => {
    const run = vi.fn().mockResolvedValue('openjdk version "25" 2025-09-16');
    expect(await detectJavaVersion(run).catch(() => null) ?? (await detectJavaVersion(run))).toBe(25);
  });

  it('java 不存在返回 null', async () => {
    const run = vi.fn().mockRejectedValue(new Error('not found'));
    expect(await detectJavaVersion(run)).toBeNull();
  });
});
