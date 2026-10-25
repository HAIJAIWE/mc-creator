/**
 * 原版服务端**实例目录**的创建 —— 把「下载好的 server.jar」变成「能启动的服务端」。
 *
 * ## 为什么需要这个文件
 *
 * §22 做完了「下载服务端 jar」（落在 `versions/<id>/<id>-server.jar`），
 * 但那只是一份**产物**。`server-launch-spec.ts` 要的是一个**实例目录**：
 * 有 `server.properties`、有一个 jar、`cwd` 指向它（§17.6 的安全通道只认这个）。
 * 两者之间原本缺着一环，本文件补的就是这一环。
 *
 * ## 根目录不是同一个
 *
 * - 启动器的下载产物：`<userData>/mc-launcher/`（`LauncherService.baseDir`）
 * - 服务端实例：`<userData>/mc-creator/servers/<serverId>`（`ipc/process-supervisor.ts` 的
 *   `serverRootDir()`，与 `kernel-server` 的 `serverDir(root, id)` 同一层布局）
 *
 * 两者是**并列**的，不是一个套另一个。所以本模块**接收** serversRoot 作为参数，
 * 而不是自己算 —— 顺便让它能被单测（不依赖 `app.getPath`）。
 *
 * ## 与 kernel-server 的关系：镜像，不重复
 *
 * 布局与判定照抄 `kernel-server/src/kernel.ts` 的 `createInstance`：
 * 子目录 `plugins/ world/ logs/ config/`、同名 `server.properties`、同样拒绝重名。
 * **刻意不直接调用内核** —— 内核是 agent 那一层的运行时，从 launcher-service
 * 调它会把分层搅乱；桌面侧这套薄壳的定位本来就是「与内核对齐的镜像」。
 * `isValidServerId` 直接复用 `server-launch-spec.ts`（判定集合只有一份）。
 *
 * ## 两条不能省的纪律
 *
 * 1. **不代用户同意 EULA。** `eula.txt` 默认写 `eula=false`；
 *    只有显式 `acceptEula: true` 才写 `eula=true`。内核里那条
 *    `EULA_NOT_ACCEPTED` 校验就是为此存在的，这里照抄。
 * 2. **properties 值转义。** `motd` 之类是用户输入，而 properties 是
 *    `key=value` 行格式：值里带换行就能凭空插出别的配置项。
 */

import { existsSync, readFileSync } from 'node:fs';
import { copyFile, link, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isValidServerId } from './server-launch-spec.js';

