import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const LOG = path.join('E:', 'Cache', 'temp', 'opencode', 'gametest', 'server', 'gametest.log');

async function main() {
  const t = await fs.readFile(LOG, 'utf8');
  const lines = t.split('\n');
  console.log('total lines:', lines.length);
  for (const ln of lines) {
    if (ln.includes('20:19:5') || ln.includes('20:20:0')) {
      console.log(ln.slice(0, 190));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
