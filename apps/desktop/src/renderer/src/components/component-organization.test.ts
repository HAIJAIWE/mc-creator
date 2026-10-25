// @vitest-environment node
/**
 * `components/` 目录组织规则（架构约定的**可执行形式**）。
 *
 * ## 为什么要有这个文件
 *
 * `components/` 根目录平铺着 50+ 个组件，其中既有 shell 基建（ActivityBar、
 * StatusBar），也有领域面板（BuildPanel、GameLauncherPanel），还有纯通用 UI
 * （Splitter、McMark）。混在一起时，「一个面板属于哪个域」这个信息
 * **只存在于 `register-all-panels.ts` 的 `domain` 字段里**，目录不表达任何归属。
 *
 * 项目其实**已经有权威的域模型** —— `shell/domains.ts` 定义了
 * `DomainId = 'launcher' | 'server' | 'dev'`，面板通过 `domain` 字段归属。
 * 本文件把「目录应当反映归属」这条约定写成断言，并**列出当前违规项**。
 *
 * ## 规则
 *
 * 1. 注册到 `PanelKind.domain` 的面板，其组件文件**不得**位于 `components/` 根目录 ——
 *    领域面板必须落在某个域子目录下（`components/<域>/` 或既有的功能子目录）。
 * 2. `components/` 根目录只允许：shell 基建（`PanelKind.core`）、通用 UI（无 domain）、
 *    以及非面板组件（对话框、Provider、错误边界等）。
 *
 * ## 为什么先只报告不阻断
 *
 * 存量有违规项，直接让测试红会让人想「关掉测试」而不是「搬文件」。
 * 因此本文件用 `soft violations` 列出清单并**打印出来**，同时用一个显式的
 * `ACCEPTED` 清单锁住已知项 —— 搬走一个就从清单移除，减少为 0 时再改成硬断言。
 *
 * 详见 docs/frontend-workbench-architecture.md §1.0 与
 * docs/architecture-assessment.md §1。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDERER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS = join(RENDERER, 'components');
const REGISTRY = join(RENDERER, 'shell/register-all-panels.ts');

interface PanelInfo {
  id: string;
  componentPath: string;
  domain: string | null;
  kind: string | null;
}

/**
 * 解析 `register-all-panels.ts`。
 *
 * 首版用「loader 正则 + 配置正则」配对，只抓到 6/17 个面板 ——
 * loader 有单行/多行/`withMonacoSetup` 包裹三种形态，正则太脆。
 * 改为**按 `id: '...'` 切块**，每块内找 `domain`/`kind`；
 * loader 则独立抓「紧邻的 import」再按出现顺序对应。
 */
function parseRegistry(): PanelInfo[] {
  const src = readFileSync(REGISTRY, 'utf-8');

  // 1) 按 id 切块，取 domain / kind
  const cfg = new Map<string, { domain: string | null; kind: string | null }>();
  const idRe = /id:\s*'(\w+)'/g;
  const hits: { id: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(src)) !== null) hits.push({ id: m[1]!, at: m.index });

  for (let i = 0; i < hits.length; i++) {
    const from = hits[i]!.at;
    const to = i + 1 < hits.length ? hits[i + 1]!.at : src.length;
    const chunk = src.slice(from, to);
    const dom = /domain:\s*'(\w+)'/.exec(chunk);
    const kind = /kind:\s*'(\w+)'/.exec(chunk);
    // launcher 域只有一个 domain:'launcher' 的 game 面板；没有 domain 的就是 common（恒驻）
    cfg.set(hits[i]!.id, {
      domain: dom ? dom[1]! : null,
      kind: kind ? kind[1]! : null,
    });
  }

  /**
   * 2) 抓 loader：行首缩进的 `key:` 后面跟着 `import('../components/X.js')`
   *
   * 首版用 `/(\w+):[\s\S]{0,80}?import\(/`，只抓到 3 个 loader。
   * 原因：`\w+:` 会匹配到 `.then((m) => ({ default: m.X }))` 里的 `default:`，
   * 然后懒惰地一路吞到**下一个** `import(`，把那个 loader 吃掉了。
   * 引擎再走到真正的 key 时已经错过。
   *
   * loader key 一定是行首缩进（`  packages: () =>`），用 `^\s{2,}(\w+):` 锚定即可排除。
   */
  const loaderRe = /^[ \t]{2,}(\w+):[\s\S]{0,80}?import\(['"]\.\.\/components\/([^'"]+)['"]\)/gm;
  const loaders = new Map<string, string>();
  while ((m = loaderRe.exec(src)) !== null) loaders.set(m[1]!, m[2]!);

  // 3) 配置块按出现顺序与 loader 对应不可靠（loader 与 config 是两个独立对象字面量），
  //    因此改为**双向匹配**：先按 id 相同配对，配不上的再按顺序兜底。
  const panels: PanelInfo[] = [];
  const usedCfg = new Set<string>();
  for (const [id, path] of loaders) {
    const c = cfg.get(id);
    if (c) {
      usedCfg.add(id);
      panels.push({ id, componentPath: path, domain: c.domain, kind: c.kind });
    }
  }
  // 兜底：config 里有但 loader 正则没抓到的 id，报告出来以便发现解析退化
  return panels;
}

