import type { FileNode, GeneratorContext, GenerationResult, Loader, McVersion } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import { LauncherSpec } from '@mc-creator/shared';
import type { LauncherSpec as LauncherSpecType } from '@mc-creator/shared';

/**
 * 启动器配置生成器（P0 Critical 修复）。
 * 生成 launcher.json、profiles.json、启动脚本（bat/sh/ps1）、versions.json、
 * README.txt、config/theme.json 等启动器运行所需文件。
 * 启动器不限定 mod loader，故支持全部 5 种 loader。
 */
export class LauncherGenerator implements Generator {
  readonly type = 'launcher';
  // 启动器不限定 mod loader，故支持全部 5 种 loader（含 vanilla）。
  readonly loaders: Loader[] = ['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'vanilla'];
  readonly versions: McVersion[] = ['1.21.1', '1.21.11'];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    // 运行时校验：确保 ctx.spec 是合法 LauncherSpec
    const spec = LauncherSpec.parse(ctx.spec as unknown as LauncherSpecType);

    const files: FileNode[] = [];
    files.push(this.generateLauncherJson(spec));
    files.push(this.generateProfilesJson(spec));
    files.push(this.generateStartBat(spec));
    files.push(this.generateStartSh(spec));
    files.push(this.generateLaunchPs1(spec));
    files.push(this.generateVersionsJson(spec));
    files.push(this.generateReadme(spec));
    files.push(this.generateThemeJson(spec));

    return {
      files,
      warnings: [],
      buildCmd: `java -jar minecraft-${spec.mcVersion}-${spec.loader}.jar`,
    };
  }

  /** launcher.json：启动器主配置 */
  private generateLauncherJson(spec: LauncherSpecType): FileNode {
    return {
      path: 'launcher.json',
      content: JSON.stringify({
        name: spec.launcherName,
        type: spec.launcherType,
        mcVersion: spec.mcVersion,
        loader: spec.loader,
        java: {
          path: spec.javaPath,
          args: spec.jvmArgs,
          memoryMin: spec.memoryMin,
          memoryMax: spec.memoryMax,
        },
        display: {
          fullscreen: spec.fullscreen,
          width: spec.resolutionWidth,
          height: spec.resolutionHeight,
        },
        serverAutorun: spec.serverAutorun,
      }, null, 2),
    };
  }

  /** profiles.json：账号档案（数组，含 1 个默认 profile） */
  private generateProfilesJson(spec: LauncherSpecType): FileNode {
    const profiles = [
      {
        name: spec.profileName,
        accountType: spec.accountType,
        username: spec.username,
        uuid: spec.uuid,
        mcVersion: spec.mcVersion,
        loader: spec.loader,
      },
    ];
    return {
      path: 'profiles.json',
      content: JSON.stringify(profiles, null, 2),
    };
  }

  /** start.bat：Windows 启动脚本 */
  private generateStartBat(spec: LauncherSpecType): FileNode {
    const java = spec.javaPath || 'java';
    return {
      path: 'start.bat',
      content: `@echo off\n${java} -Xmx${spec.memoryMax}M -Xms${spec.memoryMin}M ${spec.jvmArgs} -jar minecraft-${spec.mcVersion}-${spec.loader}.jar\npause\n`,
    };
  }

  /** start.sh：Unix 启动脚本 */
  private generateStartSh(spec: LauncherSpecType): FileNode {
    const java = spec.javaPath || 'java';
    return {
      path: 'start.sh',
      content: `#!/bin/sh\n${java} -Xmx${spec.memoryMax}M -Xms${spec.memoryMin}M ${spec.jvmArgs} -jar minecraft-${spec.mcVersion}-${spec.loader}.jar\n`,
    };
  }

  /** launch.ps1：PowerShell 启动脚本 */
  private generateLaunchPs1(spec: LauncherSpecType): FileNode {
    const java = spec.javaPath || 'java';
    return {
      path: 'launch.ps1',
      content: `# ${spec.launcherName} 启动脚本\n& "${java}" -Xmx${spec.memoryMax}M -Xms${spec.memoryMin}M ${spec.jvmArgs} -jar "minecraft-${spec.mcVersion}-${spec.loader}.jar"\n`,
    };
  }

  /** versions.json：版本清单 */
  private generateVersionsJson(spec: LauncherSpecType): FileNode {
    return {
      path: 'versions.json',
      content: JSON.stringify({
        mcVersion: spec.mcVersion,
        loader: spec.loader,
        compatibleLoaders: ['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'vanilla'],
      }, null, 2),
    };
  }

  /** README.txt：说明文档 */
  private generateReadme(spec: LauncherSpecType): FileNode {
    const javaDisplay = spec.javaPath || '系统默认';
    const serverNote = spec.serverAutorun
      ? `\n注意: serverAutorun 字段非空时，启动后自动连接服务器: ${spec.serverAutorun}`
      : '\n注意: serverAutorun 字段为空，启动后不会自动连接服务器。';
    return {
      path: 'README.txt',
      content: `${spec.launcherName} 启动器配置说明\n========================\n启动器类型: ${spec.launcherType}\nMC 版本: ${spec.mcVersion}\n加载器: ${spec.loader}\nJava 路径: ${javaDisplay}\nJVM 内存: ${spec.memoryMin}MB - ${spec.memoryMax}MB\n账号类型: ${spec.accountType}\n用户名: ${spec.username}\n\n使用方法:\n1. 将本目录下所有文件放到启动器工作目录\n2. Windows 双击 start.bat 或运行 launch.ps1\n3. Unix 运行 sh start.sh\n${serverNote}\n`,
    };
  }

  /** config/theme.json：启动器主题配置 */
  private generateThemeJson(spec: LauncherSpecType): FileNode {
    return {
      path: 'config/theme.json',
      content: JSON.stringify({
        launcherName: spec.launcherName,
        launcherType: spec.launcherType,
        theme: 'default',
        accentColor: '#4A90E2',
      }, null, 2),
    };
  }
}
