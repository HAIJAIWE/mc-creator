import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const LOG = path.join('E:', 'Cache', 'temp', 'opencode', 'gametest', 'server', 'gametest.log');

async function main() {
  const t = await fs.readFile(LOG, 'utf8');
  const lines = t.split('\n');
  console.log('total:', lines.length);
  for (const ln of lines) {
    const low = ln.toLowerCase();
    if (
      low.includes('mixintext') ||
      low.includes('interactblock') ||
      low.includes('direct execute') ||
      low.includes('place_failed') ||
      low.includes('no bot') ||
      low.includes('threw')
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
