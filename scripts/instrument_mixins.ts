import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const base = path.join(
  'E:',
  'Cache',
  'temp',
  'opencode',
  'mixin-proj',
  'src',
  'main',
  'java',
  'com',
  'example',
  'mixintest',
  'mixin',
);

const jobs: [string, string][] = [
  ['MixinTestProcedures_e_place_Mixin.java', 'place'],
  ['MixinTestProcedures_e_neighbor_Mixin.java', 'neighbor'],
];

async function main() {
  for (const [name, tag] of jobs) {
    const p = path.join(base, name);
    const t = await fs.readFile(p, 'utf8');
    const t2 = t.replace(/private void onInject_\w+\([^)]*\) \{\n/g, (m) => {
      return m + `        System.out.println("MIXINTEST-HANDLER ${tag} running");\n`;
    });
    const n = (t2.match(/private void onInject_\w+\([^)]*\) \{\n/g) || []).length;
    console.log(name, 'handlers instrumented:', n);
    await fs.writeFile(p, t2, 'utf8');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
