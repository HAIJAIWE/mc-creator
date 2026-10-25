/**
 * 内核适配层（基础设施收口）。
 *
 * ## 为什么单独一层
 *
 * 此前 `transport/mcp-server.ts` 直接 `new JavaKernel(...)` / `new ServerKernel(...)` /
 * `new BedrockKernel(...)`，带来两个问题：
 *
 * 1. **不可测**：内核构造硬编码在工厂函数里，测试只能绕开内核走纯函数路径
 *    （`listTools` / `callTool` 路由 / `parseLine`）。内核真正执行的那条路没有测试缝。
 * 2. **不可复用**：`@mc-creator/agent` 被依赖 `@mc-creator/kernel-*` 拖住，
 *    在没有内核的环境（CI、纯 Node 脚本）里加载这个包就会连带加载三个内核。
 *
 * ## 做法
 *
 * 依赖倒置 —— 依赖**接口**（`@mc-creator/contract` 的 `KernelContract`）而非具体类：
 *
 * ```
 * transport ──► kernel/adapters ──► contract（接口）
 *                        │
 *                        └──► kernel-*（默认实现，惰性 require）
 * ```
 *
 * 调用方可经 `createMcpServer({ kernels })` 注入自己的实现（测试用假实现，
 * 生产用真实内核）。不注入时回落到默认实现，**向后兼容**。
 */

import { JavaKernel } from '@mc-creator/kernel-java';
import { BedrockKernel } from '@mc-creator/kernel-bedrock';
import { ServerKernel } from '@mc-creator/kernel-server';
import type { KernelContract } from '@mc-creator/contract';

/**
 * 三内核的可注入集合。
 *
 * 全部可选：缺哪一版就现造默认实现。这样测试可以只注入关心的那一版，
 * 其余仍走真实内核（多数用例只关心 java）。
 */
export interface KernelBundle {
  java?: KernelContract;
  server?: KernelContract;
  bedrock?: KernelContract;
}

/** 三内核各自的构造参数（与各 kernel 包自身的 options 对应）。 */
export interface KernelOptions {
  java?: ConstructorParameters<typeof JavaKernel>[0];
  server?: ConstructorParameters<typeof ServerKernel>[0];
  bedrock?: ConstructorParameters<typeof BedrockKernel>[0];
}

/**
 * 构造三内核，未注入的用默认实现补齐。
 *
 * 这是**唯一**允许 `new JavaKernel` 之类具体类的地方 —— 上层拿到的
 * 一律是 `KernelContract`。
 */
export function createKernelBundle(
  opts: KernelOptions = {},
  injected: KernelBundle = {},
): Required<KernelBundle> {
  return {
    java: injected.java ?? new JavaKernel(opts.java ?? {}),
    server: injected.server ?? new ServerKernel(opts.server ?? {}),
    bedrock: injected.bedrock ?? new BedrockKernel(opts.bedrock ?? {}),
  };
}
