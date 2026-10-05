/**
 * 游戏启动器服务（迷你版 PCL2/HMCL）。
 *
 * 链路：版本清单 → 下载 client.jar → 下载 assets → 下载 libraries → 启动 Java。
 *
 * 账户（§5.8 / §13.2，2026-10 更新）：
 * - **正版为第一路径**（§1.2 第 1 条）：`launchGame` 支持传入
 *   `LaunchCredentials`（来自 `ms-auth-service.ts` 的微软登录链路）。
 *   正版模式下 `--uuid` 用 **Minecraft profile 的 UUID**（不是随机值）、
 *   `--accessToken` 用真实的 Minecraft access token、`--userType msa`。
 * - **离线模式仅保留用于本地开发/测试**（§1.2 第 2 条）：
 *   不传 `credentials` 时才走离线分支（`accessToken=0`、UUID 随机、
 *   `userType=legacy`）。该分支**不在产品宣传中作为卖点**。
 * - **第三方认证站默认关闭**（§1.2 第 3 条 / §5.8 / §19）：
 *   启用必须经 `ThirdPartyAuthGate`（默认关闭 + 显式确认 + 风险提示全文）。
 *   见 `enableThirdPartyAuth()`。
 *
 * 其余设计：
 * - 纯 Node 原生实现（fetch + fs），无第三方依赖
 * - 目录结构（userData/mc-launcher/）：
 *   - versions/<ver>/<ver>.json + <ver>.jar
 *   - assets/indexes/<ver>.json + objects/<hash前2>/<hash>
 *   - libraries/<groupPath>/<artifact>/<ver>/<artifact>-<ver>.jar
 * - 1.21.x 使用官方 Mojang 映射，无 natives 下载（新库方案）
 */

import { join, dirname } from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ComplianceDeniedError, type ThirdPartyAuthGate } from './compliance-gate.js';
/** 下载进度回调 */
export type DownloadProgress = (
  stage: 'versions' | 'client' | 'assets' | 'libraries',
  done: number,
  total: number,
) => void;

/** 版本条目 */
export interface GameVersionEntry {
  id: string;
  type: string;
  releaseTime: string;
  url: string;
}

/** 解析后的版本详情（版本 json 的关键字段） */
export interface VersionDetail {
  id: string;
  assets: string; // assetIndex id
  assetsUrl: string;
  clientUrl: string;
  /** library 下载地址列表（artifact 或 classifier natives） */
  libraryUrls: string[];
}

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

/**
 * 默认的第三方皮肤站（LittleSkin，国内主流）。
 *
 * 仍然**必须**经 `enableThirdPartyAuth()` 的合规闸门才能生效
 * （§1.2 / §5.8 / §19：默认关闭 + 显式确认 + 风险提示）。
 * 写成常量只是为了让默认值的出处可见、可改，不是「默认开启」。
 */
export const DEFAULT_THIRD_PARTY_SKIN_API = 'https://littleskin.cn/api/yggdrasil';

/**
 * 启动游戏用的正版身份（§5.8）。
 *
 * 由 `MicrosoftAuthService.getLaunchIdentity()` 产出。本模块**不关心**
 * 这些值从哪来（token 刷新/加密/多账户都在 `ms-auth-service.ts` 与
 * `mc-account-store.ts`），只负责把它们正确地拼进启动参数。
 */
export interface LaunchCredentials {
  /** Minecraft 玩家名（来自 profile，**不是** XBox 昵称）。 */
  readonly username: string;
  /** 带连字符的 Minecraft profile UUID（**不是**随机值）。 */
  readonly uuid: string;
  /** 真实的 Minecraft access token。 */
  readonly accessToken: string;
  /** `msa` = 正版。 */
  readonly userType: 'msa';
}

/** 文件存在检查 */
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** 写文件（自动建目录） */
async function writeFileAtomic(p: string, data: Buffer): Promise<void> {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}

export interface LauncherServiceDeps {
  /**
   * 第三方认证站的合规闸门（§1.2 / §5.8 / §19）。
   *
   * **刻意不提供默认值**：没注入 `enableThirdPartyAuth()` 就会抛错
   * （fail-closed），而不是「没闸门 = 放行」。要启用必须显式注入一个
   * `new ThirdPartyAuthGate({ enabled: true, confirm: ..., acknowledgedNoticeVersion })`。
   */
  readonly thirdPartyAuth?: ThirdPartyAuthGate;
  /**
   * 注入 `spawn`（默认就是 `node:child_process` 的 spawn）。
   *
   * 存在的理由：断言「启动参数里 UUID 是不是 profile 的真值」必须能观察
   * spawn 的实参，而 `vi.mock('node:child_process')` 在本仓的 vitest 2.1
   * 上不可靠（会静默失效、真的去起 java）。注入依赖比 mock 模块更稳。
   */
  readonly spawn?: typeof spawn;
}

