// @vitest-environment node
/**
 * NeoForge 26.x（FML 12 生产模式）的启动参数处理。
 *
 * 这套参数是**实测**出来的：少 `--fml.neoForgeVersion` 或
 * `-DlibraryDirectory` 时，FML 12 直接拒绝启动（见 neoforge-launch.ts 的注释）。
 */
import { describe, it, expect } from 'vitest';

import { parseNeoForgeLaunchSpec, substituteProfileArgs } from './neoforge-launch.js';

describe('neoforge-launch · NeoForge 26.x 启动参数', () => {
  describe('parseNeoForgeLaunchSpec', () => {
    it('从档案 arguments.game 里取出三个版本参数（实测档案的形状）', () => {
      const spec = parseNeoForgeLaunchSpec([
        '--fml.neoForgeVersion',
        '26.3.0.95',
        '--fml.mcVersion',
        '26.3',
        '--fml.neoFormVersion',
        '1',
      ]);
      expect(spec).toEqual({
        neoForgeVersion: '26.3.0.95',
        mcVersion: '26.3',
        neoFormVersion: '1',
      });
    });

    it('缺任何一个参数 → null（而不是拿空串去拼命令）', () => {
      expect(parseNeoForgeLaunchSpec(['--fml.neoForgeVersion', '26.3.0.95'])).toBeNull();
      expect(parseNeoForgeLaunchSpec([])).toBeNull();
    });

    it('参数后面没有值 → null', () => {
      expect(parseNeoForgeLaunchSpec(['--fml.neoForgeVersion'])).toBeNull();
      expect(parseNeoForgeLaunchSpec(['--fml.neoForgeVersion', ''])).toBeNull();
    });
  });

  describe('substituteProfileArgs', () => {
    it('替换已知占位符', () => {
      expect(
        substituteProfileArgs(
          ['-DlibraryDirectory=${library_directory}', '--gameDir', '${game_directory}'],
          { library_directory: 'C:/libs', game_directory: 'C:/game' },
        ),
      ).toEqual(['-DlibraryDirectory=C:/libs', '--gameDir', 'C:/game']);
    });

    it('未知占位符 → **整条参数丢掉**（不把 ${…} 字面量交给 JVM）', () => {
      expect(
        substituteProfileArgs(['-cp', '${classpath}', '--version', '${version_name}'], {
          version_name: '26.3',
        }),
      ).toEqual(['--version', '26.3']);
    });

    it('丢掉取值参数时，连带丢掉前一个开关（孤零零的 -cp 更糟）', () => {
      expect(substituteProfileArgs(['--add-opens', '${unknown}'], {})).toEqual([]);
    });

    it('没有占位符的参数原样保留', () => {
      expect(
        substituteProfileArgs(['--add-opens', 'java.base/java.lang.invoke=ALL-UNNAMED'], {}),
      ).toEqual(['--add-opens', 'java.base/java.lang.invoke=ALL-UNNAMED']);
    });

    it('空占位符值也算已知（替换成空串）', () => {
      expect(substituteProfileArgs(['--x=${auth_xuid}'], { auth_xuid: '' })).toEqual(['--x=']);
    });
  });
});
