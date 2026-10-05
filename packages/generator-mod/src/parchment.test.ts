import { describe, it, expect } from 'vitest';
import {
  PARCHMENT_VERSIONS,
  parchmentModDevGradleBlock,
  parchmentForgeBlock,
} from './parchment.js';
import type { ParchmentMapping } from './parchment.js';
import { neoforgeBuildGradle } from './neoforge-gradle.js';
import { forgeBuildGradle } from './forge-gradle.js';
import { getLoaderVersions } from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';

/**
 * Parchment 参数名映射配置（§8.4）测试。
 *
 * 核心语义（表驱动，宁缺毋错）：PARCHMENT_VERSIONS 有条目的 MC 版本才输出
 * parchment 块；无条目（返回 null）时两处 build.gradle 输出与原来逐字一致。
 */

const SPEC: ModSpecLike = {
  modId: 'fixture_mod',
  version: '1.0.0',
  name: 'Fixture Mod',
  description: 't6 fixture mod',
  license: 'MIT',
  authors: [],
  credits: '',
  website: '',
  dependencies: [],
  items: [],
  blocks: [],
};

/**
 * 已核实候选版本号（测试夹具；来源见 parchment.ts 文件头注释）。
 * 注意：仅在 withParchmentEntries 作用域内注入，用完恢复，不污染真实表。
 */
const VERIFIED_FIXTURES: Record<string, ParchmentMapping> = {
  '1.20.1': { minecraftVersion: '1.20.1', mappingsVersion: '2023.09.03' },
  '1.21.1': { minecraftVersion: '1.21.1', mappingsVersion: '2024.11.17' },
};

/**
 * 在回调期间临时清空整张表，结束后原样恢复。
 *
 * 用途：表填满后，“无条目→逐字一致”这条规则仍需覆盖。用真实缺条目的版本
 * （如 26.1）反而要新写一套期望模板（Java 大版本/loader 号全不同），
 * 且模板正确性无人背书；清空表后沿用已验证的逐字模板，测的正是同一条规则。
 */
function withEmptyTable(fn: () => void): void {
  const backup: Record<string, ParchmentMapping> = { ...PARCHMENT_VERSIONS };
  for (const key of Object.keys(PARCHMENT_VERSIONS)) {
    delete PARCHMENT_VERSIONS[key];
  }
  try {
    fn();
  } finally {
    for (const [key, prev] of Object.entries(backup)) {
      PARCHMENT_VERSIONS[key] = prev;
    }
  }
}

/** 在回调期间临时注入表条目，结束后原样恢复（有则还原、无则删除）。 */
function withParchmentEntries(entries: Record<string, ParchmentMapping>, fn: () => void): void {
  const backup = new Map<string, ParchmentMapping | undefined>();
  for (const key of Object.keys(entries)) {
    backup.set(key, PARCHMENT_VERSIONS[key]);
    PARCHMENT_VERSIONS[key] = entries[key]!;
  }
  try {
    fn();
  } finally {
    for (const [key, prev] of backup) {
      if (prev === undefined) {
        delete PARCHMENT_VERSIONS[key];
      } else {
        PARCHMENT_VERSIONS[key] = prev;
      }
    }
  }
}

describe('PARCHMENT_VERSIONS 表驱动语义（表里有才输出）', () => {
  it('1.20.1 / 1.21.1：有条目则两处 block 非空并含版本号，无条目则返回 null', () => {
    for (const mc of ['1.20.1', '1.21.1']) {
      const entry = PARCHMENT_VERSIONS[mc] ?? null;
      const mdg = parchmentModDevGradleBlock(mc);
      const fg = parchmentForgeBlock(mc);
      if (entry) {
        expect(mdg).not.toBeNull();
        expect(fg).not.toBeNull();
        expect(mdg!).toContain(`minecraftVersion = "${entry.minecraftVersion}"`);
        expect(mdg!).toContain(`mappingsVersion = "${entry.mappingsVersion}"`);
        expect(fg!).toContain(`${entry.mappingsVersion}-${entry.minecraftVersion}`);
      } else {
        expect(mdg).toBeNull();
        expect(fg).toBeNull();
      }
    }
  });

  it('未知 / 非法 MC 版本一律返回 null', () => {
    for (const mc of ['99.99', '', '26.99-test']) {
      expect(parchmentModDevGradleBlock(mc)).toBeNull();
      expect(parchmentForgeBlock(mc)).toBeNull();
    }
  });

  it('表条目形状为 {minecraftVersion, mappingsVersion}（全表校验）', () => {
    for (const [mc, entry] of Object.entries(PARCHMENT_VERSIONS)) {
      expect(typeof entry.minecraftVersion).toBe('string');
      expect(typeof entry.mappingsVersion).toBe('string');
      expect(entry.minecraftVersion.length).toBeGreaterThan(0);
      expect(entry.mappingsVersion.length).toBeGreaterThan(0);
      expect(mc.length).toBeGreaterThan(0);
    }
  });
});

