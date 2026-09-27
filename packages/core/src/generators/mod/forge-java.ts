/**
 * Forge Adapter 的 Java 类生成域（Forge 1.20.1 / build 47.x）。
 *
 * 关键事实：NeoForge 20.1（1.20.1）是 Forge 47 的直接分支，同版本下
 * Java 侧 API 完全一致（net.minecraftforge.* + Mojang 官方映射：
 * @Mod、DeferredRegister、MinecraftForge.EVENT_BUS、IForgeMenuType…）。
 * 因此 Forge 的 Java 生成直接复用 neoforge-java.ts（re-export 别名），
 * 差异只存在于构建文件（forge-gradle.ts）与 mods.toml（forge 依赖声明）。
 * 若未来支持 Forge 1.21+（包名已迁 net.neoforged），再在此 fork。
 */
export {
  neoforgeMainClass as forgeMainClass,
  neoforgeModItemsJava as forgeModItemsJava,
  neoforgeModBlocksJava as forgeModBlocksJava,
  neoforgeModFluidsJava as forgeModFluidsJava,
  neoforgeModBiomesJava as forgeModBiomesJava,
  neoforgeModDimensionsJava as forgeModDimensionsJava,
  neoforgeModGuisJava as forgeModGuisJava,
  neoforgeModStructuresJava as forgeModStructuresJava,
  neoforgeModRecipesJava as forgeModRecipesJava,
  neoforgeModEntitiesJava as forgeModEntitiesJava,
  neoforgeModMachinesJava as forgeModMachinesJava,
  neoforgeModCustomCodeJava as forgeModCustomCodeJava,
  neoforgeModMultiblocksJava as forgeModMultiblocksJava,
  neoforgeModEventsJava as forgeModEventsJava,
  neoforgeEventClass as forgeEventClass,
  neoforgeEventBindings as forgeEventBindings,
  neoforgeEntityBaseClass as forgeEntityBaseClass,
  neoforgeEntityFactory as forgeEntityFactory,
  neoforgeEntityPackage as forgeEntityPackage,
  neoforgeMobCategory as forgeMobCategory,
} from './neoforge-java.js';
