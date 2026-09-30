import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';

const D = path.join('E:', 'Cache', 'temp', 'opencode', 'gametest');
const S = path.join(D, 'server');
const UA = { 'User-Agent': 'mc-creator/1.0' };

async function download(url: string, dst: string, timeout = 300): Promise<string> {
  const p = path.join(D, dst);
  try {
    const stat = await fsp.stat(p);
    if (stat.size > 10000) {
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
    const req = protocol.request(url, { headers: UA, timeout }, (res) => {
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
    });
    req.on('error', reject);
    req.setTimeout(timeout * 1000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function main() {
  await fsp.mkdir(D, { recursive: true });
  await fsp.mkdir(S, { recursive: true });

  await download(
    'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar',
    'fabric-installer.jar',
  );
  await download(
    'https://github.com/gnembon/fabric-carpet/releases/download/1.4.112/fabric-carpet-1.20-1.4.112+v230608.jar',
    'carpet.jar',
  );

  // Get server jar from version manifest
  const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
  const manifestReq = https.request(manifestUrl, { headers: { 'User-Agent': 'mc-creator/1.0' } });
  const manifestBody = await new Promise<string>((resolve, reject) => {
    let data = '';
    manifestReq.on('data', (chunk) => (data += chunk));
    manifestReq.on('end', () => resolve(data));
    manifestReq.on('error', reject);
  });
  manifestReq.end();
  const manifest = JSON.parse(manifestBody);
  const version = manifest.versions.find((v: { id: string }) => v.id === '1.20.1');
  const vmetaReq = https.request(version.url, { headers: { 'User-Agent': 'mc-creator/1.0' } });
  const vmetaBody = await new Promise<string>((resolve, reject) => {
    let data = '';
    vmetaReq.on('data', (chunk) => (data += chunk));
    vmetaReq.on('end', () => resolve(data));
    vmetaReq.on('error', reject);
  });
  vmetaReq.end();
  const vmeta = JSON.parse(vmetaBody);

  const srv = vmeta.downloads.server;
  const sp = path.join(S, 'server.jar');
  if (!fsp.stat(sp).catch(() => false) || (await fsp.stat(sp)).size !== srv.size) {
    console.log('downloading server.jar', srv.size);
    await download(srv.url, 'server.jar');
    console.log('got server.jar', (await fsp.stat(sp)).size);
  } else {
    console.log('have server.jar', (await fsp.stat(sp)).size);
  }

  const fabricApiVer = '0.91.1+1.20.1';
  const fabricApiPath = `fabric-api-${fabricApiVer}.jar`;
  await download(
    `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${encodeURIComponent(fabricApiVer)}/${encodeURIComponent(fabricApiPath)}`,
    'fabric-api.jar',
  );
  console.log('SERVER_ASSETS_DONE');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
