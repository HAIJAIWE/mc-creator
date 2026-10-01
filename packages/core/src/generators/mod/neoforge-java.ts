/**
 * NeoForge Adapter 的 Java 类生成域（Forge 1.20.1 / NeoForge 20.1 目标）。
 *
 * 目标映射：Mojang 官方映射（非 Yarn）。包与 API 全部按 1.20.1 Mojang 名编写，
 * 关键签名逐条经 javap 对 Mojang 官方映射服务端 jar + Forge 47 universal 核对：
 * - 注册：DeferredRegister.create(ForgeRegistries.*, MOD_ID) + RegistryObject
 * - 事件：MinecraftForge.EVENT_BUS.<Event>addListener(lambda)（Forge 总线，
 *   mod 总线收不到游戏事件）
 * - 菜单：IForgeMenuType.create（MenuType 构造器私有，不可 new）
 * - 流体：FluidType + ForgeFlowingFluid.Source/Flowing
 * - 生物群系/维度/结构：动态注册表，Java 侧只留 ID 常量，实体走数据包 JSON
 *  （见 worldgen-json-generator.ts，由 adapter 接 worldgen 类别）
 */
export { neoforgeMainClass, neoforgeEventClass, neoforgeEventBindings } from './neoforge/event.js';
export {
  neoforgeModItemsJava,
  neoforgeModBlocksJava,
  neoforgeModFluidsJava,
  neoforgeModBiomesJava,
  neoforgeModDimensionsJava,
  neoforgeModGuisJava,
  neoforgeModStructuresJava,
} from './neoforge/registered.js';
export {
  neoforgeModRecipesJava,
  neoforgeModEntitiesJava,
  neoforgeModMachinesJava,
  neoforgeModCustomCodeJava,
  neoforgeModMultiblocksJava,
  neoforgeModEventsJava,
} from './neoforge/gameplay.js';
export {
  neoforgeEntityBaseClass,
  neoforgeEntityFactory,
  neoforgeEntityPackage,
  neoforgeMobCategory,
} from './neoforge/entity.js';
