/**
 * 游戏启动器服务（迷你版 PCL2/HMCL，离线模式）。
 *
 * 链路：版本清单 → 下载 client.jar → 下载 assets → 下载 libraries → 启动 Java。
 *
 * 设计：
 * - 纯 Node 原生实现（fetch + fs），无第三方依赖
 * - 目录结构（userData/mc-launcher/）：
 *   - versions/<ver>/<ver>.json + <ver>.jar
 *   - assets/indexes/<ver>.json + objects/<hash前2>/<hash>
 *   - libraries/<groupPath>/<artifact>/<ver>/<artifact>-<ver>.jar
 * - 离线模式启动（accessToken=0，UUID 随机）
 * - 1.21.x 使用官方 Mojang 映射，无 natives 下载（新库方案）
 */

import { join, dirname } from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

/**
 * 启动器服务。baseDir = userData/mc-launcher。
 * 所有方法可独立测试（注入 baseDir + 可选 fetch）。
 */
export class LauncherService {
  constructor(
    readonly baseDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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
    for (const [path, obj] of entries) {
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

  /** 组装 classpath 并启动 Java（离线模式） */
  async launchGame(
    detail: VersionDetail,
    opts: { username: string; memory: string; gameDir: string; javaPath?: string },
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
    const uuid = randomUUID();
    const args = [
      `-Xmx${opts.memory}`,
      `-Xms${opts.memory}`,
      '-cp',
      classpath,
      'net.minecraft.client.main.Main',
      '--username',
      opts.username || 'Steve',
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
      '0',
      '--userType',
      'legacy',
    ];

    const child: ChildProcess = spawn(java, args, { stdio: 'ignore' });
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

  // ===== 离线皮肤（CustomSkinLoader）=====

  /**
   * 安装离线皮肤支持：
   * 1. 下载 CustomSkinLoader mod（Fabric，Modrinth）到 mods 目录
   * 2. 生成 CustomSkinLoader 配置（皮肤站 API 列表）到 game 目录 config/
   * 皮肤站: LittleSkin 为国内主流（https://littleskin.cn/api/yggdrasil）
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
            root: skinApiUrl || 'https://littleskin.cn/api/yggdrasil',
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
