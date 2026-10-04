// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { commitVersion, loadHistory, deleteVersion, clearHistory } from './skin-history.js';

const DATA_URL_A = 'data:image/png;base64,AAA';
const DATA_URL_B = 'data:image/png;base64,BBB';

describe('skin-history store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('提交后可按玩家名读取，新版本在前', () => {
    commitVersion('Steve', DATA_URL_A, '初版');
    commitVersion('Steve', DATA_URL_B, '改了衣服');
    const list = loadHistory('Steve');
    expect(list).toHaveLength(2);
    expect(list[0]?.dataUrl).toBe(DATA_URL_B);
    expect(list[1]?.dataUrl).toBe(DATA_URL_A);
    // 其他玩家隔离
    expect(loadHistory('Alex')).toHaveLength(0);
  });

  it('超过 20 个版本时裁剪最旧的', () => {
    for (let i = 0; i < 25; i++) {
      commitVersion('Steve', `${DATA_URL_A}${i}`, `v${i}`);
    }
    const list = loadHistory('Steve');
    expect(list).toHaveLength(20);
    expect(list[0]?.message).toBe('v24');
  });

  it('删除与清空', () => {
    const v = commitVersion('Steve', DATA_URL_A, '待删');
    commitVersion('Steve', DATA_URL_B, '保留');
    const afterDelete = deleteVersion('Steve', v.id);
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0]?.dataUrl).toBe(DATA_URL_B);
    clearHistory('Steve');
    expect(loadHistory('Steve')).toHaveLength(0);
  });

  it('空 message 时自动生成版本说明', () => {
    const v = commitVersion('Steve', DATA_URL_A, '');
    expect(v.message.length).toBeGreaterThan(0);
  });

  it('skin 与 cape 作用域相互隔离', () => {
    commitVersion('Steve', DATA_URL_A, '皮肤版', 'skin');
    commitVersion('Steve', DATA_URL_B, '披风版', 'cape');
    const skinList = loadHistory('Steve', 'skin');
    const capeList = loadHistory('Steve', 'cape');
    expect(skinList).toHaveLength(1);
    expect(skinList[0]?.dataUrl).toBe(DATA_URL_A);
    expect(capeList).toHaveLength(1);
    expect(capeList[0]?.dataUrl).toBe(DATA_URL_B);
    // 默认 scope 即 skin（兼容老版本）
    expect(loadHistory('Steve')).toHaveLength(1);
  });

  it('cape 作用域独立删除', () => {
    const v = commitVersion('Steve', DATA_URL_B, '披风版', 'cape');
    commitVersion('Steve', DATA_URL_A, '皮肤版', 'skin');
    deleteVersion('Steve', v.id, 'cape');
    expect(loadHistory('Steve', 'cape')).toHaveLength(0);
    expect(loadHistory('Steve', 'skin')).toHaveLength(1);
  });
});