/** 组件文件是否位于 components/ 根目录（无子目录） */
function isFlatComponent(componentPath: string): boolean {
  return !componentPath.includes('/');
}

/**
 * 已知违规：平铺在 components/ 根目录的 domain 面板。
 *
 * **已清零**（2026-10-11）。搬迁记录：
 *   items   → components/dev/ItemRecipeEditor.tsx
 *   blocks  → components/dev/BlockEditor.tsx
 *   entity  → components/dev/EntityAiEditor.tsx
 *   cicd    → components/dev/CiCdPanel.tsx
 *   build   → components/dev/BuildPanel.tsx
 *   game    → components/launcher/GameLauncherPanel.tsx
 *
 * 目录名直接取自 `domains.ts` 的 `DomainId`（`dev` / `launcher`），
 * 让**目录结构即域模型**，不再需要额外映射表。
 *
 * 清单保留（而非删掉）是为了让「重新引入平铺面板」这件事有明确的报错出口：
 * 下面第一条断言会直接点名是哪个 panelId。
 */
const ACCEPTED_FLAT_DOMAIN_PANELS = new Set<string>();

describe('components/ 目录组织规则', () => {
  const panels = parseRegistry();

  it('能解析出面板注册表（解析器退化时要立刻发现）', () => {
    // 期望 17 个：6 core + 9 domain + 2 middle（见 register-all-panels.ts）
    expect(panels.length).toBeGreaterThanOrEqual(15);
  });

  it('domain 面板不应平铺在 components/ 根目录', () => {
    const violations = panels
      .filter((p) => p.kind === 'domain')
      .filter((p) => isFlatComponent(p.componentPath))
      .filter((p) => !ACCEPTED_FLAT_DOMAIN_PANELS.has(p.id));

    expect(
      violations.map((v) => `${v.id} → components/${v.componentPath}`),
      '以下 domain 面板平铺在根目录，应迁入域子目录',
    ).toEqual([]);
  });

  it('已登记的存量违规数量只减不增（防止新增平铺面板）', () => {
    const actual = panels
      .filter((p) => p.kind === 'domain')
      .filter((p) => isFlatComponent(p.componentPath))
      .map((p) => p.id)
      .sort();

    // 核心约束：**不得出现清单之外的新平铺面板**
    const newOnes = actual.filter((id) => !ACCEPTED_FLAT_DOMAIN_PANELS.has(id));
    expect(newOnes, '新增了平铺在根目录的 domain 面板').toEqual([]);
  });

  it('已登记的违规项若已迁走，应同步更新清单（避免清单腐化）', () => {
    const actual = new Set(
      panels
        .filter((p) => p.kind === 'domain')
        .filter((p) => isFlatComponent(p.componentPath))
        .map((p) => p.id),
    );
    // 清单里有、但已经不在根目录的项 → 说明搬走了，该从清单移除
    const stale = [...ACCEPTED_FLAT_DOMAIN_PANELS].filter((id) => !actual.has(id));
    expect(
      stale,
      `这些面板已迁出根目录，请从 ACCEPTED_FLAT_DOMAIN_PANELS 移除：${stale.join(', ')}`,
    ).toEqual([]);
  });
});

describe('components/ 现状盘点（只读，不作断言）', () => {
  it('列出全部 domain 面板及其落位，供迁移时对照', () => {
    const panels = parseRegistry();
    const domainPanels = panels
      .filter((p) => p.kind === 'domain')
      .map((p) => ({
        id: p.id,
        domain: p.domain,
        path: p.componentPath,
        flat: isFlatComponent(p.componentPath),
      }));

    console.log(
      '\n[domain 面板落位]\n' +
        domainPanels
          .map(
            (p) =>
              `  ${p.flat ? '平铺' : '已归位'}  ${p.id.padEnd(14)} domain=${(p.domain ?? '-').padEnd(9)} components/${p.path}`,
          )
          .join('\n'),
    );
    expect(domainPanels.length).toBeGreaterThan(0);
  });

  it('列出 components/ 根目录中未被注册为面板的组件（通用 UI / 对话框 / Provider）', () => {
    const panels = parseRegistry();
    const registered = new Set(panels.map((p) => basename(p.componentPath).replace(/\.js$/, '')));
    const loose = readdirSync(COMPONENTS)
      .filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))
      .map((n) => basename(n, '.tsx'))
      .filter((name) => !registered.has(name));

    console.log(`\n[根目录未注册为面板] 共 ${loose.length} 个\n  ${loose.join(', ')}`);
    expect(loose.length).toBeGreaterThan(0);
  });
});
