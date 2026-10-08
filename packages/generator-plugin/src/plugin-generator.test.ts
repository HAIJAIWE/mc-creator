/**
 * generator-plugin 单元测试（设计文档 §7.3 / §10.3 / §11 P1）。
 * 全内存断言，不触网、不调 Gradle、不启服务端。
 */
import { describe, expect, it } from 'vitest';
import type { FileNode } from '@mc-creator/shared';
import { API_VERSION_PLACEHOLDER, PluginSpecSchema, type PluginSpec } from './plugin-spec.js';
import {
  LEGACY_MANIFEST_PATH,
  PAPER_MANIFEST_PATH,
  generatePlugin,
  mainClassFqn,
  mainClassPath,
  resolveFoliaSupported,
} from './plugin-generator.js';
import { validatePluginStructure } from './validate.js';

function baseSpec(overrides: Partial<PluginSpec> = {}): PluginSpec {
  return {
    name: 'HelloPlugin',
    pluginId: 'hello-plugin',
    version: '1.0.0',
    description: '打招呼插件',
    author: 'tester',
    apiVersion: API_VERSION_PLACEHOLDER,
    target: 'paper',
    foliaSupported: false,
    commands: [{ name: 'hello', description: '打招呼', usage: '/hello', permission: 'hello.use' }],
    permissions: [{ name: 'hello.use', description: '允许打招呼', default: 'true' }],
    mainClass: 'HelloPlugin',
    namespace: 'com.example.hello',
    ...overrides,
  };
}

function manifestOf(files: FileNode[], path: string): string {
  const hit = files.find((f) => f.path === path);
  if (hit === undefined) throw new Error(`缺失产物文件 ${path}`);
  return hit.content;
}

describe('generatePlugin 文件清单', () => {
  it('产出 6 个文件，路径清单快照一致', () => {
    const paths = generatePlugin(baseSpec())
      .map((f) => f.path)
      .sort();
    expect(paths).toEqual(
      [
        'README.md',
        'build.gradle',
        'config.yml',
        'src/main/java/com/example/hello/HelloPlugin.java',
        LEGACY_MANIFEST_PATH,
        PAPER_MANIFEST_PATH,
      ].sort(),
    );
  });

  it('paper 目标透传 foliaSupported=false', () => {
    const files = generatePlugin(baseSpec({ target: 'paper', foliaSupported: false }));
    expect(manifestOf(files, PAPER_MANIFEST_PATH)).toContain('folia-supported: false');
    expect(resolveFoliaSupported({ target: 'paper', foliaSupported: false })).toBe(false);
  });

  it('paper 目标透传 foliaSupported=true', () => {
    const files = generatePlugin(baseSpec({ target: 'paper', foliaSupported: true }));
    expect(manifestOf(files, PAPER_MANIFEST_PATH)).toContain('folia-supported: true');
  });

  it('folia 目标强制 folia-supported: true（即使输入 false）', () => {
    const files = generatePlugin(baseSpec({ target: 'folia', foliaSupported: false }));
    expect(manifestOf(files, PAPER_MANIFEST_PATH)).toContain('folia-supported: true');
    expect(resolveFoliaSupported({ target: 'folia', foliaSupported: false })).toBe(true);
  });

  it('spigot 目标强制 folia-supported: false（即使输入 true）', () => {
    const files = generatePlugin(baseSpec({ target: 'spigot', foliaSupported: true }));
    expect(manifestOf(files, PAPER_MANIFEST_PATH)).toContain('folia-supported: false');
    expect(resolveFoliaSupported({ target: 'spigot', foliaSupported: true })).toBe(false);
  });

  it('主类路径与 mainClass/namespace 对应，包名与类名一致', () => {
    const spec = baseSpec();
    expect(mainClassPath(spec)).toBe('src/main/java/com/example/hello/HelloPlugin.java');
    expect(mainClassFqn(spec)).toBe('com.example.hello.HelloPlugin');
    const java = manifestOf(generatePlugin(spec), mainClassPath(spec));
    expect(java).toContain('package com.example.hello;');
    expect(java).toContain('class HelloPlugin extends JavaPlugin');
  });

  it('主类含 onEnable/onDisable 日志行（§10.3 判据 grep 点：enabled）', () => {
    const java = manifestOf(generatePlugin(baseSpec()), mainClassPath(baseSpec()));
    expect(java).toContain('onEnable()');
    expect(java).toContain('onDisable()');
    expect(java).toContain('enabled');
    expect(java).toContain('disabled');
  });

  it('主类含 Folia 运行时检测与 regionised scheduler 注释分支', () => {
    const java = manifestOf(generatePlugin(baseSpec()), mainClassPath(baseSpec()));
    expect(java).toContain('io.papermc.paper.threadedregions.RegionizedServer');
    expect(java).toContain('Class.forName');
    expect(java).toContain('regionised scheduler');
  });

  it('命令/权限透传到两份清单', () => {
    const files = generatePlugin(baseSpec());
    for (const p of [PAPER_MANIFEST_PATH, LEGACY_MANIFEST_PATH]) {
      const yml = manifestOf(files, p);
      expect(yml).toContain('hello:');
      expect(yml).toContain('/hello');
      expect(yml).toContain('hello.use');
      expect(yml).toContain('default: true');
    }
  });

  it('build.gradle 为 paperweight 占位并注明 devkit 接管真实构建', () => {
    const gradle = manifestOf(generatePlugin(baseSpec()), 'build.gradle');
    expect(gradle).toContain('paperweight');
    expect(gradle).toContain('devkit');
    expect(gradle).toContain('runGradleBuild');
    expect(gradle).toContain('paper-api');
  });

  it('README 含 deploy_plugin→restart→read_logs 部署闭环说明', () => {
    const readme = manifestOf(generatePlugin(baseSpec()), 'README.md');
    expect(readme).toContain('deploy_plugin');
    expect(readme).toContain('restart_server');
    expect(readme).toContain('read_logs');
    expect(readme).toContain('永不自动加载进正式服');
  });

  it('paper 与 folia 产物均通过结构校验', () => {
    for (const target of ['paper', 'folia', 'spigot'] as const) {
      const files = generatePlugin(
        baseSpec({ target, foliaSupported: target === 'folia' ? false : target === 'paper' }),
      );
      // 注意：folia 目标会带一条 warnings（folia-supported 键未经官方源确认，
      // 见 validate.ts 第 3 条与 §21 #10 核实记录）。**errors 必须为空**，
      // 但不能整体 toEqual —— 那会把 warnings 也钉死成空，等于把「未确认」
      // 变成「已确认不存在」。这里只断言 errors。
      const r = validatePluginStructure(files);
      expect(r.errors, target).toEqual([]);
      expect(r.ok, target).toBe(true);
    }
  });
});

