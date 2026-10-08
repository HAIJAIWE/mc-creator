#!/usr/bin/env node
/**
 * 文档数字一致性检查（Task 2.2）。
 * 从代码提取关键数字，与 README.md / CONTRIBUTING.md 断言比对，不一致则 exit(1)。
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd();
const README = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
const CONTRIBUTING = readFileSync(resolve(ROOT, 'CONTRIBUTING.md'), 'utf-8');

// 从代码提取真值
function extractTruth() {
  const pkgDesktop = JSON.parse(readFileSync(resolve(ROOT, 'apps/desktop/package.json'), 'utf-8'));
  const loader = readFileSync(resolve(ROOT, 'packages/shared/src/types/loader.ts'), 'utf-8');
  const nodeGraphSpec = readFileSync(
    resolve(ROOT, 'packages/shared/src/schemas/node-graph-spec.ts'),
    'utf-8',
  );
  // GENERATOR_TYPES 的唯一定义处。
  //
  // 原来这里读的是 `apps/desktop/src/shared/ipc-channels.ts`，但那个文件早把常量
  // 搬进了 `ipc/generator-types.ts` 并只做再导出。而
  // `GENERATOR_TYPES\s*=\s*\[` 匹配的是**字面量赋值**，匹配不到 re-export 行，
  // 于是 generatorTypeCount 静默变成 0，脚本反过来想「修」本来正确的 README
  // （把 13 改成 0）—— 一个恒定误报的检查比没有检查更糟。
  //
  // 教训：正则读源码对「搬家」极其脆弱。搬这个常量时必须一并改这里。
  const generatorTypesSrc = readFileSync(
    resolve(ROOT, 'apps/desktop/src/shared/ipc/generator-types.ts'),
    'utf-8',
  );

  // Electron version
  const electronVer = pkgDesktop.devDependencies.electron?.replace('^', '') || 'unknown';
  const electronMajor = electronVer.split('.')[0];

  // Loaders
  const loadersMatch = loader.match(/LOADERS\s*=\s*\[([\s\S]*?)\]/);
  const loaders = loadersMatch ? (loadersMatch[1].match(/'([^']+)'/g) || []).length : 0;

  // MC versions
  const mcVersionsMatch = loader.match(/MC_VERSIONS\s*=\s*\[([\s\S]*?)\]/);
  const mcVersions = mcVersionsMatch ? (mcVersionsMatch[1].match(/'([^']+)'/g) || []).length : 0;

  // NodeKind count
  const nodeKindMatch = nodeGraphSpec.match(/NodeKind\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/);
  const nodeKinds = nodeKindMatch ? (nodeKindMatch[1].match(/'([^']+)'/g) || []).length : 0;

  // Templates count
  const templateFiles = [
    'mod-templates.ts',
    'datapack-templates.ts',
    'modpack-templates.ts',
    'server-templates.ts',
    'launcher-templates.ts',
    'skin-templates.ts',
    'resource-pack-templates.ts',
    'kubejs-templates.ts',
    'crafttweaker-templates.ts',
    'behavior-pack-templates.ts',
    'enchantment-templates.ts',
    'behavior-item-templates.ts',
    'behavior-entity-templates.ts',
  ];
  let templateCount = 0;
  for (const f of templateFiles) {
    const content = readFileSync(resolve(ROOT, 'packages/shared/src/templates', f), 'utf8');
    templateCount += (content.match(/id:\s*["'][^"']+["']/g) || []).length;
  }

  // Generator types count
  // ⚠️ 必须先剥离 // 注释再数引号字符串 —— 注释里出现 'skin' 这类带引号的词
  // 会被误数成数组元素（实测：注释 `与 'skin'（Java …）` 让计数多 1）。
  const generatorTypesMatch = generatorTypesSrc.match(/GENERATOR_TYPES\s*=\s*\[([\s\S]*?)\]/);
  const genTypes = generatorTypesMatch
    ? (generatorTypesMatch[1].replace(/\/\/[^\n]*/g, '').match(/'([^']+)'/g) || []).length
    : 0;

  return {
    electronMajor,
    loaderCount: loaders,
    mcVersionCount: mcVersions,
    nodeKindCount: nodeKinds,
    templateCount,
    generatorTypeCount: genTypes,
  };
}

// 检查文档断言
function checkDoc(doc, label, patterns) {
  const errors = [];
  for (const { regex, expected, desc, group = 1 } of patterns) {
    const match = doc.match(regex);
    if (!match) {
      errors.push(`${label}: 找不到 "${desc}" 断言 (正则: ${regex})`);
      continue;
    }
    const actual = match[group];
    if (actual !== String(expected)) {
      errors.push(`${label}: "${desc}" 不一致 — 文档写 "${actual}"，代码真值 "${expected}"`);
    }
  }
  return errors;
}

const truth = extractTruth();
console.log('=== 代码真值 ===');
console.log(JSON.stringify(truth, null, 2));

// README: 包含完整的数字断言
const readmePatterns = [
  { regex: /Electron\s+(\d+)(?:\.\d+)?/, expected: truth.electronMajor, desc: 'Electron 主版本号' },
  { regex: /(\d+)\s*种?生成器类型/, expected: truth.generatorTypeCount, desc: '生成器类型数' },
  { regex: /(\d+)\s*种?节点/, expected: truth.nodeKindCount, desc: '节点种类数 (NodeKind)' },
  {
    regex: /(\d+)\s*种?生成器类型共\s*(\d+)\s*个?预置模板/,
    expected: truth.templateCount,
    desc: '预置模板总数',
    group: 2,
  },
  { regex: /(\d+)\s*MC\s*版本/, expected: truth.mcVersionCount, desc: 'MC 版本数' },
  { regex: /(\d+)\s*Loader/, expected: truth.loaderCount, desc: 'Loader 数量' },
];

// CONTRIBUTING: 只检查它实际包含的数字（NodeKind 19）
const contribPatterns = [
  { regex: /(\d+)\s*节点/, expected: truth.nodeKindCount, desc: '节点种类数 (NodeKind)' },
];

const allErrors = [
  ...checkDoc(README, 'README.md', readmePatterns),
  ...checkDoc(CONTRIBUTING, 'CONTRIBUTING.md', contribPatterns),
];

if (allErrors.length > 0) {
  console.error('\n=== 文档不一致 ===');
  for (const e of allErrors) console.error('❌', e);
  process.exit(1);
} else {
  console.log('\n✅ 所有文档数字与代码真值一致');
  process.exit(0);
}
