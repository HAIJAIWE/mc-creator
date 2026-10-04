/** 实体辅助映射（Mojang 映射的实体类/包/工厂/MobCategory）。 */

/**
 * 根据 modelType 返回实体类名（Mojang 映射：类名无 Entity 后缀）。
 * custom 无具体类，用 Pig 占位（Entity 为抽象类，方法引用无法编译）。
 */
export function neoforgeEntityBaseClass(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'Zombie';
    case 'skeleton':
      return 'Skeleton';
    case 'creeper':
      return 'Creeper';
    case 'pig':
      return 'Pig';
    case 'cow':
      return 'Cow';
    case 'custom':
    default:
      return 'Pig';
  }
}

/** 根据 modelType 返回实体工厂引用（Mojang 构造器均为 (EntityType, Level)） */
export function neoforgeEntityFactory(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'Zombie::new';
    case 'skeleton':
      return 'Skeleton::new';
    case 'creeper':
      return 'Creeper::new';
    case 'pig':
      return 'Pig::new';
    case 'cow':
      return 'Cow::new';
    case 'custom':
    default:
      return 'Pig::new';
  }
}

/** modelType 对应实体类的 Mojang 包（monster/animal） */
export function neoforgeEntityPackage(cls: string): string {
  switch (cls) {
    case 'Zombie':
    case 'Skeleton':
    case 'Creeper':
      return 'net.minecraft.world.entity.monster';
    case 'Pig':
    case 'Cow':
      return 'net.minecraft.world.entity.animal';
    default:
      return 'net.minecraft.world.entity';
  }
}

/** classification → Mojang MobCategory 映射 */
export function neoforgeMobCategory(classification: string): string {
  switch (classification) {
    case 'animal':
      return 'MobCategory.CREATURE';
    case 'monster':
      return 'MobCategory.MONSTER';
    case 'water_creature':
      return 'MobCategory.WATER_CREATURE';
    case 'ambient':
      return 'MobCategory.AMBIENT';
    case 'misc':
    default:
      return 'MobCategory.MISC';
  }
}
