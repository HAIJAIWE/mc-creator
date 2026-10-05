/**
 * electron-builder.yml 配置守卫测试
 *
 * 为什么放在 apps/desktop/ 根目录而不是 src/：
 *   这是构建期配置，不属于任何运行时模块；src/ 下的内容会被 electron-vite
 *   打进 out/ 并进入 app.asar，放在那里会污染运行时产物。
 *   vitest 未显式配置 include，用的是默认的 test/spec glob，
 *   根目录的该文件可以被 `pnpm --filter @mc-creator/desktop test` 收到。
 *
 * 为什么不用 js-yaml：
 *   本仓库用 pnpm 的严格 node_modules 布局，js-yaml 只是 electron-builder/eslint
 *   的间接依赖，从 apps/desktop 出发 require.resolve('js-yaml') 会抛 MODULE_NOT_FOUND。
 *   为此新增 devDependency 需要同时改 package.json 与 pnpm-lock.yaml，
 *   而当前有多个 agent 并行改动该文件，锁文件竞争风险大于收益。
 *   因此这里用一个「结构化读取」而非完整 YAML 解析器：只做顶层键 + 列表块的
 *   精确匹配，并在结构不符合预期时显式抛错（而非静默跳过）。
 *
 * 覆盖的历史回归：
 *   1. asarUnpack 曾整体缺失 —— 设计文档 §15 硬性要求。
 *   2. `files: [- from: out]` 曾把 out/ 前缀剥掉并漏掉 package.json，
 *      导致 electron-builder sanity check 报
 *      "Application entry file out\main\index.js ... was not found in this archive"。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (rel: string): string => readFileSync(join(here, rel), 'utf8');

/** 去掉整行注释（本文件的注释均为整行，故不影响嵌套结构） */
const stripComments = (yaml: string): string =>
  yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/**
 * 行尾归一化：工作区文件在 Windows checkout（core.autocrlf=true）下是 CRLF，
 * 而仓库 blob 是 LF。下游所有行解析（topLevelScalar 的 `m` 标志 `$`、
 * topLevelList 的 `[ \t]*$`）都卡不住尾随 `\r`，会导致 asarUnpack 读出空数组、
 * 标量读出 undefined —— 在 Windows 本机全红，在 CI（LF）全绿。
 * 实测踩过：一次 `git checkout -- electron-builder.yml` 把工作区翻成 CRLF，
 * 本用例随即全红，而 yml 内容本身一个字符没变。
 */
const yaml = stripComments(readText('electron-builder.yml').replace(/\r/g, ''));

/** 读取顶层标量键，如 asar / npmRebuild */
const topLevelScalar = (key: string): string | undefined => {
  const m = new RegExp(`^${key}:[ \\t]*(\\S+)[ \\t]*$`, 'm').exec(yaml);
  return m?.[1];
};

/**
 * 读取顶层键下面的「一级缩进」列表项，如 asarUnpack: 下的 - xxx
 * 只收集缩进恰好比父键多一格的 '- '，避免误收嵌套结构。
 */
const topLevelList = (key: string): string[] => {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return [];
  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break; // 回到顶层 -> 列表结束
    const m = /^\s+-[ \t]+['"]?(.+?)['"]?[ \t]*$/.exec(line);
    if (m) items.push(m[1]!);
  }
  return items;
};

/** 读取顶层键下面任意深度的块文本 */
const blockOf = (key: string): string => {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
};

/**
 * optionalDependencies 里列出的都是本项目认定的「可选原生/运行时依赖」。
 * 新增原生模块时这个清单会自动变化，逼迫同步更新 asarUnpack。
 */
const NATIVE_MODULE_HINT = /optionalDependencies/;

