/** 实体辅助映射（Yarn 映射的实体类/包/工厂/SpawnGroup）。 */

/**
 * P40：按 Java 类型返回默认值表达式（过程调用参数缺省时回退）。
 */

export function fabricEntityBaseClass(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'ZombieEntity';
    case 'skeleton':
      return 'SkeletonEntity';
    case 'creeper':
      return 'CreeperEntity';
    case 'pig':
      return 'PigEntity';
    case 'cow':
      return 'CowEntity';
    case 'custom':
    default:
      return 'Entity';
  }
}

/** modelType 对应实体类的 Yarn 包（passive/mob；Entity 在 entity 根包） */

export function fabricEntityPackage(cls: string): string {
  switch (cls) {
    case 'PigEntity':
    case 'CowEntity':
      return 'net.minecraft.entity.passive';
    case 'ZombieEntity':
    case 'SkeletonEntity':
    case 'CreeperEntity':
      return 'net.minecraft.entity.mob';
    default:
      return 'net.minecraft.entity';
  }
}

/** 根据 modelType 返回实体工厂引用（Yarn 映射，类名带 Entity 后缀） */

export function fabricEntityFactoryYarn(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'ZombieEntity::new';
    case 'skeleton':
      return 'SkeletonEntity::new';
    case 'creeper':
      return 'CreeperEntity::new';
    case 'pig':
      return 'PigEntity::new';
    case 'cow':
      return 'CowEntity::new';
    case 'custom':
    default:
      return 'Entity::new';
  }
}

/** classification → Yarn SpawnGroup 映射 */

export function fabricYarnSpawnGroup(classification: string): string {
  switch (classification) {
    case 'animal':
      return 'SpawnGroup.CREATURE';
    case 'monster':
      return 'SpawnGroup.MONSTER';
    case 'water_creature':
      return 'SpawnGroup.WATER_CREATURE';
    case 'ambient':
      return 'SpawnGroup.AMBIENT';
    case 'misc':
    default:
      return 'SpawnGroup.MISC';
  }
}
