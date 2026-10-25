// @vitest-environment node
/**
 * `main/credentials/` 边界规则（安全约定的**可执行形式**）。
 *
 * ## 为什么要有这个文件
 *
 * 凭据是本项目**唯一的、真正会出安全事故的资产**：微软 OAuth 的
 * `access_token`/`refresh_token`、AI 模型的 API key、CurseForge token，
 * 全部经由 `secret-storage.ts`（加密落盘）和 `token-redact.ts`（日志脱敏）两个原语。
 *
 * 搬迁前这 9 个模块**平铺在 `main/` 根目录**，与 `process-supervisor.ts`、
 * `file-manager.ts` 等普通基础设施混在一起。后果不是「不好看」，而是：
 *
 * > 审计「哪些代码碰得到用户的凭据」时，没有任何一个目录能回答这个问题。
 * 你得打开全部 34 个文件逐个 grep。而grep 结果还容易被漏看
 * —— 因为**没有测试会在有人违规时变红**。
 *
 * 本文件把这个边界写成断言。
 *
 * ## 规则
 *
 * 1. **凭据原语封闭**：`secret-storage` 与 `token-redact` 只能被
 *    `main/credentials/` 内的文件引用。簇外代码需要凭据时，走 credentials
 *    暴露的业务函数（如 `loadModelConfig()`），不得直接触碰加密/脱敏原语。
 * 2. **簇内模块不得搬回根目录**：9 个模块必须都在 `credentials/` 下。
 *
 * ## 为什么这里不给测试豁免
 *
 * `packages/agent/src/layering.test.ts` 明确豁免测试文件，因为集成测试天然跨层。
 * 本文件**不豁免**：测试触碰 `secret-storage` 并不是「跨层」，而是同样在处理真实凭据
 * —— 搬迁前实测集群外引用为 **0**（含测试），规则今天就能全量生效。
 *
 * ## 现状
 *
 * 搬迁（2026-10-11）前实测的三条事实，构成本文件的断言依据：
 *   - `secret-storage` 的生产使用方：model-config、curseforge-config、mc-account-store
 *   - `token-redact`   的生产使用方：ms-oauth、ms-auth-service、mc-account-service
 *   - 凭据字面量（`access_token`/`refresh_token`/`client_secret`）仅出现在 3 个文件
 *
 * 详见 docs/architecture-assessment.md §10。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = resolve(dirname(fileURLToPath(import.meta.url)));
const CREDENTIALS = join(MAIN, 'credentials');

/** 凭据原语：簇内其他模块、以及未来的任何代码，都不得绕过它们自建加密/脱敏 */
const CREDENTIAL_PRIMITIVES = ['secret-storage', 'token-redact'];

/**
 * 凭据簇的全部模块。
 *
 * 来源不是拍脑袋，而是三条可复算的证据（见文件头「现状」）：
 *   1. 直接依赖两个原语的
 *   2. 持有 `access_token` / `refresh_token` / `client_secret` 字面量的
 *   3. 上述两者的传递闭包（ms-oauth ← ms-auth-service ← …）
 */