describe('electron-builder.yml 打包配置', () => {
  it('asar 必须开启（设计文档 §15）', () => {
    expect(topLevelScalar('asar')).toBe('true');
  });

  it('asarUnpack 必须存在且覆盖 optionalDependencies 里的每个原生模块', () => {
    const unpack = topLevelList('asarUnpack');
    expect(unpack.length).toBeGreaterThan(0);

    const pkg = JSON.parse(readText('package.json')) as {
      optionalDependencies?: Record<string, string>;
    };
    const natives = Object.keys(pkg.optionalDependencies ?? {});
    expect(natives.length).toBeGreaterThan(0);
    expect(
      pkg.optionalDependencies && NATIVE_MODULE_HINT.test('optionalDependencies'),
    ).toBeTruthy();

    for (const name of natives) {
      // 必须匹配到目录**末尾**：`node_modules/${name}/` 是子串匹配，
      // 所以 @mc-creator 会被 @mc-creator/jobobject 的那条 glob 误判为已覆盖。
      // 那种误判很难发现 —— 真正的 jobobject 仍未解包，而这条断言是绿的。
      // 断言意图（每个原生模块都被覆盖）未变，只是判据不再自欺。
      const covered = unpack.some((g) => g.includes(`node_modules/${name}/**`));
      expect(covered, `原生模块 ${name} 未被 asarUnpack 覆盖，会被打进 asar 导致 dlopen 失败`).toBe(
        true,
      );
    }
  });

  it('asarUnpack 用精确模块路径，不用会误伤无关二进制的宽泛 glob', () => {
    const unpack = topLevelList('asarUnpack');
    expect(unpack).not.toContain('**/*.node');
    for (const g of unpack) {
      // 必须精确到包目录，且允许 scoped 包名（@scope/name）。
      //
      // 为什么必须放行 @scope/：§8.3 引入的 @mc-creator/jobobject 是 scoped 包，
      // 路径是 node_modules/@mc-creator/jobobject/**。原来的
      // `[^/]+` 匹配不到它（'@mc-creator' 后面还有一级），于是这条断言会
      // 拒绝唯一正确的写法 —— 逼人改用宽泛 glob 或干脆不解包，
      // 后者会让 dlopen 失败、打包出来的应用启动即崩（MEMORY §2-①② 的同类坑）。
      //
      // 断言意图未变：仍然拒绝 '**/*.node' 这类会误伤无关二进制的宽泛写法。
      expect(g, `asarUnpack 条目 ${g} 过于宽泛`).toMatch(
        /^\*\*\/node_modules\/(?:@[^/]+\/)?[^/]+\/\*\*$/,
      );
    }
  });

  it('files 不把「排除 node_modules」写在顶层（会污染 node_modules 收集器）', () => {
    // 顶层 '!' 开头的字符串会被 app-builder-lib 的 getNodeModuleFileMatcher 收走
    // （它只收 from 为 null/'.' 的对象，和所有 '!' 开头的字符串），
    // 进而把生产依赖整体排除。排除规则必须收在 from/to 对象形式的 filter 内部。
    const filesLines = blockOf('files').split('\n');
    // files 下第一层列表项的缩进，作为「顶层」基准
    const firstItem = filesLines.find((l) => /^\s+-\s/.test(l));
    expect(firstItem, 'files 下未找到任何列表项，结构可能已变').toBeDefined();
    const topIndent = firstItem!.match(/^(\s*)/)![1]!.length;

    const leaked = filesLines.filter((l) => {
      const m = /^(\s*)-\s*['"]?(![^'"]*)['"]?\s*$/.exec(l);
      return m !== null && m[1]!.length === topIndent;
    });

    expect(
      leaked.map((l) => l.trim()),
      'files 顶层出现了 ! 排除规则，它会同时作用于 node_modules 收集器',
    ).toEqual([]);
  });

  it('files 保留 out/ 前缀并显式带上 package.json', () => {
    const filesBlock = blockOf('files');
    // 少了 to: out，out/main/index.js 会变成 main/index.js，main 字段解析不到
    expect(filesBlock).toMatch(/from:\s*out/);
    expect(filesBlock).toMatch(/to:\s*out/);
    // from 写成对象形式时 electron-builder 不会自动补 package.json
    expect(filesBlock).toMatch(/package\.json/);
  });

  it('npmRebuild 必须显式关闭：isolated-vm 无法针对 Electron 44 编译', () => {
    // 见 electron-builder.yml 内注释：保持默认 true 时
    // electron-builder --dir 会因 isolated-vm 编译失败而中断整个打包。
    expect(topLevelScalar('npmRebuild')).toBe('false');
  });
});
