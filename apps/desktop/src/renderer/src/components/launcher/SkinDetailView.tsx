/**
 * 下载页「皮肤」分类的详情视图。
 *
 * ## 为什么皮肤也需要详情页
 *
 * mod 那一侧点结果行会进 `ModDetailView`，皮肤之前只有一个列表加两个按钮，
 * 连「放大看」都没有 —— 但皮肤恰恰是最需要细看的东西：源站条目只有编号，
 * 不放大根本不知道自己在挑谁。
 *
 * 这里提供三样列表里给不了的东西：
 * 1. **3D 预览**（skinview3d，模型自动判 slim/classic）—— 可以拖着转，
 *    能看清正面缩略图里看不出的小细节，也能确认模型对不对。
 * 2. **完整贴图**原图展示（列表里是 8×32 的正面合成，看不到背面）。
 * 3. 编号 / uuid / 直链，方便核对与另存。
 *
 * ## 仍然如实说的事
 *
 * 源站（MineSkin）条目只有编号，没有名字也没有作者，所以详情页也**没有名字**。
 * 不编一个（比如用上传时间当名字），那是在骗用户。
 */
import { ArrowLeft, Download, Loader2, RefreshCw, X } from 'lucide-react';

import { Skin3DPreview } from './skin-3d-preview.js';
import type { MineSkinEntryT } from '../../../../shared/ipc/launcher.js';

export function SkinDetailView({
  skin,
  targetInstance,
  playerNameOk,
  importing,
  onBack,
  onImport,
  onRefresh,
  onCloseError,
}: {
  skin: MineSkinEntryT;
  /** 「应用到玩家」那一栏的实例名，详情里复述一次（换分类可能改掉）。 */
  targetInstance: string;
  playerNameOk: boolean;
  importing: boolean;
  onBack: () => void;
  /** `alsoApply` = 是否顺手应用到玩家名。 */
  onImport: (mineskinId: number, alsoApply: boolean) => void;
  onRefresh: () => void;
  onCloseError?: () => void;
}): JSX.Element {
  const num = String(skin.id);
  return (
    <div className="flex h-full flex-col" aria-label="皮肤详情">
      {/* 顶栏：返回 + 标题 + 刷新。
          三条分支（加载中 / 出错 / 空）都复用它 —— 少了返回键用户就被困住，
          而出错恰恰发生在网络最差、最需要退出去的时候。 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <button
          onClick={onBack}
          className="mc-btn-ghost"
          aria-label="返回皮肤列表"
          title="返回皮肤列表"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="truncate text-xs font-medium text-mc-text">皮肤 #{num}</span>
        <button
          onClick={onRefresh}
          className="mc-btn-ghost ml-auto"
          aria-label="刷新详情"
          title="刷新详情"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-wrap items-start gap-6">
          {/* 3D 预览：可以拖动旋转。这里不传 model，让 skinview3d 从贴图自动判
              slim / classic —— 列表里的 2D 合成是固定按 classic 取的，
              这里是准确的。 */}
          <div className="rounded-mc border border-mc-border p-2">
            <Skin3DPreview url={skin.textureUrl} width={200} height={280} />
            <div className="mt-1 text-center text-[10px] text-mc-text-dim">
              可拖动旋转 · 模型自动识别
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            {/* 完整贴图原图：8×32 的正面合成看不到背面 */}
            <section className="rounded-mc border border-mc-border p-2">
              <div className="mb-1 text-[10px] text-mc-text-dim">完整贴图（原图，未裁剪）</div>
              <img
                src={skin.textureUrl}
                alt={`皮肤 #${num} 的完整贴图`}
                loading="lazy"
                className="h-40 w-40"
                style={{ imageRendering: 'pixelated' as const }}
              />
            </section>

            <section className="text-[11px] text-mc-text-dim">
              <div>
                编号 <span className="text-mc-text">#{num}</span>
              </div>
              <div className="mt-0.5 break-all">
                uuid <span className="text-mc-text">{skin.uuid}</span>
              </div>
              {skin.time !== null && skin.time !== undefined && (
                <div className="mt-0.5">
                  上传于{' '}
                  <span className="text-mc-text">
                    {new Date(skin.time * 1000).toLocaleString('zh-CN')}
                  </span>
                </div>
              )}
              <div className="mt-1 break-all">
                直链 <span className="text-mc-text">{skin.textureUrl}</span>
              </div>
            </section>

            <section className="rounded-mc border border-mc-border px-2 py-1.5 text-[10px] text-mc-text-dim">
              皮肤站（MineSkin）只给编号，没有名字和作者，所以这里也没有名字 ——
              不想编一个骗你。认皮肤请看 3D 预览。
            </section>
          </div>
        </div>

        {/* 操作：与列表里的两个按钮语义一致 */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-mc-border pt-3">
          <button
            onClick={() => onImport(skin.id, false)}
            disabled={importing}
            className="mc-btn"
            title="存进皮肤库（不应用）"
          >
            {importing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            导入
          </button>
          <button
            onClick={() => onImport(skin.id, true)}
            disabled={importing || !playerNameOk || targetInstance === ''}
            className="mc-btn-primary"
            title={
              targetInstance === ''
                ? '请先在上方选择一个实例'
                : !playerNameOk
                  ? '请先填一个合法的玩家名（不能含 / \\ 或 ..）'
                  : '存进皮肤库，并复制到该实例的 LocalSkin/skins/'
            }
          >
            导入并应用
          </button>
          <span className="text-[10px] text-mc-text-dim">
            {targetInstance === ''
              ? '未选择实例'
              : !playerNameOk
                ? '玩家名不合法'
                : `将应用到 ${targetInstance}`}
          </span>
          {onCloseError !== undefined && (
            <button onClick={onCloseError} className="mc-btn-ghost ml-auto" aria-label="关闭提示">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
