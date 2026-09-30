import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const LOG = path.join('E:', 'Cache', 'temp', 'opencode', 'gametest', 'server', 'gametest.log');

async function main() {
  const t = await fs.readFile(LOG, 'utf8');
  const lines = t.split('\n');
  console.log('total:', lines.length);
  console.log('first:', lines[0]?.slice(0, 100));
  console.log('last:', lines[lines.length - 1]?.slice(0, 100));
  for (const ln of lines) {
    const low = ln.toLowerCase();
    if (
      low.includes('mixintext') ||
      low.includes('interactblock') ||
      low.includes('place_failed') ||
      low.includes('no bot') ||
      low.includes('threw') ||
      low.includes('mixintext place') ||
      low.includes('mixintext neighbor')
    ) {
      console.log(ln.slice(0, 200));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
