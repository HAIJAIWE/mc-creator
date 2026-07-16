import type { SpecTemplate } from './types.js';

/**
 * Launcher 生成器模板。
 *
 * 覆盖常见启动器配置场景：官方离线、PCL2 微软账户、HMCL 服务器自动加入。
 */
export const LAUNCHER_TEMPLATES: SpecTemplate[] = [
  {
    id: 'launcher-official-classic',
    title: '官方离线',
    icon: '🟢',
    description:
      '生成一个官方启动器配置，launcherName「MC Launcher」，' +
      'launcherType 为 official，profileName 用 default，' +
      'mcVersion 用 1.21.1，loader 为 vanilla，' +
      'accountType 为 offline，username 用 Player，' +
      'memoryMin 1024，memoryMax 2048，分辨率 854x480，关闭全屏。',
  },
  {
    id: 'launcher-pcl2-microsoft',
    title: 'PCL2 微软',
    icon: '💎',
    description:
      '生成一个 PCL2 启动器配置，launcherName「PCL2 Pro」，' +
      'launcherType 为 pcl2，profileName 用 survival，' +
      'mcVersion 用 1.21.1，loader 为 fabric，' +
      'accountType 为 microsoft，username 用 Steve，' +
      'jvmArgs 用 -Xmx4G -Xms2G，memoryMin 2048，memoryMax 4096，' +
      '分辨率 1280x720，开启全屏。',
  },
  {
    id: 'launcher-hmcl-server',
    title: 'HMCL 联机',
    icon: '🎮',
    description:
      '生成一个 HMCL 启动器配置，launcherName「HMCL Server」，' +
      'launcherType 为 hmcl，profileName 用 multiplayer，' +
      'mcVersion 用 1.20.1，loader 为 neoforge，' +
      'accountType 为 offline，username 用 Minecrafter，' +
      'serverAutorun 设为 play.example.com:25565，' +
      'memoryMin 2048，memoryMax 4096，分辨率 1920x1080，关闭全屏。',
  },
];