/** 与 kernel-server `propertiesEscape` 同实现、同理由（值里的换行/等号需防注入）。 */
export function propertiesEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[\r\n]+/g, ' ')
    .replace(/([=:#])/g, '\\$1');
}

export interface CreateServerInstanceOptions {
  /** 服务端实例根目录（`<userData>/mc-creator/servers`）。 */
  serversRoot: string;
  /** 实例 id；必须是不含分隔符/`..` 的单段名。 */
  serverId: string;
  /** 已下载的服务端 jar 绝对路径。 */
  jarPath: string;
  /** 端口，1..65565。缺省 25565。 */
  port?: number;
  /** MOTD；用户输入，会被转义。 */
  motd?: string;
  maxPlayers?: number;
  /** 缺省 true（正版校验）。离线服才关。 */
  onlineMode?: boolean;
  /** 世界名；缺省 `world`。 */
  levelName?: string;
  /**
   * MC 版本 id（如 `26.3`）。
   *
   * 服务端目录名是用户起的实例名，不能反推出 jar 版本；不记下来的话
   * 实例库只能把 `serverId` 当版本显示（实测「ServerTest · 未同意 EULA」
   * 这种误导信息）。写进 `.mc-creator-version`，列表读它。
   */
  versionId?: string;
  /**
   * 用户是否已接受 Minecraft EULA。
   *
   * **只有 `true` 才写 `eula=true`。** 缺省/false 一律写 `eula=false` ——
   * 服务端会拒绝启动并打印 EULA 提示，这正是应该发生的事。
   * 代用户勾选 EULA 是把法律责任塞给应用，不是一个 feature。
   */
  acceptEula?: boolean;
}

export type CreateServerInstanceResult =
  | { ok: true; serverDir: string; jarLinked: boolean; eulaAccepted: boolean }
  | { ok: false; error: string };

/** 实例里必须有的子目录 —— 与 kernel-server 一致。 */
const SUBDIRS = ['plugins', 'world', 'logs', 'config'] as const;

/**
 * 把 jar 放进实例目录。
 *
 * 先试**硬链接**：server.jar 有 62 MB，逐个实例复制一份既慢又占地方，
 * 而同一版本多个实例共用一份 jar 是常态。链接不成（跨卷 / 文件系统不支持）
 * 再退回复制 —— 这两种情况在 Windows 上都真实存在，所以退回不是防御性编程。
 */
async function placeJar(src: string, dest: string): Promise<boolean> {
  try {
    await link(src, dest);
    return true;
  } catch {
    await copyFile(src, dest);
    return false;
  }
}

/**
 * 创建原版服务端实例目录。返回 `{ok:false, error}` 而不抛 —— 与
 * `buildServerLaunchSpec` 同一形态，调用方不必 try/catch。
 */
export async function createVanillaServerInstance(
  opts: CreateServerInstanceOptions,
): Promise<CreateServerInstanceResult> {
  const { serversRoot, serverId, jarPath } = opts;

  if (!isValidServerId(serverId)) {
    return { ok: false, error: `serverId 非法（含路径穿越或分隔符）: ${serverId}` };
  }
  if (!existsSync(serversRoot)) {
    return { ok: false, error: `服务端根目录不存在: ${serversRoot}` };
  }
  if (!existsSync(jarPath)) {
    return { ok: false, error: `服务端 jar 不存在: ${jarPath}` };
  }

  const serverDir = join(serversRoot, serverId);
  if (existsSync(serverDir)) {
    // 与内核 SERVER_EXISTS 同一条：重名不覆盖。
    // 覆盖意味着把用户已经跑起来的世界、插件、配置一起抹掉。
    return { ok: false, error: `服务端已存在: ${serverId}（${serverDir}）` };
  }

  const port = opts.port ?? 25565;
  if (!Number.isInteger(port) || port < 1 || port > 65565) {
    return { ok: false, error: `端口非法（需 1..65565 整数）: ${port}` };
  }
  const maxPlayers = opts.maxPlayers ?? 20;
  if (!Number.isInteger(maxPlayers) || maxPlayers < 0 || maxPlayers > 4096) {
    return { ok: false, error: `最大在线人数非法: ${maxPlayers}` };
  }

  await mkdir(serverDir, { recursive: true });
  for (const sub of SUBDIRS) {
    await mkdir(join(serverDir, sub), { recursive: true });
    await writeFile(join(serverDir, sub, '.gitkeep'), '', 'utf-8');
  }

  // server.properties 只写**我们真正要设**的项。
  //
  // 刻意不抄内核那份 24 行的完整模板：原版服务端首次运行会把自己缺的项
  // 补齐并回写，这里再写一遍默认值只会在用户改过之后被我们的默认值盖回去。
  // 内核那份要写全，是因为它要的就是「一份可读的基线配置」。
  const motd = propertiesEscape(opts.motd ?? `${serverId} Server`);
  const levelName = propertiesEscape(opts.levelName ?? 'world');
  const props = [
    `motd=${motd}`,
    `server-port=${port}`,
    'online-mode=' + String(opts.onlineMode ?? true),
    `max-players=${maxPlayers}`,
    `level-name=${levelName}`,
    // 关查询与 RCON：默认开到公网上等于把服务器控制权交出去。
    'enable-query=false',
    'enable-rcon=false',
    // 视距拉太高会让小机器直接 OOM，缺省保守。
    'view-distance=10',
    'simulation-distance=10',
  ].join('\n');
  await writeFile(join(serverDir, 'server.properties'), `${props}\n`, 'utf-8');

  const eulaAccepted = opts.acceptEula === true;
  await writeFile(
    join(serverDir, 'eula.txt'),
    eulaAccepted ? 'eula=true\n' : 'eula=false\n',
    'utf-8',
  );

  if (opts.versionId !== undefined && opts.versionId.trim() !== '') {
    // 只写版本号本身；这是应用自己的元数据，不是给 Minecraft 读的。
    await writeFile(join(serverDir, '.mc-creator-version'), `${opts.versionId.trim()}\n`, 'utf-8');
  }

  const jarDest = join(serverDir, 'server.jar');
  const jarLinked = await placeJar(jarPath, jarDest);

  return { ok: true, serverDir, jarLinked, eulaAccepted };
}

/**
 * 实例是不是「已接受 EULA」。
 *
 * 启动前用它挡一道：EULA 没接受就 spawn，出来的进程会立刻退出，
 * 用户只看到「启动失败」而不知道要先点同意。
 */
export function isEulaAccepted(serverDir: string): boolean {
  try {
    return /^eula\s*=\s*true\s*$/im.test(readFileSync(join(serverDir, 'eula.txt'), 'utf-8'));
  } catch {
    // 读不到（文件不存在 / 无权限）就当**没接受** —— 缺省必须是保守的那一侧。
    return false;
  }
}
