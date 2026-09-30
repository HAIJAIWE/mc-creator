/**
 * Fabric 1.20.1 headless server driver for the 4-mixin game test.
 *
 * Reader thread drains stdout continuously (never blocks the server).
 * Scenario (deterministic stone platform at y=60..61):
 *   1. platform + bot spawn + look down + stone -> `use` => MIXINTEST place
 *   2. console /setblock on platform                    => MIXINTEST neighbor
 *   3. tp bot + summon diamond at feet                   => MIXINTEST pickup
 *   4. summon primed TNT far away                        => MIXINTEST explosion
 * Asserts each marker appears in server log.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const D = path.join('E:', 'Cache', 'temp', 'opencode', 'gametest', 'server');
const JDK = path.join('E:', 'Cache', 'temp', 'opencode', 'jdk-17', 'jdk-17', 'bin');
const LOG = path.join(D, 'gametest.log');

const env = { ...process.env };
env['JAVA_HOME'] = '';
env['PATH'] = JDK + path.delimiter + (env['PATH'] || '');

type ScenarioStep = [wait: number, command: string | null];

const SCENARIO: ScenarioStep[] = [
  [2, null],
  [0, 'fill 95 60 95 105 60 105 minecraft:stone'],
  [3, null],
  [0, 'player mixinbot spawn at 100 65 100'],
  [4, null],
  [0, 'tp mixinbot 100 65 100 0 90'],
  [0, 'give mixinbot minecraft:stone 64'],
  [2, null],
  [0, 'player mixinbot use'],
  [6, null],
  [0, 'player mixinbot stop'],
  [2, null],
  [0, 'execute unless block 100 61 100 minecraft:stone run say PLACE_FAILED'],
  [1, null],
  [0, 'setblock 102 61 102 minecraft:dirt'],
  [2, null],
  [0, 'setblock 101 61 100 minecraft:crafting_table'],
  [2, null],
  // 直调 interactBlock（真客户端走的同一方法；Carpet use 旁路它）-> 预期 place marker
  [0, 'placetest'],
  [3, null],
  // 观察者路径：放置观察者本身（onBlockAdded→updateNeighbors）与
  // 正前方变化（scheduledTick→updateNeighbors）都走 World.updateNeighbor(3 参)
  [0, 'setblock 104 61 100 minecraft:observer[facing=west]'],
  [3, null],
  [0, 'setblock 103 61 100 minecraft:stone'],
  [5, null],
  [0, 'neighbortest'],
  [2, null],
  [0, 'tp mixinbot 130.5 65 130.5 0 0'],
  [3, null],
  [0, 'summon minecraft:item 130.5 62 130.5 {Item:{id:"minecraft:diamond",Count:1}}'],
  [5, null],
  [0, 'summon minecraft:tnt 160 70 160 {fuse:40}'],
  [6, null],
  [0, 'stop'],
];

const MARKERS = [
  'MIXINTEST place FIRED',
  'MIXINTEST neighbor FIRED',
  'MIXINTEST pickup FIRED',
  'MIXINTEST explosion FIRED',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  // clean world for deterministic reruns (server must be stopped)
  const { rm } = await import('node:fs/promises');
  for (const d of ['world', 'world_nether', 'world_the_end']) {
    await rm(path.join(D, d), { recursive: true, force: true });
  }
  const logf = fs.createWriteStream(LOG, { encoding: 'utf8' });

  const p = spawn('java', ['-Xmx2G', '-jar', 'fabric-server-launch.jar', 'nogui'], {
    cwd: D,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: true,
  });

  if (!p.stdin || !p.stdout) {
    console.error('Failed to spawn server process');
    return 2;
  }

  const logLines: string[] = [];
  const logLock = { locked: false, waiters: [] as Array<() => void> };

  function acquireLock(): Promise<void> {
    if (!logLock.locked) {
      logLock.locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => logLock.waiters.push(resolve));
  }

  function releaseLock(): void {
    logLock.locked = false;
    if (logLock.waiters.length > 0) {
      const next = logLock.waiters.shift();
      if (next) next();
    }
  }

  async function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await acquireLock();
    try {
      return await fn();
    } finally {
      releaseLock();
    }
  }

  const reader = async () => {
    for await (const line of p.stdout) {
      await withLock(() => {
        logLines.push(line);
        logf.write(line + '\n');
      });
    }
  };

  const readerPromise = reader();

  function send(cmd: string): void {
    console.log('>>', cmd);
    p.stdin?.write(cmd + '\n');
  }

  // wait for Done (max 7 min for first boot + worldgen)
  let done = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 420_000) {
    const doneCheck = await withLock(() => logLines.some((l) => l.includes('Done (')));
    if (doneCheck) {
      done = true;
      break;
    }
    if (p.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('server done:', done, 'poll:', p.exitCode);
  if (!done) {
    p.kill();
    logf.end();
    return 2;
  }

  for (const [wait, cmd] of SCENARIO) {
    if (p.exitCode !== null) {
      console.log('server exited early');
      break;
    }
    if (cmd) {
      send(cmd);
    }
    if (wait) {
      await sleep(wait * 1000);
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      p.on('exit', resolve);
      p.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 120_000);
    });
  } catch {
    p.kill();
  }
  await readerPromise;
  logf.end();

  console.log('==== MARKER REPORT ====');
  let rc = 0;
  for (const m of MARKERS) {
    const hit = logLines.filter((l) => l.includes(m));
    console.log((hit.length ? 'PASS ' : 'FAIL ') + m + (hit.length ? ` x${hit.length}` : ''));
    for (const h of hit.slice(0, 4)) {
      console.log('    ', h.slice(0, 160));
    }
    if (!hit.length) rc = 1;
  }
  for (const l of logLines) {
    if (l.includes('Unknown or incomplete command') || l.includes('Incorrect argument')) {
      console.log('CMDERR:', l.slice(0, 160));
    }
  }
  return rc;
}

main()
  .then((rc) => process.exit(rc))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

export {};
