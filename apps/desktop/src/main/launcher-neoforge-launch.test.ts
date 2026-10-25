// @vitest-environment node
/**
 * NeoForge 26.x 的**生产模式**启动路径。
 *
 * 这里的每一条断言都对应一次实测（2026-10-22，MC 26.3 + NeoForge 26.3.0.95）：
 *
 * - classpath 里**不能**有 Minecraft 的 jar —— 否则 FML 12 当成开发环境，
 *   然后因为 patched jar 没有 `Minecraft-Dists` manifest 属性而拒绝启动；
 * - 必须有 `-DlibraryDirectory=<libraries>`：FML 12 靠它自己去取 patched jar；
 * - 必须有 `--fml.neoForgeVersion` / `--fml.mcVersion` / `--fml.neoFormVersion`：
 *   缺一个 FML 就拒绝启动。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';

import { LauncherService } from './launcher-service.js';

const MC = '26.3';
const NF = 'neoforge-26.3.0.95';

/** 记录 spawn 出来的命令行。 */
const spawned: { cmd: string; args: string[] }[] = [];
const fakeSpawn = ((cmd: string, args: string[]) => {
  spawned.push({ cmd, args });
  const child = new EventEmitter() as unknown as ReturnType<typeof spawn>;
  (child as unknown as { pid: number }).pid = 4242;
  queueMicrotask(() => child.emit('spawn'));
  return child;
}) as unknown as typeof spawn;

function offlineFetch(): typeof fetch {
  return (async (url: string) => {
    if (url.includes('.jar')) return new Response(Buffer.from('jar-data'), { status: 200 });
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

describe('NeoForge 26.x · 生产模式启动', () => {
  let dir: string;
  let service: LauncherService;

  beforeEach(() => {
    spawned.length = 0;
    dir = mkdtempSync(join(tmpdir(), 'mc-neoforge-launch-'));
    // 原版档案
    mkdirSync(join(dir, 'versions', MC), { recursive: true });
    writeFileSync(
      join(dir, 'versions', MC, `${MC}.json`),
      JSON.stringify({
        id: MC,
        mainClass: 'net.minecraft.client.main.Main',
        assetIndex: { id: MC, url: 'https://x/assets.json' },
        libraries: [
          {
            name: 'org.lwjgl:lwjgl:3.4.3',
            downloads: { artifact: { url: 'https://x/lwjgl-3.4.3.jar', path: 'a/b.jar' } },
          },
        ],
      }),
    );
    // 原版客户端 jar（生产模式下**不应该**出现在 classpath 里）
    writeFileSync(join(dir, 'versions', MC, `${MC}.jar`), 'vanilla-client');

    // NeoForge 档案（形状取自实测产物）
    mkdirSync(join(dir, 'versions', NF), { recursive: true });
    writeFileSync(
      join(dir, 'versions', NF, `${NF}.json`),
      JSON.stringify({
        id: NF,
        inheritsFrom: MC,
        mainClass: 'net.neoforged.fml.startup.Client',
        arguments: {
          jvm: [
            '-Djava.net.preferIPv6Addresses=system',
            '-DlibraryDirectory=${library_directory}',
            '--add-opens',
            'java.base/java.lang.invoke=ALL-UNNAMED',
            '--add-exports',
            'jdk.naming.dns/com.sun.jndi.dns=java.naming',
          ],
          game: [
            '--fml.neoForgeVersion',
            '26.3.0.95',
            '--fml.mcVersion',
            '26.3',
            '--fml.neoFormVersion',
            '1',
          ],
        },
        libraries: [
          {
            name: 'net.neoforged.fancymodloader:loader:12.0.12',
            downloads: {
              artifact: {
                url: 'https://maven.neoforged.net/releases/x/loader-12.0.12.jar',
                path: 'net/neoforged/fancymodloader/loader/12.0.12/loader-12.0.12.jar',
              },
            },
          },
        ],
      }),
    );

    service = new LauncherService(dir, offlineFetch(), { spawn: fakeSpawn });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolveVersion 能识别出 NeoForge 的生产模式参数', async () => {
    const detail = await service.resolveVersion(NF);
    expect(detail.neoforgeLaunch).toEqual({
      neoForgeVersion: '26.3.0.95',
      mcVersion: '26.3',
      neoFormVersion: '1',
    });
    expect(detail.profileArgs?.jvm).toContain('-DlibraryDirectory=${library_directory}');
  });

  it('classpath 里没有 Minecraft 的 jar，且带上 FML 12 要求的参数', async () => {
    const detail = await service.resolveVersion(NF);
    await service.launchGame(detail, {
      username: 'Steve',
      memory: '2G',
      gameDir: join(dir, 'game', NF),
    });

    expect(spawned).toHaveLength(1);
    const args = spawned[0]!.args;
    const cpIndex = args.indexOf('-cp');
    expect(cpIndex).toBeGreaterThan(-1);
    const classpath = args[cpIndex + 1]!;

    // 生产模式：Minecraft 的 jar 不进 classpath
    expect(classpath).not.toContain(`${MC}.jar`);
    expect(classpath).not.toContain('minecraft-client-patched');
    // 加载器自己的库要在
    expect(classpath).toContain('loader-12.0.12.jar');

    // FML 12 的硬要求
    expect(args).toContain('-DlibraryDirectory=' + join(dir, 'libraries'));
    expect(args).toContain('--add-opens');
    expect(args).toContain('java.base/java.lang.invoke=ALL-UNNAMED');
    expect(args).toContain('--fml.neoForgeVersion');
    expect(args).toContain('26.3.0.95');
    expect(args).toContain('--fml.mcVersion');
    expect(args).toContain('--fml.neoFormVersion');
    expect(args).toContain('1');
    // 主类是 FML 的引导类
    expect(args).toContain('net.neoforged.fml.startup.Client');
  });

  it('不是 NeoForge 的档案不受影响（原版照旧把 jar 放进 classpath）', async () => {
    const detail = await service.resolveVersion(MC);
    expect(detail.neoforgeLaunch).toBeUndefined();
    await service.launchGame(detail, {
      username: 'Steve',
      memory: '2G',
      gameDir: join(dir, 'game', MC),
    });
    const args = spawned[0]!.args;
    const classpath = args[args.indexOf('-cp') + 1]!;
    expect(classpath).toContain(`${MC}.jar`);
  });
});