describe('PluginSpecSchema', () => {
  it('apiVersion 必填：缺失时 parse 失败（§0.5 运行时拉取，包内无默认值）', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiVersion, ...rest } = baseSpec();
    expect(() => PluginSpecSchema.parse(rest)).toThrow();
  });

  it('apiVersion 26.1.2 可通过格式校验（§7.3 新版本号）', () => {
    const files = generatePlugin(baseSpec({ apiVersion: '26.1.2' }));
    expect(validatePluginStructure(files).ok).toBe(true);
    expect(manifestOf(files, PAPER_MANIFEST_PATH)).toContain('api-version: 26.1.2');
  });
});

describe('validatePluginStructure', () => {
  it('缺 paper-plugin.yml 则失败（中文错误）', () => {
    const files = generatePlugin(baseSpec()).filter((f) => f.path !== PAPER_MANIFEST_PATH);
    const r = validatePluginStructure(files);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('paper-plugin.yml'))).toBe(true);
  });

  it('缺 plugin.yml 则失败', () => {
    const files = generatePlugin(baseSpec()).filter((f) => f.path !== LEGACY_MANIFEST_PATH);
    const r = validatePluginStructure(files);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('plugin.yml'))).toBe(true);
  });

  it('apiVersion 非法则失败', () => {
    const files = generatePlugin(baseSpec()).map((f) =>
      f.path === PAPER_MANIFEST_PATH || f.path === LEGACY_MANIFEST_PATH
        ? {
            ...f,
            content: f.content.replace(
              `api-version: ${API_VERSION_PLACEHOLDER}`,
              'api-version: abc',
            ),
          }
        : f,
    );
    const r = validatePluginStructure(files);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('api-version') && e.includes('格式非法'))).toBe(true);
  });

  it('folia 目标未声明 folia-supported 走**告警**而非失败（§21 #10：该键无法从权威源确认）', () => {
    // 这条断言原来要求「失败」（硬开关）。核实后降级为告警，原因：
    // `folia-supported` 在 Paper 文档、Folia 文档、Paper 源码 PluginDescriptionFile
    // （plugin.yml 的 22 个权威键）、PluginMeta（paper-plugin.yml 模型）、
    // Paper 全树 5520 文件、以及 paper-api / 服务端 jar 常量池中**均不存在**。
    // 拿一个无法确认存在的键去否决用户的构建，正是 MEMORY §7.2 / §6.4 同类的
    // 「按想象造格式」。所以：仍生成该键（无害，未知键会被 YAML 忽略），
    // 但不拿它当门禁。
    const files = generatePlugin(baseSpec({ target: 'folia' })).map((f) =>
      f.path === PAPER_MANIFEST_PATH
        ? { ...f, content: f.content.replace('folia-supported: true', 'folia-supported: false') }
        : f,
    );
    const r = validatePluginStructure(files);
    // 不再失败
    expect(r.ok, '未确认存在的键不应阻断构建').toBe(true);
    expect(r.errors.some((e) => e.includes('folia-supported'))).toBe(false);
    // 但必须有告警，且告警要说明「无法确认」而不是空口断言
    const w = r.warnings.filter((x) => x.includes('folia-supported'));
    expect(w.length).toBeGreaterThan(0);
    expect(w.join('\n')).toContain('无法从');
  });

  it('folia 目标已声明 folia-supported 时同样给「未经官方源确认」告警', () => {
    const files = generatePlugin(baseSpec({ target: 'folia' }));
    const r = validatePluginStructure(files);
    expect(r.ok).toBe(true);
    // 即使声明了也要提醒 —— 因为无法确认它被识别，声明了不等于有效
    expect(r.warnings.join('\n')).toContain('未经官方源确认');
  });

  it('非 folia 目标不产生 folia-supported 相关告警', () => {
    for (const target of ['paper', 'spigot'] as const) {
      const r = validatePluginStructure(
        generatePlugin(baseSpec({ target, foliaSupported: target === 'paper' })),
      );
      expect(r.ok, target).toBe(true);
      expect(r.warnings.filter((x) => x.includes('folia-supported')).length, target).toBe(0);
    }
  });

  it('main 类路径与清单不一致则失败', () => {
    const files = generatePlugin(baseSpec()).map((f) =>
      f.path === PAPER_MANIFEST_PATH || f.path === LEGACY_MANIFEST_PATH
        ? {
            ...f,
            content: f.content.replace(
              'com.example.hello.HelloPlugin',
              'com.example.hello.Renamed',
            ),
          }
        : f,
    );
    const r = validatePluginStructure(files);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Renamed'))).toBe(true);
  });
});
