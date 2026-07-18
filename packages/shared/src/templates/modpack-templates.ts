import type { SpecTemplate } from './types.js';

/**
 * Modpack 生成器模板。
 *
 * 覆盖常见整合包场景：性能优化、RPG 冒险、空岛生存、科技。
 */
export const MODPACK_TEMPLATES: SpecTemplate[] = [
  {
    id: 'modpack-performance',
    title: '性能优化',
    icon: '🚀',
    description:
      '做一个 Fabric 性能优化整合包，目标 MC 版本 1.21.11，包含 Sodium（渲染优化）、' +
      'Iris Shaders（光影支持）、Lithium（游戏逻辑优化）、FerriteCore（内存优化）、' +
      'EntityCulling（实体剔除）、Dynamic FPS（后台降帧）、ModernFix（综合修复）、' +
      'ImmediatelyFast（即时渲染）。packId 用 perf_pack，' +
      'packName 显示为「性能优化整合包」，作者 PerformanceLover，' +
      '所有 mod 来源 modrinth，loader fabric。',
  },
  {
    id: 'modpack-rpg-adventure',
    title: 'RPG 冒险',
    icon: '⚔️',
    description:
      '做一个 RPG 冒险整合包，MC 版本 1.21.1，loader fabric，包含：' +
      "Oh The Biomes You'll Go（新增 80+ 生物群系）、Bosses of Mass Destruction（4 个 Boss）、" +
      'Better Combat（战斗系统改进）、Spell Engine（法术系统）、' +
      'RPGStats（角色等级系统）、LevelZ（技能树）、' +
      "Roughly Enough Items（合成查询）、Xaero's Minimap（小地图）。packId 用 rpg_adventure，" +
      'packName「RPG 冒险整合包」，作者 RPGFan，加载动画消息「准备好踏上冒险旅程了吗？」。',
  },
  {
    id: 'modpack-skyblock',
    title: '空岛生存',
    icon: '☁️',
    description:
      '做一个空岛生存整合包，MC 版本 1.21.1，loader fabric，包含：' +
      'Skyblock Builder（空岛生成）、Ex Nihilo: Sequentia（筛子合成系统）、' +
      'Tiny Coal（小煤炭扩展）、Resource Hogs（筛子扩展）、' +
      'Iron Chests（箱子升级）、Culinary Construct（食物构造）、' +
      'Storage Drawers（抽屉存储）、AI Improvements（AI 优化）。' +
      'packId 用 skyblock_pack，packName「空岛生存整合包」，作者 SkyBlocker，' +
      '描述「从一颗树苗开始建立你的空中王国」。',
  },
  {
    id: 'modpack-tech',
    title: '科技',
    icon: '🏭',
    description:
      '做一个科技整合包，MC 版本 1.21.1，loader fabric，包含：' +
      'Modern Industrialization（现代工业化）、Tech Reborn（科技复兴）、' +
      'Applied Energistics 2（应用能源）、Create（机械动力）、' +
      'Reborn Storage（仓储系统）、Pipe Loader（管道传输）、' +
      'Indium（渲染兼容）、Recipe Book（配方书）。packId 用 tech_pack，' +
      'packName「科技工业整合包」，作者 TechMaster，' +
      '描述「从手摇机器到自动化工厂」。',
  },
];
