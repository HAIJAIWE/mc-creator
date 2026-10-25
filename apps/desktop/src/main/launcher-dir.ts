/**
 * 启动器数据目录：`<userData>/mc-launcher`。
 *
 * ## 为什么单列一个文件
 *
 * 这个拼法以前只写在 `ipc/launcher.ts` 里，但它下面放着**同一份数据的多个
 * 消费者**：`instances.json`、`versions/`、`download-source.json`……
 * 设置界面要写下载源偏好，就必须拿到**同一个**目录，否则会出现
 * 「设置存到 A、下载读 B」—— 症状是「切了没反应」，而且完全静默。
 *
 * ⚠️ 别用 `path-manager.ts` 的 `MC_LAUNCHER_DIR()`：那是
 * `<userData>/mc-creator/mc-launcher`（多一层 `mc-creator`），是另一套历史约定。
 * 本仓启动器数据实际落在 `<userData>/mc-launcher`。
 */
import { app } from 'electron';
import { join } from 'node:path';

/** 启动器数据目录（实例注册表、版本、下载源偏好都在这里）。 */
export function launcherDataDir(): string {
  return join(app.getPath('userData'), 'mc-launcher');
}
