/**
 * 皮肤 3D 预览（skinview3d）。
 *
 * 抽出来是因为要用在两处：实例的皮肤库（`SkinTab`）与下载页的皮肤详情，
 * 两套各写一份必然漂。
 *
 * ## 为什么列表用 2D 合成、详情才上 3D
 *
 * - **列表**用 `skin-preview.shared.ts` 的 2D 合成：纯 canvas，几十条列表
 *   同时渲染毫无压力。但它按 **classic 的 4px 手臂**取样，slim 皮肤的手臂
 *   边会多一列杂色（源站条目不带模型信息，猜不得）。
 * - **详情**这里用 skinview3d，它的 `model` 默认就是 `"auto-detect"` ——
 *   直接从贴图推断 slim/classic，两种模型都准。
 *
 * 也就是说列表里那点瑕疵，到详情看一眼就能确认，不会误判。
 *
 * 失败（WebGL 不可用、贴图加载不了）时**静默**退回空 canvas：预览失败不该
 * 挡住导入/应用这些真正的操作。
 */
import { useEffect, useRef } from 'react';
import { SkinViewer, type ModelType } from 'skinview3d';

export function Skin3DPreview({
  url,
  width = 220,
  height = 300,
  /** 不传就交给 skinview3d 自动判（推荐）；显式传会覆盖自动判定。 */
  model,
}: {
  url: string | null;
  width?: number;
  height?: number;
  model?: ModelType;
}): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null || url === null || url === '') return;
    let viewer: SkinViewer | null = null;
    try {
      viewer = new SkinViewer({ width, height, canvas });
      void viewer.loadSkin(url, model === undefined ? {} : { model });
    } catch {
      // 只是预览，失败不打断用户操作
      viewer = null;
    }
    return () => {
      try {
        viewer?.dispose();
      } catch {
        /* 已销毁 */
      }
    };
  }, [url, width, height, model]);

  return url === null || url === '' ? null : <canvas ref={ref} aria-hidden className="shrink-0" />;
}
