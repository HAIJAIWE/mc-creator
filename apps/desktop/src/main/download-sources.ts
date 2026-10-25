/**
 * 下载源的**候选列表**（对标 PCL `ModMinecraft.vb` L2154-2173）。
 *
 * ## 为什么不叫「镜像回退」
 *
 * 「主源失败就换镜像」是个误导性的说法 —— 它暗示镜像只是保险。
 * PCL 的做法不同：**一开始就构造一个有序候选列表**，原 URL 永远是其中之一，
 * 镜像只是多出来的另一个候选。谁排前面由**用户设置**决定。
 *
 * 三条性质：
 *
 * 1. **原 URL 永不丢弃** —— 镜像是补充，不是替换。用户把优先级切到镜像优先
 *    时，官方源仍在候选里；镜像整体挂掉时会自然落到它。
 * 2. **不是所有 URL 都可替换** —— Mojang 锁定的路径
 *    （``/v1/objects``、``client.txt``、``.tsrg``）走的是映射文件那条路，
 *    不参与 maven 的前缀替换。PCL 也是这么分的。
 * 3. **顺序由用户决定** —— 同一份代码，国内用户和国外用户的正确答案相反。
 *    写死任何一种都是在替用户做他不该被代替的决定。
 *
 * ## 两个镜像家族，一个开关
 *
 * - **原版游戏**：`bmclapi2.bangbang93.com`（BMCLAPI），换 maven 前缀
 * - **Mod / 整合包 / 数据包 / 资源包 / 光影包**：`mod.mcimirror.top`（MCIM），
 *   换 `api.modrinth.com` / `cdn.modrinth.com` / `api.curseforge.com` /
 *   `edge.forgecdn.net` 等主机（映射表在 core 的 `sources/mirror.ts`，与 PCL
 *   `ModDownload.vb` L1307-1316 同款，但只认整段前缀）
 *
 * 两家是**同一件事**：把国内连不动的官方地址换成国内能连的地址。所以共用一个
 * `preferOfficial` 开关 —— 让用户为了「下得快」去两个地方各切一次是糟糕的 UI。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mirrorUrlOf, type SourcePreference as CoreSourcePreference } from '@mc-creator/core';

import { abortError, isAbortError, sleepAbortable, throwIfAborted } from './abort.js';

/** BMCLAPI —— 国内社区维护的 Mojang 资源镜像。 */
export const MIRROR_ORIGIN = 'https://bmclapi2.bangbang93.com/';

/** 候选列表里展示给用户看的两个镜像名（错误信息里会出现，所以要能区分）。 */
export const BMCLAPI_LABEL = 'BMCLAPI 镜像';
export const MCIM_LABEL = '国内镜像 (MCIM)';

/** 官方清单源（与本仓 resolveVersion 用的 piston-meta 是同一批服务的两个入口）。 */
export const OFFICIAL_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

/** 一个候选下载源。`official: false` 表示它是镜像。 */
export interface DownloadSource {
  url: string;
  /** 展示给用户看，让用户知道当前用的是哪个源。 */
  label: string;
  official: boolean;
}

/**
 * 用户偏好：镜像优先还是官方优先。
 *
 * ## 默认：国内镜像优先
 *
 * 这个仓是中文市场的启动器，用户绝大多数在国内 —— 对国内网络，
 * `launchermeta.mojang.com` / `api.modrinth.com` / `edge.forgecdn.net`
 * 常常是"能通但很慢"或干脆连不上，而这正好是本项目存在的理由之一。
 *
 * 代价诚实说：镜像**能看到你下了什么**（它在中间）。所以：
 * - 官方源**永远留在候选列表里**（镜像挂了就落回它，不是"镜像挂了才发现没有官方"）
 * - 文件按清单给的 sha1 / sha512 校验（内容被改过就落不了盘）
 * - 设置里一键切回官方优先（`SettingsPanel` → 下载源），想让流量只走官方的人有路走
 *
 * 换句话说：默认值照顾了「装不上 / 慢到不能用」这个更大的问题，
 * 而信任问题用「可切换 + 校验 + 官方兜底」三件事兜住，而不是靠把默认设成官方。
 *
 * （PCL 的 `ToolDownloadMod` 默认是 2 = 官方优先，`Settings.vb` L124。
 * 我们在这里与它**不同** —— 因为 PCL 的默认值面向全球用户，而本仓不是。）
 */
export interface SourcePreference extends CoreSourcePreference {
  /** true = 官方优先（镜像排后面）；false = 镜像优先。 */
  preferOfficial: boolean;
}

/**
 * 缺省偏好（国内镜像优先）。见 {@link SourcePreference} 的理由。
 *
 * 冻结：它是全局共享的默认值对象，谁改一下就会改掉所有新装的默认行为。
 */
export const DEFAULT_SOURCE_PREFERENCE: Readonly<SourcePreference> = Object.freeze({
  preferOfficial: false,
});

/** Mojang 锁定的路径：不参与 maven 前缀替换。 */
function isMojangLocked(url: string): boolean {
  return (
    url.includes('launcher.mojang.com/v1/objects') ||
    url.includes('client.txt') ||
    url.includes('.tsrg')
  );
}