describe('有条目输出块（注入已核实版本号验证渲染与拼接位置）', () => {
  it('ModDevGradle 块渲染：parchment{minecraftVersion,mappingsVersion} 形状', () => {
    withParchmentEntries(VERIFIED_FIXTURES, () => {
      const block = parchmentModDevGradleBlock('1.21.1')!;
      expect(block).not.toBeNull();
      expect(block).toContain('parchment {');
      expect(block).toContain('minecraftVersion = "1.21.1"');
      expect(block).toContain('mappingsVersion = "2024.11.17"');
    });
  });

  it('Forge 块渲染：mappings channel parchment 配置（注释式 opt-in，不动 official）', () => {
    withParchmentEntries(VERIFIED_FIXTURES, () => {
      const block = parchmentForgeBlock('1.20.1')!;
      expect(block).not.toBeNull();
      expect(block).toContain(`// mappings channel: 'parchment', version: '2023.09.03-1.20.1'`);
    });
  });

  it('legacy moddev 分支（1.21.1）：parchment 块位于内层 neoForge 内、version 之后 runs 之前', () => {
    withParchmentEntries(VERIFIED_FIXTURES, () => {
      const bg = neoforgeBuildGradle(SPEC, '1.21.1', getLoaderVersions('1.21.1')).content;
      expect(bg).toContain('moddev {\n    neoForge {');
      const iNeo = bg.indexOf('neoForge {');
      const iParch = bg.indexOf('parchment {');
      const iRuns = bg.indexOf('runs {');
      const iMods = bg.indexOf('mods {');
      expect(iParch).toBeGreaterThan(iNeo);
      expect(iRuns).toBeGreaterThan(iParch);
      expect(iMods).toBeGreaterThan(iRuns);
      // legacy 包装统一 +4 缩进：块内基准 4 空格变为 8 空格
      expect(bg).toContain('\n        parchment {');
      expect(bg).toContain('\n            minecraftVersion = "1.21.1"');
      expect(bg).toContain('\n            mappingsVersion = "2024.11.17"');
    });
  });

  it('legacy moddev 分支（1.20.x）：同样包在 moddev 内层', () => {
    withParchmentEntries(VERIFIED_FIXTURES, () => {
      const bg = neoforgeBuildGradle(SPEC, '1.20.1', getLoaderVersions('1.20.1')).content;
      expect(bg).toContain('moddev {\n    neoForge {');
      expect(bg).toContain('\n        parchment {');
      expect(bg).toContain('mappingsVersion = "2023.09.03"');
    });
  });

  it('新顶层分支（1.21.5+）：parchment 块位于顶层 neoForge 内（合成映射值，仅验位置）', () => {
    withParchmentEntries(
      { '1.21.5': { minecraftVersion: '1.21.5', mappingsVersion: '2099.01.01-synthetic' } },
      () => {
        const bg = neoforgeBuildGradle(SPEC, '1.21.5', getLoaderVersions('1.21.5')).content;
        expect(bg).toContain('\nneoForge {');
        expect(bg).not.toContain('moddev {');
        const iNeo = bg.indexOf('\nneoForge {');
        const iParch = bg.indexOf('parchment {');
        const iRuns = bg.indexOf('runs {');
        expect(iParch).toBeGreaterThan(iNeo);
        expect(iRuns).toBeGreaterThan(iParch);
        // 顶层分支保持块内基准缩进（4 空格）
        expect(bg).toContain('\n    parchment {');
        expect(bg).toContain('mappingsVersion = "2099.01.01-synthetic"');
      },
    );
  });

  it('Forge minecraft 块：official 行保留，parchment 注释行在其后、runs 之前', () => {
    withParchmentEntries(VERIFIED_FIXTURES, () => {
      const bg = forgeBuildGradle(SPEC, '1.20.1', getLoaderVersions('1.20.1')).content;
      expect(bg).toContain(`mappings channel: 'official', version: '1.20.1'`);
      expect(bg).toContain(`// mappings channel: 'parchment', version: '2023.09.03-1.20.1'`);
      const iOfficial = bg.indexOf(`mappings channel: 'official'`);
      const iParch = bg.indexOf(`mappings channel: 'parchment'`);
      const iRuns = bg.indexOf('runs {');
      expect(iParch).toBeGreaterThan(iOfficial);
      expect(iRuns).toBeGreaterThan(iParch);
    });
  });
});