const CREDENTIAL_CLUSTER = [
  'secret-storage',
  'token-redact',
  'model-config',
  'curseforge-config',
  'mc-account-service',
  'mc-account-store',
  'ms-oauth',
  'auth-loopback',
  'ms-auth-service',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const ALL = walk(MAIN);

/**
 * 抽取「带相对路径字面量」的写法。
 *
 * 必须同时覆盖 `from` / `import()` / **`vi.mock()`** / `require()` ——
 * 上一轮搬迁 components/ 时脚本只匹配前两种，漏掉 `vi.mock('../lib/ipc-client.js')`，
 * 直接导致 53 例测试失败（mock 解析不到，组件拿到真实 ipcClient）。
 * 凡是「按文件位置改路径」的写法，都不只 `import` 一种。
 */
const SPEC_RE = /(?:from\s+|import\s*\(|vi\.mock\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g;

/** 模块名 → 引用它的文件（main 内全部 .ts，含测试） */
function importersOf(moduleName: string): string[] {
  const re = new RegExp(
    `(?:from\\s+|import\\s*\\(|vi\\.mock\\s*\\(|require\\s*\\()\\s*['"][^'"]*/${moduleName}\\.js['"]`,
    'g',
  );
  return ALL.filter((f) => stemOf(f) !== moduleName && re.test(readFileSync(f, 'utf-8'))).map((f) =>
    relative(MAIN, f).split(sep).join('/'),
  );
}

function basenameOf(p: string): string {
  return p.slice(p.lastIndexOf(sep) + 1);
}

/**
 * 去掉 `.test.ts` 得到模块名。
 *
 * 「不把模块自己算成引用者」必须按 stem 判断而非按文件名 ——
 * 首版只排除了 `ms-auth-service.ts`，漏了 `ms-auth-service.test.ts`，
 * 于是那条「零引用」断言把自己的测试算成了引用者，当场失败。
 */
function stemOf(p: string): string {
  return basenameOf(p)
    .replace(/\.test\.ts$/, '')
    .replace(/\.ts$/, '');
}

/** 文件是否位于 main/credentials/ 之下 */
function isInCredentials(relPath: string): boolean {
  return relPath.startsWith('credentials/');
}

describe('main/credentials/ 边界规则', () => {
  it('凭据原语不得被簇外代码引用', () => {
    const violations: string[] = [];
    for (const mod of CREDENTIAL_PRIMITIVES) {
      for (const importer of importersOf(mod)) {
        if (!isInCredentials(importer)) {
          violations.push(`${importer} → credentials/${mod}`);
        }
      }
    }
    expect(
      violations,
      '以下代码直接触碰凭据原语（加密落盘 / 日志脱敏），应改走 credentials 暴露的业务函数',
    ).toEqual([]);
  });

  it('凭据簇的 9 个模块都在 credentials/ 下（不得搬回根目录）', () => {
    const flat = CREDENTIAL_CLUSTER.filter(
      (n) => statSync(join(MAIN, `${n}.ts`), { throwIfNoEntry: false }) !== undefined,
    );
    expect(
      flat,
      `以下凭据模块被搬回了 main/ 根目录，应留在 credentials/：${flat.join(', ')}`,
    ).toEqual([]);
  });

  it('两个原语都被实际使用（防止规则退化成空转）', () => {
    // 规则若因改名/删除而失效，这里会先红 —— 解析器退化要立刻发现，而不是静默放行
    for (const mod of CREDENTIAL_PRIMITIVES) {
      expect(
        statSync(join(CREDENTIALS, `${mod}.ts`), { throwIfNoEntry: false }),
        `凭据原语 ${mod}.ts 不在 credentials/ 下，规则可能已失效`,
      ).toBeDefined();
      expect(importersOf(mod).length, `${mod} 已无人引用，请复核该原语是否还需要`).toBeGreaterThan(
        0,
      );
    }
  });

  it('凭据字面量不得出现在 credentials/ 之外', () => {
    const LITERAL = /\b(access_token|refresh_token|client_secret)\b/;
    const leaks = ALL.filter((f) => {
      if (isInCredentials(relative(MAIN, f).split(sep).join('/'))) return false;
      if (f.endsWith('.test.ts')) return false;
      return LITERAL.test(readFileSync(f, 'utf-8'));
    }).map((f) => relative(MAIN, f).split(sep).join('/'));

    expect(leaks, '以下文件在 credentials/ 之外处理凭据字面量').toEqual([]);
  });
});

describe('已知缺口：正版登录尚未接线', () => {
  /**
   * 这条断言记录的是一个**缺口**，不是理想状态。
   *
   * 现状（2026-10-11 实测）：
   *   ms-auth-service.ts  getLaunchIdentity() → LaunchIdentity   实现完整，40 个测试全过
   *        ↓ 无人调用
   *   launcher-service.ts launch({ credentials })                 消费侧已实现
   *        ↓ 生产代码从不传这个参数
   *   IPC 契约里没有 credentials 字段                              用户永远碰不到
   *
   * 434 行 + 40 个通过的测试 + 零生产引用 —— 测试直接 import 模块，
   * 所以它测得很开心，但它测的东西在游戏里不���任何路径。
   *
   * 把它写成断言而不是文档段落，是为了让缺口**在有人接上线的瞬间自己叫出来**。
   */
  it('ms-auth-service 仍无生产引用 —— 一旦接线，请更新本测试并补 IPC 契约', () => {
    const importers = importersOf('ms-auth-service');
    expect(
      importers,
      'ms-auth-service 已被接入生产代码：正版登录已接线。请更新本测试，并把文档里的「已知缺口」改为实施记录。',
    ).toEqual([]);
  });
});

describe('main/credentials/ 现状盘点（只读，不作断言）', () => {
  it('列出凭据簇每个模块的引用者', () => {
    const rows = CREDENTIAL_CLUSTER.map((mod) => ({
      module: mod,
      users: importersOf(mod),
    }));

    console.log(
      '\n[凭据簇引用面]\n' +
        rows
          .map(
            (r) =>
              `  ${r.module.padEnd(20)} ← ${r.users.length === 0 ? '(无人引用)' : r.users.join(', ')}`,
          )
          .join('\n'),
    );
    expect(rows.length).toBe(CREDENTIAL_CLUSTER.length);
  });

  it('列出 main/ 根目录剩余的实现文件及其簇内依赖（供继续治理时对照）', () => {
    const flat = readdirSync(MAIN)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
      .map((n) => n.replace(/\.ts$/, ''))
      .sort();

    const byCluster = flat.filter((n) => {
      const src = readFileSync(join(MAIN, `${n}.ts`), 'utf-8');
      SPEC_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SPEC_RE.exec(src)) !== null) {
        const target = m[1]!.replace(/^\.\//, '').replace(/\.js$/, '').split('/').pop()!;
        if (CREDENTIAL_CLUSTER.includes(target)) return true;
      }
      return false;
    });

    console.log(
      `\n[main/ 根目录剩余 ${flat.length} 个实现，其中 ${byCluster.length} 个仍平铺且依赖凭据簇]\n` +
        (byCluster.length ? `  ${byCluster.join(', ')}` : '  （无）'),
    );
    expect(flat.length).toBeGreaterThan(0);
  });
});