/**
 * 把 maven 系 URL 的前缀换成镜像，得到镜像候选。
 *
 * 非 maven 系返回 null —— 不是所有 URL 都有镜像。
 *
 * 做法与 PCL L2167 同构：把第一个 `maven` **之前**的前缀整段换成镜像根，
 * `maven` 之后的路径原样保留（镜像上的仓库布局与官方一致）。
 */
function mirrorOf(url: string): string | null {
  const i = url.indexOf('maven');
  if (i < 0) return null;
  // MIRROR_ORIGIN 自带结尾斜杠，直接接 maven 之后的部分即可。
  return MIRROR_ORIGIN + url.slice(i + 'maven'.length);
}

/**
 * 展开成一个有序候选列表。**纯函数**，不碰网络也不碰磁盘。
 *
 * 两类镜像各管一段（见文件头）：maven 系走 BMCLAPI，Modrinth / CurseForge 系
 * 走 MCIM。一个 URL 只会命中其中一类，命中不了就只有官方一个候选。
 *
 * @param url 清单/文件给的原始地址
 * @param prefer 顺序偏好；缺省国内镜像优先（见 {@link DEFAULT_SOURCE_PREFERENCE}）
 */
export function expandDownloadCandidates(
  url: string,
  prefer: SourcePreference = DEFAULT_SOURCE_PREFERENCE,
): DownloadSource[] {
  const official: DownloadSource = { url, label: '官方源', official: true };

  // Mojang 锁定的路径不参与替换（见文件头性质 2）
  if (isMojangLocked(url)) return [official];

  const mirror = mirrorCandidateOf(url);
  if (mirror === null) return [official];

  // 官方优先 → 镜像排后面；镜像优先 → 镜像排最前。原始 URL 始终保留在列表里。
  return prefer.preferOfficial ? [official, mirror] : [mirror, official];
}

/** 这个地址的镜像候选（BMCLAPI 或 MCIM），没有返回 null。 */
function mirrorCandidateOf(url: string): DownloadSource | null {
  const bmcl = mirrorOf(url);
  if (bmcl !== null) {
    return { url: bmcl, label: BMCLAPI_LABEL, official: false };
  }
  const mcim = mirrorUrlOf(url);
  if (mcim !== null) {
    return { url: mcim, label: MCIM_LABEL, official: false };
  }
  return null;
}

/** 本仓默认的清单入口。 */
export const DEFAULT_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

/** 官方在 BMCLAPI 上的清单镜像（该域名没有 maven 子路径，所以单列）。 */
const MIRROR_MANIFEST = 'https://bmclapi2.bangbang93.com/mc/game/version_manifest.json';

/**
 * 版本清单的候选。
 *
 * 与普通文件不同：清单 URL 里**没有 `maven` 字样**，走不到
 * {@link expandDownloadCandidates} 的自动替换，所以镜像候选在这里单列。
 *
 * 官方有两个入口（piston-meta / launchermeta），内容同源 ——
 * 哪个先通用哪个，这不是镜像，是同一家的两个域名。
 */
export function manifestCandidates(prefer: SourcePreference): DownloadSource[] {
  const official: DownloadSource[] = [
    { url: DEFAULT_MANIFEST, label: '官方源 (piston-meta)', official: true },
    { url: OFFICIAL_MANIFEST, label: '官方源 (launchermeta)', official: true },
  ];
  const mirror: DownloadSource = {
    url: MIRROR_MANIFEST,
    label: BMCLAPI_LABEL,
    official: false,
  };
  return prefer.preferOfficial ? [...official, mirror] : [mirror, ...official];
}

/**
 * 把 `fetch` 包成「按候选源依次尝试」的版本。
 *
 * ## 为什么需要它（实测，2026-10-18）
 *
 * 整合包安装 / mod 下载走的是一批**直接调 `fetch`** 的代码路径（主进程把
 * `fetchImpl` 传进 `installModpackFiles`），它们没有 `LauncherService.download`
 * 那套「退避 + 换源 + 校验」的循环。实测装 Fabulously Optimized（26.3，
 * 49 个文件）：镜像偶发 **502**，一次安装就丢了 7 个 mod，界面如实报
 * 「下载失败: HTTP 502」；而同一批 URL 一分钟后再取**全部 200**。
 *
 * 也就是说 502 在这里是「服务端一时抽风」，不是「这个文件不存在」。
 * 一次抖动换来用户少一个 mod（而整合包少 mod 往往表现为进游戏崩），
 * 这个代价完全不该付 —— 官方源本来就一直躺在候选列表里。
 *
 * ## 语义
 *
 * - **403 / 404 → 换下一个候选，不重试**（"这个源上没有"，重试没意义）
 * - **5xx / 429 / 网络异常 → 退避后重试同一个候选，再换下一个**
 * - 别的非 2xx（401 等）原样返回，交给调用方按自己的文案报（不浪费用户时间）
 * - 所有候选都不成 → 返回**最后一个非 2xx 响应**（调用方还能读到状态码）；
 *   一个响应都没拿到（全抛了）才抛最后一个错误
 */
