import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import { pipeline } from 'node:stream/promises';

const D = path.join('E:', 'Cache', 'temp', 'opencode');

async function download(url: string, dst: string, timeout = 600): Promise<string> {
  const p = path.join(D, dst);
  try {
    const stat = await fsp.stat(p);
    if (stat.size > 1_000_000) {
      console.log('have', path.basename(p), stat.size);
      return p;
    }
  } catch {
    // file doesn't exist
  }
  console.log('downloading', dst, '...');
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    const req = protocol.request(
      url,
      { headers: { 'User-Agent': 'mc-creator/1.0' }, timeout },
      (res) => {
        const file = fs.createWriteStream(p);
        res.pipe(file);
        file.on('finish', async () => {
          const stat = await fsp.stat(p);
          console.log('got', path.basename(p), stat.size);
          resolve(p);
        });
        file.on('error', (err: unknown) => {
          fsp.unlink(p).catch(() => {});
          reject(err);
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeout * 1000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function main() {
  await fsp.mkdir(D, { recursive: true });

  await download(
    'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse',
    'jdk17.zip',
  );
  await download(
    'https://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-bin.zip',
    'gradle-8.14.3-bin.zip',
  );

  // unpack
  await fsp.mkdir(path.join(D, 'jdk-17'), { recursive: true });
  await pipeline(
    fs.createReadStream(path.join(D, 'jdk17.zip')),
    (await import('unzipper')).Extract({ path: path.join(D, 'jdk-17') }),
  );
  console.log('unpacked jdk-17');

  await fsp.mkdir(path.join(D, 'gradle-8.14.3'), { recursive: true });
  await pipeline(
    fs.createReadStream(path.join(D, 'gradle-8.14.3-bin.zip')),
    (await import('unzipper')).Extract({ path: path.join(D, 'gradle-8.14.3') }),
  );
  console.log('unpacked gradle-8.14.3');

  console.log('TOOLCHAIN_DONE');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
