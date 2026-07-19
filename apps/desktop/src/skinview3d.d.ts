/**
 * skinview3d 类型声明（占位 + 扩展）。
 *
 * 实际安装：`pnpm install`（沙箱外执行）
 * 包地址：https://www.npmjs.com/package/skinview3d
 *
 * 此声明让 typecheck 通过；运行时需要 skinview3d 真正存在于 node_modules 才能渲染 3D 预览。
 * 类型定义参照 skinview3d@3.4.2 的 libs/viewer.d.ts 与 libs/animation.d.ts，
 * 仅暴露当前用到的 API 子集；如需扩展，请同步更新此处。
 */
declare module 'skinview3d' {
  /** 皮肤模型类型（Steve / Alex） */
  export type ModelType = 'classic' | 'slim';

  /** SkinViewer 构造选项（仅暴露当前用到的字段） */
  export interface SkinViewerOptions {
    /** 渲染目标 canvas（不传则自动创建） */
    canvas?: HTMLCanvasElement;
    /** canvas CSS 宽度 */
    width?: number;
    /** canvas CSS 高度 */
    height?: number;
    /** 皮肤纹理来源（URL / dataURL / ImageData） */
    skin?: string | HTMLImageElement | HTMLCanvasElement;
    /** 玩家模型（classic=Steve 4px 臂 / slim=Alex 3px 臂） */
    model?: ModelType | 'auto-detect';
    /** 是否暂停渲染与动画循环 */
    renderPaused?: boolean;
    /** 场景背景色或纹理 */
    background?: string | import('three').Color | import('three').Texture;
    /** 垂直视野角（度） */
    fov?: number;
    /** 缩放比例 */
    zoom?: number;
    /** 是否启用鼠标控制 */
    enableControls?: boolean;
    /** 初始动画 */
    animation?: PlayerAnimation;
  }

  /** loadSkin 选项 */
  export interface SkinLoadOptions {
    model?: ModelType | 'auto-detect';
    makeVisible?: boolean;
    ears?: boolean | 'load-only';
  }

  /**
   * 动画基类（对应真实类型中的 PlayerAnimation 抽象类）。
   * 所有具体动画（Idle/Walking/Running/Flying 等）继承自此类。
   */
  export abstract class PlayerAnimation {
    /** 动画速度倍率，默认 1.0 */
    speed: number;
    /** 是否暂停 */
    paused: boolean;
    /** 当前进度 */
    progress: number;
  }

  /** 站立动画（呼吸/微动） */
  export class IdleAnimation extends PlayerAnimation {}

  /** 行走动画（含摆臂与头部晃动） */
  export class WalkingAnimation extends PlayerAnimation {
    /** 是否在行走时晃头，默认 true */
    headBobbing: boolean;
  }

  /** 跑步动画 */
  export class RunningAnimation extends PlayerAnimation {}

  /** 飞行动画（鞘翅姿态） */
  export class FlyingAnimation extends PlayerAnimation {}

  /**
   * SkinViewer：在 canvas 上渲染 3D 玩家模型。
   * 对应真实类型 skinview3d.SkinViewer。
   */
  export class SkinViewer {
    constructor(options?: SkinViewerOptions);

    /** 渲染目标 canvas */
    readonly canvas: HTMLCanvasElement;

    /** 是否沿 y 轴自动旋转，默认 false */
    autoRotate: boolean;
    /** 自动旋转角速度（rad/s），默认 1.0 */
    autoRotateSpeed: number;

    /** 当前播放的动画，设为 null 停止动画 */
    animation: PlayerAnimation | null;

    /** canvas CSS 宽度 */
    width: number;
    /** canvas CSS 高度 */
    height: number;

    /** 是否暂停渲染与动画 */
    renderPaused: boolean;

    /** 已渲染标记（兼容旧字段） */
    rendered: boolean;

    /** 加载皮肤纹理 */
    loadSkin(source: string, options?: SkinLoadOptions): void;
    loadSkin(source: null): void;

    /** 加载披风纹理 */
    loadCape(source: string): void;
    loadCape(source: null): void;
    /** 清除披风 */
    resetCape(): void;

    /** 设置 canvas 尺寸 */
    setSize(width: number, height: number): void;

    /** 立即渲染当前帧到 canvas（不推进动画进度），用于截图导出 */
    render(): void;

    /** 释放资源 */
    dispose(): void;
  }
}
