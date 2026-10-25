import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SkinPixelEditor, type SkinPixelEditorHandle } from './SkinPixelEditor';
import { installCanvasStub, type CanvasStub } from '../../../../test/canvas-stub';

/**
 * 画布「挂载后必须真正画一次」的回归测试。
 *
 * 背景（真机实测）：ready=false 时 <canvas> 不渲染，`redraw` 的 effect 在挂载时
 * 拿不到 viewRef；等图片载入 setReady(true) 让 canvas 挂载后，`redraw` 的依赖
 * （layers/filters/grid）没有变化，effect 不会重跑 —— 结果是 512×512 画布
 * 262144 个像素全透明，连棋盘格底都没有。
 */

describe('SkinPixelEditor · 2D 画布首帧', () => {
  let stub: CanvasStub;

  beforeEach(() => {
    stub = installCanvasStub();
  });

  afterEach(() => {
    stub.restore();
  });

  it('带初始纹理时，canvas 挂载后必须画出棋盘格、合成图层和网格', async () => {
    render(
      <SkinPixelEditor
        initialUrl="data:image/png;base64,AAAA"
        onChange={() => {}}
        onSave={() => {}}
      />,
    );

    // ready 之后 canvas 才会挂载
    const view = (await screen.findByLabelText('皮肤像素画布')) as HTMLCanvasElement;
    expect(view.width).toBe(512);
    expect(view.height).toBe(512);

    const entry = stub.recorded.find((r) => r.canvas === view);
    expect(entry, '画布已挂载，但从未取过 2D 上下文').toBeDefined();

    await waitFor(() => {
      // 棋盘格底：没有它，整个画布就是全透明
      expect(entry!.ctx.__calls.fillRect?.length ?? 0).toBeGreaterThan(0);
    });
    // 图层合成
    expect(entry!.ctx.__calls.drawImage?.length ?? 0).toBeGreaterThan(0);
    // 网格线
    expect(entry!.ctx.__calls.stroke?.length ?? 0).toBeGreaterThan(0);
  });

  it('图层操作不会重新载入初始纹理（否则会抹掉 base 层已画的像素）', async () => {
    const ref = createRef<SkinPixelEditorHandle>();
    render(
      <SkinPixelEditor
        ref={ref}
        initialUrl="data:image/png;base64,AAAA"
        onChange={() => {}}
        onSave={() => {}}
      />,
    );
    await screen.findByLabelText('皮肤像素画布');
    await waitFor(() => expect(stub.imageConstructions()).toBe(1));

    const totalClearRect = () =>
      stub.recorded.reduce((n, r) => n + (r.ctx.__calls.clearRect?.length ?? 0), 0);
    // 初始载入时 base 层被清空一次
    await waitFor(() => expect(totalClearRect()).toBe(1));

    act(() => {
      ref.current!.layerOps.addLayer('测试图层');
    });
    // 给（错误的）重新载入留出异步 onload 的时间
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 旧实现把 layers 放进初始化 effect 依赖：加图层 → 换数组 → 重新载入初始纹理 → 覆盖 base
    expect(stub.imageConstructions(), '加图层后又 new Image 重载初始纹理').toBe(1);
    expect(totalClearRect(), '加图层后 base 层被清空重画').toBe(1);
  });
});