describe('无条目时输出与原来逐字一致', () => {
  it('neoforge 新顶层分支（表清空模拟无条目）：逐字等于原模板且无 parchment 痕迹', () => {
    withEmptyTable(() => {
      expect(PARCHMENT_VERSIONS['1.21.11'] ?? null).toBeNull();
      const versions = getLoaderVersions('1.21.11');
      const bg = neoforgeBuildGradle(SPEC, '1.21.11', versions).content;
      const expected = `plugins {
    id 'net.neoforged.moddev' version '${versions.neoforgeModdevVersion}'
}

version = '${SPEC.version}'
group = 'com.example.${SPEC.modId}'

base { archivesName = '${SPEC.modId}' }

java.toolchain.languageVersion = JavaLanguageVersion.of(21)

neoForge {
    version = "${versions.neoforgeVersion}"
    runs {
        client { client() }
        server { server() }
    }
    mods {
        "${SPEC.modId}" {
            sourceSet sourceSets.main
        }
    }
}

repositories {
    mavenCentral()
}
`;
      expect(bg).toBe(expected);
      expect(bg.toLowerCase()).not.toContain('parchment');
    });
  });

  it('neoforge legacy 分支（表清空模拟无条目）：逐字等于原模板且无 parchment 痕迹', () => {
    withEmptyTable(() => {
      expect(PARCHMENT_VERSIONS['1.20.4'] ?? null).toBeNull();
      const versions = getLoaderVersions('1.20.4');
      const bg = neoforgeBuildGradle(SPEC, '1.20.4', versions).content;
      const expected = `plugins {
    id 'net.neoforged.moddev' version '${versions.neoforgeModdevVersion}'
}

version = '${SPEC.version}'
group = 'com.example.${SPEC.modId}'

base { archivesName = '${SPEC.modId}' }

java.toolchain.languageVersion = JavaLanguageVersion.of(17)

moddev {
    neoForge {
        version = "${versions.neoforgeVersion}"
        runs {
            client { client() }
            server { server() }
        }
        mods {
            "${SPEC.modId}" {
                sourceSet sourceSets.main
            }
        }
    }
}

repositories {
    mavenCentral()
}
`;
      expect(bg).toBe(expected);
      expect(bg.toLowerCase()).not.toContain('parchment');
    });
  });

  it('forge（表清空模拟无条目）：逐字等于原模板且无 parchment 痕迹', () => {
    withEmptyTable(() => {
      expect(PARCHMENT_VERSIONS['1.20.1'] ?? null).toBeNull();
      const versions = getLoaderVersions('1.20.1');
      const bg = forgeBuildGradle(SPEC, '1.20.1', versions).content;
      const expected = `plugins {
    id 'java'
    id 'net.minecraftforge.gradle' version '${versions.forgeGradleVersion}'
}

version = '${SPEC.version}'
group = 'com.example.${SPEC.modId}'

base {
    archivesName = '${SPEC.modId}'
}

java.toolchain.languageVersion = JavaLanguageVersion.of(17)

minecraft {
    mappings channel: 'official', version: '1.20.1'
    runs {
        client {}
        server {}
    }
}

dependencies {
    minecraft 'net.minecraftforge:forge:1.20.1-${versions.forgeVersion}'
}

repositories {
    mavenCentral()
}
`;
      expect(bg).toBe(expected);
      expect(bg.toLowerCase()).not.toContain('parchment');
    });
  });

  it('注入条目在测试结束后完全恢复（不污染真实表）', () => {
    const before = { ...PARCHMENT_VERSIONS };
    withParchmentEntries(VERIFIED_FIXTURES, () => {
      expect(PARCHMENT_VERSIONS['1.20.1']).toBeDefined();
    });
    expect(PARCHMENT_VERSIONS).toEqual(before);
  });

  it('清空表在测试结束后完全恢复（6 个已核实条目不丢失）', () => {
    const before = { ...PARCHMENT_VERSIONS };
    expect(Object.keys(before).length).toBeGreaterThan(0);
    withEmptyTable(() => {
      expect(Object.keys(PARCHMENT_VERSIONS)).toHaveLength(0);
    });
    expect(PARCHMENT_VERSIONS).toEqual(before);
  });
});
