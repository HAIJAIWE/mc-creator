import { describe, it, expect } from 'vitest';

import { LOADERS } from '@mc-creator/shared';

import { InstanceLoader, LauncherInstallLoaderRequest, ModLoader } from './ipc/launcher.js';
import { PLAY_LOADER_FILTERS } from './play-loaders.js';

/**
 * 「玩游戏时装哪个加载器」的筛选清单。
 *
 * 这些断言的价值不在「复述常量」—— 而在**卡住两类静默错误**：
 *
 * 1. **拼错**。筛选器的值是直接塞进请求 / 用来比对 `modLoaderNames` 的，
 *    写成 `neofoge` 不会有任何编译错误，只是永远搜不到东西（也永远筛不出
 *    文件），现象是「这个筛选器坏了」。
 * 2. **顺手放宽**。把 Forge / Quilt 加回来是个**产品决定**（要连带改文档里
 *    那段「为什么只有两个」的实测依据），不该由一次「顺手补全」完成。
 *    所以这里断言的是**确切集合**，改清单就必须改测试，逼出一次有意识的决定。
 */
describe('PLAY_LOADER_FILTERS · 下载侧开放的加载器', () => {
  it('每一项都得是外部 API 认的 loader（ModLoader 枚举）', () => {
    for (const l of PLAY_LOADER_FILTERS) {
      expect(ModLoader.safeParse(l).success, `${l} 不在 ModLoader 枚举里，筛选器会静默失效`).toBe(
        true,
      );
    }
  });

  it('每一项都得在 shared 的全量 LOADERS 里', () => {
    for (const l of PLAY_LOADER_FILTERS) {
      expect(LOADERS as readonly string[], `${l} 不在 LOADERS 里`).toContain(l);
    }
  });

  it('确切就是 NeoForge + Fabric（放宽是产品决定，得同时改文档与这条测试）', () => {
    expect([...PLAY_LOADER_FILTERS].sort()).toEqual(['fabric', 'neoforge']);
  });

  it('没有重复项', () => {
    expect(new Set(PLAY_LOADER_FILTERS).size).toBe(PLAY_LOADER_FILTERS.length);
  });

  it('不含「全部」之类的哨兵值 —— 哨兵是 UI 自己映射的，不该混进清单', () => {
    for (const sentinel of ['all', '', 'any', 'vanilla']) {
      expect(PLAY_LOADER_FILTERS as readonly string[]).not.toContain(sentinel);
    }
  });

  /**
   * 下面两条把「策略」钉在「契约」上。
   *
   * schema 是契约（能装哪几个加载器），本清单是策略（UI 认哪几个）。
   * 两者**刻意**互为独立文件 —— 契约改了要影响编译期类型，不该被一个 UI
   * 数组牵着走。但独立久了会分叉，所以用测试把今天的相等关系写下来：
   * 谁单独动了 schema 或清单，这里立刻红，逼出一次有意识的决定。
   */
  it('与 IPC 安装契约完全一致（能装的 = 我们认的）', () => {
    expect([...LauncherInstallLoaderRequest.shape.loader.options].sort()).toEqual(
      [...PLAY_LOADER_FILTERS].sort(),
    );
  });

  it('与实例 loader 字段相容：InstanceLoader = 本清单 + vanilla（原版）', () => {
    expect([...InstanceLoader.options].sort()).toEqual([...PLAY_LOADER_FILTERS, 'vanilla'].sort());
  });
});
