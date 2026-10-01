/** Fabric Adapter 的 Java 类生成域。原样提取自 fabric-adapter.ts(脚本转换 this.x→x、修饰符→export function),行为不变。 */
export { fabricMainClass, fabricEventRegistration } from './fabric/event.js';
export {
  fabricModItemsJava,
  fabricModBlocksJava,
  fabricModFluidsJava,
  fabricModBiomesJava,
  fabricModDimensionsJava,
  fabricModGuisJava,
  fabricModStructuresJava,
} from './fabric/registered.js';
export {
  fabricModRecipesJava,
  fabricModEntitiesJava,
  fabricModMachinesJava,
  fabricModCustomCodeJava,
  fabricModMultiblocksJava,
  fabricModEventsJava,
} from './fabric/gameplay.js';
export {
  fabricBlockPlaceMixinFiles,
  fabricItemPickupMixinFiles,
  fabricMixinsJson,
} from './fabric/mixin.js';
export {
  fabricEntityBaseClass,
  fabricEntityPackage,
  fabricEntityFactoryYarn,
  fabricYarnSpawnGroup,
} from './fabric/entity.js';
