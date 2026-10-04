declare module 'gifenc' {
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray | number[],
    maxColors: number,
    options?: unknown,
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray | number[],
    palette: number[][],
  ): Uint8Array;
  export interface GifFrameOpts {
    palette?: number[][] | null;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
  }
  export interface GifEncoderInstance {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: GifFrameOpts,
    ): void;
  }
  export default function GIFEncoder(opt?: { initialCapacity?: number; auto?: boolean }): GifEncoderInstance;
}