export function makeCandidateFetch(options: {
  /**
   * **每次调用**都重新读一次偏好 —— 设置里刚把源切完，下一次下载就得用新顺序，
   * 不能是"下次重启才生效"。
   */
  readPreference: () => SourcePreference;
  /** 底层 fetch；缺省全局 `fetch`（测试注入替身）。 */
  fetchImpl?: typeof fetch;
  /** 等待实现；缺省 `setTimeout`（测试注入，别让用例真的睡）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 每个候选最多试几次（含第一次）。 */
  attempts?: number;
}): typeof fetch {
  // 注意是**包一层**而不是直接取 ``options.fetchImpl ?? fetch``：后者在
  // `makeCandidateFetch` 被调用的那一刻就把全局 `fetch` 抓死了。测试里
  // `vi.stubGlobal('fetch')` 是在模块导入之后才装的，抓死的版本会绕过替身去
  // 打真网络（用例里表现为莫名其妙的 404）。
  const baseFetch: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = options.attempts ?? 2;

  return async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const candidates = expandDownloadCandidates(url, options.readPreference());
    const signal = init?.signal ?? undefined;
    let lastErr: unknown;
    let lastRes: Response | null = null;

    for (const candidate of candidates) {
      for (let i = 0; i < attempts; i++) {
        // 用户已经点取消：别再为一个文件换源 / 重试。
        throwIfAborted(signal);
        try {
          const res = await baseFetch(candidate.url, init);
          // 取消可能发生在响应头到达、body 还没读的时候；交给调用方去 abort body。
          throwIfAborted(signal);
          if (res.ok) return res;
          lastRes = res;
          // 确定性失败：这个源上没有 —— 立刻换下一个候选
          if (res.status === 403 || res.status === 404) break;
          // 别的 4xx（401…）不是"再试一次"能解决的，也别替用户决定换源
          if (res.status < 500 && res.status !== 429) return res;
        } catch (e) {
          // 取消不是"网络抖动"：不重试、不换源、不退避。
          if (isAbortError(e)) throw e;
          if (signal?.aborted) throw abortError();
          lastErr = e;
        }
        // 5xx / 429 / 网络异常：退避后重试（最后一次不白等）
        if (i < attempts - 1) {
          if (signal) await sleepAbortable(500 * (i + 1), signal);
          else await sleep(500 * (i + 1));
        }
      }
    }

    if (lastRes !== null) return lastRes;
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
}

const PREFS_FILE = 'download-source.json';

/** 偏好设置的持久化：`<baseDir>/download-source.json`，读不出来就用默认值。 */
export class SourcePreferenceStore {
  private cache: SourcePreference | null = null;

  constructor(private readonly baseDir: string) {}

  /** 读取；文件不存在 / 损坏 → 返回默认值（国内镜像优先），不抛。 */
  read(): SourcePreference {
    if (this.cache !== null) return this.cache;
    this.cache = this.readFromDisk();
    return this.cache;
  }

  private readFromDisk(): SourcePreference {
    const path = join(this.baseDir, PREFS_FILE);
    try {
      if (!existsSync(path)) return { ...DEFAULT_SOURCE_PREFERENCE };
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as { preferOfficial?: unknown };
      // 只认 true/false；字符串 "false" 之类一律当默认，别让脏数据改掉信任模型
      const v = raw.preferOfficial;
      return typeof v === 'boolean' ? { preferOfficial: v } : { ...DEFAULT_SOURCE_PREFERENCE };
    } catch {
      // 文件损坏：按默认值走，但**不吞掉**这个事实之外的任何东西（这里只能如此，
      // 读取偏好不应该让整个启动器起不来）
      return { ...DEFAULT_SOURCE_PREFERENCE };
    }
  }

  /** 写入；失败只抛给调用方决定，自身不吞（静默失败是这个项目的忌讳）。 */
  write(pref: SourcePreference): void {
    mkdirSync(dirname(join(this.baseDir, PREFS_FILE)), { recursive: true });
    writeFileSync(join(this.baseDir, PREFS_FILE), JSON.stringify(pref, null, 2), 'utf-8');
    this.cache = pref;
  }

  /** 仅供测试 */
  reset(): void {
    this.cache = null;
  }
}

/**
 * 应用级**共享**的偏好存储（按目录缓存）。
 *
 * 为什么不能各处 `new SourcePreferenceStore(dir)`：`read()` 有内存缓存，
 * 每个实例各缓存一份 —— 设置页刚把偏好切到「官方源优先」，下载那边
 * `LauncherService` 手里的实例还拿着旧值，表现就是「切了没反应」。
 *
 * 全应用共用同一个实例，`write()` 顺手更新缓存（见 `write`），立刻就一致了。
 */
const sharedStores = new Map<string, SourcePreferenceStore>();

export function sourcePreferenceStore(baseDir: string): SourcePreferenceStore {
  const existing = sharedStores.get(baseDir);
  if (existing !== undefined) return existing;
  const created = new SourcePreferenceStore(baseDir);
  sharedStores.set(baseDir, created);
  return created;
}
