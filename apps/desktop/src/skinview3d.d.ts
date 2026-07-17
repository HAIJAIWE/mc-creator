/**
 * skinview3d 类型声明（占位）。
 *
 * 实际安装：`pnpm install`（沙箱外执行）
 * 包地址：https://www.npmjs.com/package/skinview3d
 *
 * 此声明让 typecheck 通过；运行时需要 skinview3d 真正存在于 node_modules 才能渲染 3D 预览。
 */
declare module 'skinview3d' {
  export interface SkinViewerOptions {
    canvas: HTMLCanvasElement;
    width?: number;
    height?: number;
    skin?: string;
    model?: 'classic' | 'slim';
  }

  /** 动画基类 */
  export abstract class SkinViewerAnimation {
    speed: number;
    paused: boolean;
    progress: number;
  }

  export class SkinViewer {
    constructor(options: SkinViewerOptions);
    autoRotate: boolean;
    autoRotateSpeed: number;
    animation: SkinViewerAnimation | null;
    loadSkin(url: string, options?: { model?: 'classic' | 'slim' }): void;
    loadCape(url: string): void;
    resetCape(): void;
    width: number;
    height: number;
    setSize(width: number, height: number): void;
    dispose(): void;
    rendered: boolean;
  }

  export class WalkingAnimation extends SkinViewerAnimation {}
  export class IdleAnimation extends SkinViewerAnimation {}
  export class RunningAnimation extends SkinViewerAnimation {}
  export class FlyingAnimation extends SkinViewerAnimation {}

  export type ModelType = 'classic' | 'slim';
}