/**
 * 启动器服务。baseDir = userData/mc-launcher。
 * 所有方法可独立测试（注入 baseDir + 可选 fetch + 可选 spawn）。
 */
export class LauncherService {
  private readonly thirdPartyAuth: ThirdPartyAuthGate | undefined;
  private readonly spawnImpl: typeof spawn;

  constructor(
    readonly baseDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
    deps: LauncherServiceDeps = {},
  ) {
    this.thirdPartyAuth = deps.thirdPartyAuth;
    this.spawnImpl = deps.spawn ?? spawn;
  }

  /** 下载辅助：带重试的 GET → Buffer（用注入的 fetch，便于测试） */
  private async download(url: string, retries = 3): Promise<Buffer> {
    let lastErr: Error | null = null;
    for (let i = 0; i < retries; i++) {
      try {
        const res = await this.fetchImpl(url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        lastErr = e as Error;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastErr ?? new Error(`下载失败: ${url}`);
  }

  /** 拉取版本清单，返回 release 版本列表（最新在前） */
  async listVersions(): Promise<GameVersionEntry[]> {
    const buf = await this.download(MANIFEST_URL);
    const manifest = JSON.parse(buf.toString('utf-8'));
    const versions: GameVersionEntry[] = (manifest.versions as GameVersionEntry[]).filter(
      (v) => v.type === 'release',
    );
    return versions.sort((a, b) => b.releaseTime.localeCompare(a.releaseTime));
  }

  /** 解析版本详情（libraries/client/assets） */
  async resolveVersion(version: string): Promise<VersionDetail> {
    // 先从 manifest 找版本 url
    const manifest = JSON.parse((await this.download(MANIFEST_URL)).toString('utf-8'));
    const entry = (manifest.versions as GameVersionEntry[]).find((v) => v.id === version);
    if (!entry) throw new Error(`版本不存在: ${version}`);
    const vjson = JSON.parse((await this.download(entry.url)).toString('utf-8'));

    const libraryUrls: string[] = [];
    for (const lib of vjson.libraries ?? []) {
      if (lib.downloads?.artifact?.url) {
        libraryUrls.push(lib.downloads.artifact.url);
      }
      // classifier natives（旧版本 1.20- 才有；1.21+ 新库方案无 natives）
      const natives = lib.downloads?.classifiers;
      if (natives && typeof natives === 'object') {
        for (const [, f] of Object.entries(natives)) {
          const file = f as { url?: string };
          if (file?.url) libraryUrls.push(file.url);
        }
      }
    }

    return {
      id: version,
      assets: vjson.assetIndex?.id ?? version,
      assetsUrl: vjson.assetIndex?.url ?? '',
      clientUrl: vjson.downloads?.client?.url ?? '',
      libraryUrls,
    };
  }

  /** 下载 client.jar（已存在则跳过） */
  async downloadClient(detail: VersionDetail, onProgress?: DownloadProgress): Promise<string> {
    const jarPath = join(this.baseDir, 'versions', detail.id, `${detail.id}.jar`);
    if (await exists(jarPath)) {
      onProgress?.('client', 1, 1);
      return jarPath;
    }
    if (!detail.clientUrl) throw new Error('版本详情缺少 client.jar URL');
    onProgress?.('client', 0, 1);
    const buf = await this.download(detail.clientUrl);
    await writeFileAtomic(jarPath, buf);
    onProgress?.('client', 1, 1);
    return jarPath;
  }

  /** 下载 assets 索引 + 资源文件 */
  async downloadAssets(detail: VersionDetail, onProgress?: DownloadProgress): Promise<void> {
    const indexPath = join(this.baseDir, 'assets', 'indexes', `${detail.assets}.json`);
    let index: { objects?: Record<string, { hash: string; size: number }> };
    if (await exists(indexPath)) {
      index = JSON.parse(await readFile(indexPath, 'utf-8'));
    } else {
      if (!detail.assetsUrl) throw new Error('版本详情缺少 assets index URL');
      const buf = await this.download(detail.assetsUrl);
      await writeFileAtomic(indexPath, buf);
      index = JSON.parse(buf.toString('utf-8'));
    }

    const objects = index.objects ?? {};
    const entries = Object.entries(objects);
    let done = 0;
    onProgress?.('assets', 0, entries.length);
    for (const [, obj] of entries) {
      const hash = obj.hash;
      const dest = join(this.baseDir, 'assets', 'objects', hash.slice(0, 2), hash);
      if (!(await exists(dest))) {
        try {
          const buf = await this.download(
            `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
          );
          await writeFileAtomic(dest, buf);
        } catch {
          // 单个资源失败不阻断（可重试）
        }
      }
      done++;
      if (done % 50 === 0 || done === entries.length) {
        onProgress?.('assets', done, entries.length);
      }
    }
    onProgress?.('assets', entries.length, entries.length);
  }

  /** 下载 libraries（已存在则跳过） */
  async downloadLibraries(detail: VersionDetail, onProgress?: DownloadProgress): Promise<string[]> {
    const paths: string[] = [];
    let done = 0;
    const total = detail.libraryUrls.length;
    onProgress?.('libraries', 0, total);
    for (const url of detail.libraryUrls) {
      // 从 URL 推导本地路径: .../<group>/<artifact>/<ver>/<file>.jar
      const urlPath = new URL(url).pathname; // 以 / 开头的路径
      const rel = urlPath.replace(/^\//, '');
      const dest = join(this.baseDir, 'libraries', ...rel.split('/'));
      if (!(await exists(dest))) {
        try {
          const buf = await this.download(url);
          await writeFileAtomic(dest, buf);
        } catch {
          // 单个库失败不阻断（启动时会报缺库）
        }
      }
      paths.push(dest);
      done++;
      onProgress?.('libraries', done, total);
    }
    return paths;
  }

  /**
   * 组装 classpath 并启动 Java。
   *
   * 账户模式（§1.2：正版为第一路径，离线仅供开发/测试）：
   * - 传 `credentials` → **正版模式**：UUID 用 profile 的真实 UUID、
   *   accessToken 用真实 token、userType=msa。服务端能正常校验。
   * - 不传 → **离线模式**（§1.2 第 2 条：仅本地开发/测试）：
   *   accessToken=0、UUID 随机、userType=legacy。
   */
  async launchGame(
    detail: VersionDetail,
    opts: {
      username: string;
      memory: string;
      gameDir: string;
      javaPath?: string;
      /** 正版身份。缺省即离线模式。 */
      credentials?: LaunchCredentials;
    },
  ): Promise<{ pid: number }> {
    const jarPath = join(this.baseDir, 'versions', detail.id, `${detail.id}.jar`);
    if (!(await exists(jarPath))) {
      throw new Error('客户端未下载，请先下载');
    }
    const libraries = await this.downloadLibraries(detail);
    const classpath = [...libraries, jarPath].join(process.platform === 'win32' ? ';' : ':');

    const assetsDir = join(this.baseDir, 'assets');
    const gameDir = opts.gameDir || join(this.baseDir, 'game', detail.id);
    await mkdir(gameDir, { recursive: true });

    const java = opts.javaPath || 'java';
    // 正版：全部取自 profile；离线：随机 UUID + accessToken=0 + legacy。
    // ⚠️ 不能混用「正版 UUID + 0 号 token」——服务端会判定为伪造会话。
    const uuid = opts.credentials?.uuid ?? randomUUID();
    const accessToken = opts.credentials?.accessToken ?? '0';
    const userType = opts.credentials?.userType ?? 'legacy';
    // 用户名用 `||` 而不是 `??`：空串也必须回落。
    // profile 里 name 缺失（无档案账号）时 credentials.username 可能是 ''，
    // `??` 会把空串原样传下去 → 启动参数 `--username ''` 必然进不去。
    const username = opts.credentials?.username || opts.username || 'Steve';
    const args = [
      `-Xmx${opts.memory}`,
      `-Xms${opts.memory}`,
      '-cp',
      classpath,
      'net.minecraft.client.main.Main',
      '--username',
      username,
      '--version',
      detail.id,
      '--gameDir',
      gameDir,
      '--assetsDir',
      assetsDir,
      '--assetIndex',
      detail.assets,
      '--uuid',
      uuid,
      '--accessToken',
      accessToken,
      '--userType',
      userType,
    ];

    const child: ChildProcess = this.spawnImpl(java, args, { stdio: 'ignore' });
    return { pid: child.pid ?? 0 };
  }

  // ===== 加载器安装（Fabric / NeoForge）=====

  /** 已安装加载器检测：versions 目录含 fabric-loader-<ver> 或 neoforge-<ver> */
  async isLoaderInstalled(version: string, loader: 'fabric' | 'neoforge'): Promise<boolean> {
    const prefix = loader === 'fabric' ? 'fabric-loader' : 'neoforge';
    const versionsDir = join(this.baseDir, 'versions');
    try {
      const entries = await import('node:fs/promises').then((f) => f.readdir(versionsDir));
      return entries.some((e) => e.startsWith(prefix) && e.includes(version));
    } catch {
      return false;
    }
  }

  /**
   * 一键安装加载器（Fabric / NeoForge）。
   * 原理：下载官方 installer jar → 静默运行 client 安装到 launcher 目录。
   * 安装产物: versions/fabric-loader-<ver>/ 或 versions/neoforge-<ver>/（官方 installer 生成）。
   */
  async installLoader(
    version: string,
    loader: 'fabric' | 'neoforge',
    onProgress?: DownloadProgress,
  ): Promise<void> {
    const java = process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java';
    onProgress?.('versions', 0, 1);

    if (loader === 'fabric') {
      const installerPath = join(this.baseDir, 'fabric-installer.jar');
      if (!(await exists(installerPath))) {
        const url =
          'https://maven.fabricmc.net/net/fabricmc/fabric-installer/latest/fabric-installer.jar';
        const buf = await this.download(url);
        await writeFileAtomic(installerPath, buf);
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          java,
          [
            '-jar',
            installerPath,
            'client',
            '-mcversion',
            version,
            '-dir',
            this.baseDir,
            '-loader',
            'latest',
            '-noprofile',
          ],
          { stdio: 'ignore' },
        );
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Fabric 安装失败（退出码 ${code}）`));
        });
        child.on('error', reject);
      });
    } else {
      // NeoForge: 先解析版本对应的 installer URL（maven 元数据）
      const metadataUrl =
        'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
      const metaBuf = await this.download(metadataUrl);
      const metaText = metaBuf.toString('utf-8');
      // 匹配该 MC 版本的最新稳定 installer（如 26.1.x 系列取最大 build）
      const re = new RegExp(`<version>${version.replace(/\./g, '\\.')}\\.(\\d+)</version>`, 'g');
      let m: RegExpExecArray | null;
      let best = '';
      while ((m = re.exec(metaText)) !== null) {
        best = `${version}.${m[1]}`;
      }
      if (!best) throw new Error(`未找到 NeoForge ${version} 的 installer`);
      const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${best}/neoforge-${best}-installer.jar`;
      const installerPath = join(this.baseDir, `neoforge-${best}-installer.jar`);
      if (!(await exists(installerPath))) {
        const buf = await this.download(installerUrl);
        await writeFileAtomic(installerPath, buf);
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(java, ['-jar', installerPath, '--installClient', this.baseDir], {
          stdio: 'ignore',
        });
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`NeoForge 安装失败（退出码 ${code}）`));
        });
        child.on('error', reject);
      });
    }
    onProgress?.('versions', 1, 1);
  }

  // ===== Mod 管理 =====

  /** 版本 mods 目录（Fabric 加载器版 mods 在版本目录，vanilla 版在 gameDir） */
  modsDir(version: string): string {
    return join(this.baseDir, 'versions', version, 'mods');
  }

  /** 列出已安装 Mod（.jar 文件） */
  async listMods(version: string): Promise<string[]> {
    const dir = this.modsDir(version);
    try {
      const entries = await import('node:fs/promises').then((f) => f.readdir(dir));
      return entries.filter((e) => e.endsWith('.jar'));
    } catch {
      return [];
    }
  }

  /** 下载 Mod jar 到版本 mods 目录（url 为 Modrinth 版本文件直链） */
  async installMod(version: string, name: string, url: string): Promise<string> {
    const dir = this.modsDir(version);
    const dest = join(dir, name.endsWith('.jar') ? name : `${name}.jar`);
    if (await exists(dest)) return dest;
    const buf = await this.download(url);
    await writeFileAtomic(dest, buf);
    return dest;
  }

  /** 删除已装 Mod */
  async removeMod(version: string, name: string): Promise<void> {
    const dest = join(this.modsDir(version), name);
    await import('node:fs/promises').then((f) => f.rm(dest, { force: true }));
  }

  // ===== 第三方皮肤 / 认证站（§1.2 / §5.8 / §19 合规闸门）=====

  /**
   * **启用第三方认证站（authlib-injector / Yggdrasil）—— 唯一的产品路径。**
   *
   * 三道闸门（缺一即拒绝，见 `compliance-gate.ts`）：
   * 1. 默认关闭：`thirdPartyAuth` 未注入、或 `enabled !== true` → 拒绝；
   * 2. 显式确认：必须现场通过确认弹窗（展示 §1.2 三条立场全文）；
   * 3. 风险提示：确认框 detail 含 `RISK_NOTICE` 全文，不是摘要。
   *
   * 通过后才委派给 `installSkinSupport()` 装 CustomSkinLoader 配置。
   */
  async enableThirdPartyAuth(
    version: string,
    skinApiUrl: string,
    onProgress?: DownloadProgress,
  ): Promise<void> {
    if (this.thirdPartyAuth === undefined) {
      throw new ComplianceDeniedError(
        'no_confirm_fn',
        '未接入第三方认证站的合规闸门（fail-closed）。' +
          '按 §1.2/§19，该能力默认关闭，需显式启用并通过风险确认。',
      );
    }
    await this.thirdPartyAuth.authorize(skinApiUrl);
    await this.installSkinSupport(version, skinApiUrl, onProgress);
  }

  // ===== 离线皮肤（CustomSkinLoader）=====

  /**
   * 安装第三方皮肤支持（**低层原语，不要从产品路径直接调**）：
   * 1. 下载 CustomSkinLoader mod（Fabric，Modrinth）到 mods 目录
   * 2. 生成 CustomSkinLoader 配置（皮肤站 API 列表）到 game 目录 config/
   *
   * ⚠️ **合规边界（§1.2 / §5.8 / §19）**：本方法**不做**任何合规判断，
   * 因此**产品路径必须走 `enableThirdPartyAuth()`**（默认关闭 + 显式确认
   * + 风险提示全文）。保留为 public 仅因为它是 `enableThirdPartyAuth` 的
   * 实现细节与既有测试的落点。
   *
   * 补充说明：CustomSkinLoader 是**纹理源**（皮肤/披风图片）插件，
   * **不是** authlib-injector —— 它不替换游戏的 Yggdrasil 认证环节，
   * 因此即使启用也不会改变你的微软账户登录方式。这正是 §5.8 允许它存在
   * 的原因（第三方皮肤站），也与「不得用于绕过正版验证」不冲突。
   */
  async installSkinSupport(
    version: string,
    skinApiUrl: string,
    onProgress?: DownloadProgress,
  ): Promise<void> {
    onProgress?.('versions', 0, 2);
    // CustomSkinLoader 最新 Fabric 版本（Modrinth 项目 customskinloader）
    const projUrl =
      'https://api.modrinth.com/v2/project/customskinloader/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%2226.1%22%5D';
    try {
      const projBuf = await this.download(projUrl);
      const versions = JSON.parse(projBuf.toString('utf-8'));
      const latest = versions[0];
      const file = latest?.files?.[0];
      if (!file?.url) throw new Error('未找到 CustomSkinLoader 下载');
      await this.installMod(version, latest.files[0].filename, file.url);
      onProgress?.('versions', 1, 2);

      // 生成配置（放 game 目录的 config/ 下，CustomSkinLoader 读取）
      const gameDir = join(this.baseDir, 'game', version);
      const configDir = join(gameDir, 'config');
      const cfgPath = join(configDir, 'CustomSkinLoader', 'CustomSkinLoader.json');
      const config = {
        version: 2,
        loadlist: [
          {
            name: 'LittleSkin',
            type: 'CustomSkinAPI',
            // 第三方纹理站（皮肤 + 该站自己的披风）。这是**第三方站提供的**披风，
            // 与 §5.8「披风仅正版、走 Mojang API」是两条独立能力：
            // 正版披风由 `MicrosoftAuthService.activeCape()` 从 Mojang profile 读。
            // 本项只在过合规闸门后才会被写入（见 enableThirdPartyAuth）。
            root: skinApiUrl || DEFAULT_THIRD_PARTY_SKIN_API,
          },
        ],
        enableDynamicSkull: true,
        enableTransparentSkin: true,
        forceUseHttpsPing: true,
        enableCape: true,
      };
      await writeFileAtomic(cfgPath, Buffer.from(JSON.stringify(config, null, 2)));
      onProgress?.('versions', 2, 2);
    } catch (e) {
      throw new Error(`皮肤支持安装失败: ${(e as Error).message}`);
    }
  }
}
