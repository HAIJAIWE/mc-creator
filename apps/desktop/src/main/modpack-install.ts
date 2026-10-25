/**
 * 整合包文件落盘：清单里的一个文件 → 磁盘上的一个文件。
 *
 * ## 为什么单独成模块
 *
 * 这段逻辑以前长在 `ipc/launcher.ts` 的 handler 里，于是测试只能**照着抄一份
 * 再测**（`modpack-install.test.ts` 里的 `applyOverrides` 就是抄的）。抄件绿了
 * 不等于线上那份绿 —— 改一边忘另一边，测试照样全绿。抽出来之后测试直接调这个
 * 函数，断言的是**真正在跑的那份逻辑**。
 *
 * ## 三条不能忘的规则（每条都有用户能看见的症状）
 *
 * 1. **路径必须过 `resolveInside`** —— 清单来自任意第三方上传的 zip，
 *    `../../` 会写到 gameDir 外面。
 * 2. **下载完校验 sha1**（清单里有就比）—— 断流 / CDN 返回半个文件时，
 *    坏 jar 会静默躺进 `mods/`，症状是「装完了进游戏崩」。PCL 也是下完即校验
 *    （`ModModpack.vb` 的 `FileChecker`）。缺哈希的文件照旧装：没有参照物时
 *    无从校验，不该因此拒绝安装。
 * 3. **服务端专用条目不装**（`client === false`）—— 我们是客户端启动器，
 *    装上服务端专用的 mod 会让实例起不来。
 *
 * 单条失败**不中断整包**：整合包里一个文件挂了，其余几十个照装，挂掉的那些
 * 如实报给用户（`failed`），比「一个坏就全不装」有用得多。
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ModpackFile } from '@mc-creator/core';

import { abortable, isAbortError, throwIfAborted } from './abort.js';
import { resolveInside } from './launcher-service.js';

/** 装不下去的条目。`error` 直接给用户看，所以必须是能读懂的话。 */
export interface ModpackInstallFailure {
  name: string;
  error: string | null;
}

export interface ModpackInstallResult {
  /** 真正写盘成功的文件数。 */
  installed: number;
  /** 没装成的（含服务端专用被跳过之外的所有失败）。 */
  failed: ModpackInstallFailure[];
  /**
   * 用户取消（只可能是取消，不是别的「没装完」）。
   *
   * 取消是**正常结果**：已经落盘的文件保留、账本照记，不能再当失败重试。
   * 调用方拿到它应当停下后续步骤（清理旧版本等）并如实告诉用户。
   */
  cancelled?: boolean;
}

/**
 * 装清单里的文件。
 *
 * `resolveRedirect` 负责把「托管在 CurseForge、清单没给直链」的条目换成真链接
 * （拿不到就返回 null —— 由调用方决定怎么提示，通常是「去填 API Key」）。
 * 换成回调而不是把 CF 客户端塞进来：这个函数只需要「给我一个 URL」这一件事，
 * 依赖窄了才好测。
 */
export async function installModpackFiles(args: {
  /** 实例游戏目录（清单里的路径都是相对它的）。 */
  gameDir: string;
  files: ModpackFile[];
  /** CurseForge 重定向 → 直链；拿不到返回 null。 */
  resolveRedirect: (
    cf: { projectId: number; fileId: number } | undefined,
  ) => Promise<string | null>;
  /** 进度回调：第 index 个（从 0 起）/共 total 个，file 是当前条目。 */
  onProgress?: (index: number, total: number, file: ModpackFile) => void;
  /**
   * 每个文件**成功落盘后**调一次（下载失败 / sha1 不匹配 / 服务端专用被跳过的
   * 都不算）。调用方拿它把这批文件记进实例的下载账本（见
   * `download-index.ts`）—— 用户装完整合包、之后又从搜索页下同一个 mod 时，
   * 靠账本才能认出「这是同一个项目的旧文件」并替换掉。
   */
  onFileInstalled?: (file: ModpackFile, url: string) => void;
  /** 下载实现，缺省用全局 fetch（测试可以塞假的，不必动全局）。 */
  fetchImpl?: typeof fetch;
  /**
   * 取消信号。检查点：每个文件开始前、重定向期间、下载期间、落盘前后。
   *
   * 有写盘副作用的调用不能只 race —— fetch 要真把 signal 传下去，否则用户
   * 取消后文件还在后台写，下一次安装会撞见半套内容。
   */
  signal?: AbortSignal;
}): Promise<ModpackInstallResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const failed: ModpackInstallFailure[] = [];
  let installed = 0;
  const total = args.files.length;

  for (const [i, f] of args.files.entries()) {
    // 已取消：不再发下一个请求，也不把剩下的文件误记成「失败」。
    if (args.signal?.aborted) return { installed, failed, cancelled: true };
    args.onProgress?.(i, total, f);
    // 服务端专用：不装，也不算失败（清单本来就写了「客户端不需要」）
    if (!f.client) continue;
    try {
      const dest = resolveInside(args.gameDir, f.targetPath);
      await mkdir(dirname(dest), { recursive: true });

      let url = f.url;
      if (url === null) {
        const cf = await abortable(args.resolveRedirect(f.curseforge), args.signal);
        if (cf === null) {
          failed.push({
            name: f.name,
            error: '该文件托管在 CurseForge，需要在「设置 → CurseForge」填 API Key 才能下载',
          });
          continue;
        }
        url = cf;
      }

      const res = await fetchImpl(url, args.signal ? { signal: args.signal } : undefined);
      if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      throwIfAborted(args.signal);

      const want = f.sha1?.toLowerCase();
      if (want !== undefined) {
        const got = createHash('sha1').update(buf).digest('hex');
        if (got !== want) {
          failed.push({
            name: f.name,
            error: `文件校验失败（sha1 不匹配，期望 ${want} 实际 ${got}）—— 未写入，重装整合包通常能好`,
          });
          continue;
        }
      }

      await writeFile(dest, buf);
      installed++;
      // 落盘成功才通知 —— 记账本的语义是"这个文件确实下了"
      args.onFileInstalled?.(f, url);
      // 取消发生在写盘途中：这个文件已经完整落盘，保留并记账，但不再继续。
      if (args.signal?.aborted) return { installed, failed, cancelled: true };
    } catch (err) {
      // 取消不是「这个文件坏了」：不能推失败列表，也不能继续装下一个。
      if (isAbortError(err) || args.signal?.aborted) {
        return { installed, failed, cancelled: true };
      }
      failed.push({ name: f.name, error: (err as Error).message });
    }
  }

  return { installed, failed };
}
