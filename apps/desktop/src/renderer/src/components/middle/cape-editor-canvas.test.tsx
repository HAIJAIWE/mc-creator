import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CapeEditor } from './CapeEditor';
import { installCanvasStub, type CanvasStub } from '../../../../test/canvas-stub';

/**
 * 披风编辑器和 SkinPixelEditor 是同一套画布生命周期。
 *
 * 背景（真机实测）：ready=false 时 <canvas> 不渲染，首帧 effect 在挂载时拿不到
 * viewRef；图片载入 setReady(true) 让 canvas 挂载后，effect 依赖没变、不会重跑，
 * 结果是 512×256 画布 131072 个像素全透明，连棋盘格底都没有。
 */

describe('CapeEditor · 2D 画布', () => {
  let stub: CanvasStub;

  beforeEach(() => {
    stub = installCanvasStub({ naturalWidth: 64, naturalHeight: 32 });
  });

  afterEach(() => {
    stub.restore();
  });

  it('canvas 挂载后必须画出棋盘格、纹理和网格', async () => {
    render(
      <CapeEditor initialUrl="data:image/png;base64,AAAA" onChange={() => {}} onSave={() => {}} />,
    );

    const view = (await screen.findByLabelText('披风像素画布 64x32')) as HTMLCanvasElement;
    expect(view.width).toBe(512);
    expect(view.height).toBe(256);

    const entry = stub.recorded.find((r) => r.canvas === view);
    expect(entry, '画布已挂载，但从未取过 2D 上下文').toBeDefined();

    await waitFor(() => {
      expect(entry!.ctx.__calls.fillRect?.length ?? 0).toBeGreaterThan(0);
    });
    // 纹理合成
    expect(entry!.ctx.__calls.drawImage?.length ?? 0).toBeGreaterThan(0);
    // 网格线
    expect(entry!.ctx.__calls.stroke?.length ?? 0).toBeGreaterThan(0);
  });

  it('切换缩放后必须按新位图尺寸重绘（否则位图被清空成全透明）', async () => {
    const user = userEvent.setup();
    render(
      <CapeEditor initialUrl="data:image/png;base64,AAAA" onChange={() => {}} onSave={() => {}} />,
    );

    const view = (await screen.findByLabelText('披风像素画布 64x32')) as HTMLCanvasElement;
    const entry = stub.recorded.find((r) => r.canvas === view)!;
    await waitFor(() => expect(entry.ctx.__calls.fillRect?.length ?? 0).toBeGreaterThan(0));
    const before = entry.ctx.__calls.fillRect.length;

    await user.click(screen.getByRole('button', { name: '12x' }));

    // 改 width/height 会清空 canvas 位图，必须重新画一遍
    await waitFor(() => expect(view.width).toBe(768));
    // 旧实现 redraw 不依赖 sizeW：缩放后不会重跑，画布保持空白
    await waitFor(() => expect(entry.ctx.__calls.fillRect?.length ?? 0).toBeGreaterThan(before));
  });
});
