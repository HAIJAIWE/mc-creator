/**
 * 把 docs/design-v3.1.md 按 `## ` 章节边界拆分为 docs/design/ 下的模块化文件。
 *
 * 为什么需要这个脚本：
 * 设计文档是**唯一事实来源**，但单文件 47KB / 1000+ 行时，
 * AI 与人都难以定位与修改特定章节。拆成 25 个文件后：
 * - 每个文件职责单一，改动范围清晰
 * - git diff 能直接看出改了哪一章
 * - AI 投喂时可以只给相关章节，省 token
 *
 * 用法：node scripts/split-design-docs.mjs
 * 幂等：重复运行结果一致（覆盖写）。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'docs', 'design-v3.1.md');
const outDir = join(root, 'docs', 'design');

const raw = readFileSync(src, 'utf8');
const lines = raw.split('\n');

// 找到所有 ## 章节的起始行
const sections = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^## (\d+)\.\s*(.+)$/.exec(lines[i]);
  if (m) sections.push({ num: m[1], title: m[2].trim(), start: i });
}

// §号 -> 语义化文件名
const names = {
  0: '00-positioning',
  1: '01-compliance',
  2: '02-architecture',
  3: '03-content-kinds',
  4: '04-module-list',
  5: '05-java-kernel',
  6: '06-bedrock-kernel',
  7: '07-server-kernel',
  8: '08-devkit',
  9: '09-content-model',
  10: '10-agent',
  11: '11-generation-ladder',
  12: '12-content-model',
  13: '13-security',
  14: '14-reliability',
  15: '15-release',
  16: '16-external-resources',
  17: '17-iteration',
  18: '18-phases',
  19: '19-risk',
  20: '20-deliverables',
  21: '21-verification',
  22: '22-delivery',
  23: '23-references',
  24: '24-changelog',
};

mkdirSync(outDir, { recursive: true });

// 文档头部（第一个 ## 之前）
const header = lines.slice(0, sections[0].start).join('\n').trimEnd();

const indexLines = [
  '# MC 全链路 AI 工作台 · 设计文档（模块化）',
  '',
  '> 版本 v3.1 · 由 `docs/design-v3.1.md` 自动拆分生成。',
  '> **不要直接编辑本目录下的文件** —— 改 `docs/design-v3.1.md` 后重新运行拆分脚本。',
  '',
  '## 章节索引',
  '',
];

for (let i = 0; i < sections.length; i++) {
  const s = sections[i];
  const end = i + 1 < sections.length ? sections[i + 1].start : lines.length;
  const body = lines.slice(s.start, end).join('\n').trimEnd();
  const fname = (names[s.num] ?? `section-${s.num}`) + '.md';
  writeFileSync(join(outDir, fname), body + '\n', 'utf8');
  indexLines.push(`- [§${s.num} ${s.title}](./${fname})`);
}

writeFileSync(
  join(outDir, 'README.md'),
  header + '\n\n---\n\n' + indexLines.join('\n') + '\n',
  'utf8',
);

// 完整性自检：每个拆分文件的内容必须与原文件对应段落逐字一致
let bad = 0;
for (let i = 0; i < sections.length; i++) {
  const s = sections[i];
  const end = i + 1 < sections.length ? sections[i + 1].start : lines.length;
  const origBody = lines.slice(s.start, end).join('\n').trimEnd();
  const fname = (names[s.num] ?? `section-${s.num}`) + '.md';
  const fpath = join(outDir, fname);
  if (!existsSync(fpath)) {
    console.error(`  MISSING ${fname}`);
    bad++;
    continue;
  }
  const got = readFileSync(fpath, 'utf8').trimEnd();
  if (got !== origBody) {
    console.error(`  MISMATCH §${s.num} (${fname})`);
    bad++;
  }
}

const count = readdirSync(outDir).filter((f) => f.endsWith('.md')).length;
if (bad > 0) {
  console.error(`\n拆分完成但有 ${bad} 个章节不一致 —— 请检查`);
  process.exit(1);
}
console.log(`拆分完成: ${sections.length} 个章节文件 + README（共 ${count} 个 .md），逐字校验通过`);
