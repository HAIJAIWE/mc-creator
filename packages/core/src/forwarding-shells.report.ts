/**
 * 转发壳清单（§1.6 的可执行化）。
 *
 * ## 为什么要有这个文件
 *
 * `core` 有 63 个「纯 `export * from '@mc-creator/generator-*'`」的转发壳。
 * 评估期的结论是「大部分是浪费」，但实施期发现**有一部分在承担门面职责** ——
 * `apps/desktop` 的 package.json 里没有任何 `generator-*` 依赖，
 * 它靠 `core/generators/mod/fabric-adapter.js` 这类路径触达 generator 实现。
 *
 * 删掉它们不是清理，是**改依赖边界**。所以需要一份清单把两类分开：
 *  - 在用（门面）：删了会破坏 desktop
 *  - 无人使用：可安全废弃
 *
 * ## 本文件的职责
 *
 * 列出所有转发壳并标注是否被 `core` 之外的代码引用。
 * 清单会随代码变动而过期，因此本文件**只做统计不做断言** ——
 * 一旦把「无人使用」写成断言，任何人正常新增一个引用都会红。
 * 需要时手动跑一遍刷新清单即可。
 *
 * 运行方式：`npx tsx src/forwarding-shells.report.ts`
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SRC = join(PKG_ROOT, 'src');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');

/** 递归列出 core/src 下所有 .ts（非测试） */
function listTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listTs(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** 判断一个文件是不是「纯转发壳」：去掉注释后全部语句都是 re-export */
function isShell(file: string): boolean {
  const lines = readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*(\/\/|\/\*|\*)/.test(l));
  if (lines.length === 0) return false;
  return lines.every((l) => /export \* from '@mc-creator\//.test(l));
}

/**
 * 收集仓库里（core 之外）所有 import 说明符，用于反向查引用。
 *
 * **包含测试文件**：删掉被测试引用的壳会打断测试，即使生产代码没用到。
 * 首版漏掉了测试文件，把 4 个在用壳报成「无人使用」—— 那份清单会直接删错。
 */
function allSpecifiers(): { file: string; spec: string }[] {
  const out: { file: string; spec: string }[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'out' || name === 'dist') continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) {
        const src = readFileSync(p, 'utf-8');
        // 必须同时匹配静态与动态导入：
        //   import { x } from '...'   /  from '...'
        //   await import('...')       ← 漏掉这行会产出**错误的删除清单**
        // 漏掉动态导入曾导致 agent-tools.ts 的两处 await import 被判为「无人使用」，
        // 而按那份清单删文件会直接打断生产代码。
        const re = /(?:from\s+|import\s*\(|import\s+)['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) out.push({ file: p, spec: m[1]! });
      }
    }
  };
  walk(REPO_ROOT);
  return out;
}

function main(): void {
  const allTs = listTs(CORE_SRC);
  const shells = allTs.filter(isShell);
  const specs = allSpecifiers();

  /**
   * 判断一个壳是否被引用。**两种引用形态都要算**：
   *
   * 1. 包路径：`@mc-creator/core/generators/mod/index.js`（core 外部）
   * 2. 相对路径：`./mod/index.js`（**core 内部**，如 `generators/index.ts`）
   *
   * 只算 1 是本工具的第三个 bug：漏掉 2 会把
   * `generators/<name>/index.ts` 全判成无人使用，而 `generators/index.ts`
   * 正是 `createDefaultRegistry` 的装配点（它 import 各生成器具体类）。
   */
  const isReferenced = (shellAbs: string, relFromCore: string): string[] => {
    const pkgPath = `@mc-creator/core/${relFromCore}`;
    const users: string[] = [];

    // 1) 包路径引用（任意仓库文件，含 core 自身）
    for (const s of specs) {
      if (s.spec === pkgPath) users.push(relative(REPO_ROOT, s.file).replace(/\\/g, '/'));
    }
    // 2) core 内部的相对路径引用
    for (const fromFile of allTs) {
      if (fromFile === shellAbs) continue;
      const src = readFileSync(fromFile, 'utf-8');
      const re = /(?:from\s+|import\s*\(|import\s+)['"](\.[^'"]*)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const spec = m[1]!;
        const target = resolve(dirname(fromFile), spec.replace(/\.js$/, '.ts'));
        if (target === shellAbs) {
          users.push(relative(REPO_ROOT, fromFile).replace(/\\/g, '/'));
        }
      }
    }
    return [...new Set(users)];
  };

  const used: { shell: string; by: string[] }[] = [];
  const unused: string[] = [];

  for (const shell of shells) {
    const relFromCore = relative(CORE_SRC, shell).replace(/\\/g, '/').replace(/\.ts$/, '.js');
    const users = isReferenced(shell, relFromCore);
    if (users.length > 0) used.push({ shell: relFromCore, by: users });
    else unused.push(relFromCore);
  }

  console.log(`转发壳总数: ${shells.length}`);
  console.log(`  被引用（不可删）: ${used.length}`);
  console.log(`  无人引用（可废弃）: ${unused.length}`);
  console.log('');

  console.log('=== 在用的门面壳 ===');
  for (const u of used) console.log(`  core/${u.shell}\n      ← ${u.by.join('\n      ← ')}`);
  console.log('');

  console.log('=== 无人使用的壳（前 20，完整清单见运行输出）===');
  for (const u of unused.slice(0, 20)) console.log(`  core/${u}`);
  if (unused.length > 20) console.log(`  … 其余 ${unused.length - 20} 个`);

  console.log('');
  console.log('注意：本清单随代码变动会过期。删除前请重新运行核对。');
  console.log('路径含中文/空格时 PowerShell 输出可能乱码，以文件为准。');

  // 供删除脚本消费：每行一个**绝对路径**，无表头无缩进
  // （PowerShell 控制台编码会让中文路径乱码，删除必须走文件）
  if (process.env.SHELLS_OUT) {
    const outFile = process.env.SHELLS_OUT;
    writeFileSync(
      outFile,
      unused.map((u) => join(CORE_SRC, u.replace(/\.js$/, '.ts'))).join('\n'),
      'utf-8',
    );
    console.log('');
    console.log(`已写出待删清单（${unused.length} 条）: ${outFile}`);
  }
}

main();
