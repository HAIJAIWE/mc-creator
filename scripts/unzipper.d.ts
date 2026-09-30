/** unzipper 无官方类型声明时的最小环境声明（仅覆盖本仓库用法：Extract）。 */
declare module 'unzipper' {
  import type { Transform } from 'node:stream';
  export function Extract(opts: { path: string }): Transform;
}
