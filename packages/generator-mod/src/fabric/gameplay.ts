/** 玩法类 Java 生成（配方/实体/机器/自定义代码/多方块/事件）。 */
import type { FileNode } from '@mc-creator/shared';
import { mainClassName, packagePath } from '../templates.js';
import { conditionCheckBody, actionExecuteBody } from '../event-logic.js';
import { formatUnsupportedComment } from '../unsupported.js';
import {
  defaultValueFor,
  javaTypeFor,
  machineRecipeCases,
  portTypeToJava,
  sanitizeIdent,
  toPascal,
  type ModSpecLike,
} from '../mod-common.js';
import {
  fabricEntityBaseClass,
  fabricEntityFactoryYarn,
  fabricEntityPackage,
  fabricYarnSpawnGroup,
} from './entity.js';
import { fabricEventRegistration } from './event.js';

/**
 * 生成 ModRecipes.java：仅生成 recipeId 常量定义。
 * Critical 修复：配方通过 datapack JSON 加载（data/<modid>/recipes/<id>.json），
 * 不应在 Java 中 Registry.register 一个 String 文本块为 Recipe<?> 类型（类型不匹配，无法编译）。
 * Java 文件仅保留 ID 常量供其他代码引用。
 */

export function fabricModRecipesJava(spec: ModSpecLike, pkg: string): FileNode {
  const recipes = spec.recipes ?? [];
  const fields = recipes
    .map((r) => `    public static final String ${r.recipeId.toUpperCase()}_ID = "${r.recipeId}";`)
    .join('\n');
  const comments = recipes
    .map(
      (r) =>
        `        // ${r.recipeId} (${r.recipeType}) → ${r.output} x${r.outputCount}: 通过 datapack JSON 加载`,
    )
    .join('\n');

  const content = `package ${pkg};

public class ModRecipes {
${fields}

    public static void initialize() {
${comments}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModRecipes.java`,
    content,
  };
}

/**
 * 生成 ModEntities.java：用 Registry.register(Registries.ENTITY_TYPE, ...) 注册实体。
 * 使用 Yarn 映射（EntityType.Builder.create().setDimensions(w, h).build()），
 * 与 NeoForge 一致，配合 yarn mappings 构建。
 */

export function fabricModEntitiesJava(spec: ModSpecLike, pkg: string): FileNode {
  const entities = spec.entities ?? [];
  const mainCls = mainClassName(spec.modId);
  const fields = entities
    .map(
      (e) =>
        `    public static EntityType<${fabricEntityBaseClass(e.modelType)}> ${e.entityId.toUpperCase()};`,
    )
    .join('\n');
  const regs = entities
    .map((e) => {
      // 简化：根据 modelType 选择 SpawnGroup，根据 classification 映射
      const category = fabricYarnSpawnGroup(e.classification);
      const width = 0.6;
      const height = 1.8;
      return `        // Entity: ${e.entityId} (${e.modelType}, ${e.classification}) — ${e.displayName}
        // maxHealth=${e.maxHealth}, attackDamage=${e.attackDamage}, movementSpeed=${e.movementSpeed}
        // spawnWeight=${e.spawnWeight}, spawnBiomes=${JSON.stringify(e.spawnBiomes)}
        ${e.entityId.toUpperCase()} = Registry.register(Registries.ENTITY_TYPE, Identifier.of(${mainCls}.MOD_ID, "${e.entityId}"), EntityType.Builder.<${fabricEntityBaseClass(e.modelType)}>create(${fabricEntityFactoryYarn(e.modelType)}, ${category}).setDimensions(${width}f, ${height}f).build("${e.entityId}"));`;
    })
    .join('\n');
  // G-1 修复：实体字段/工厂引用具体实体类（ZombieEntity/SkeletonEntity/...），必须补对应 import，
  // 否则生成代码引用了未导入的类无法编译。Yarn 下具体类按 passive/mob 分包。
  const usedEntityClasses = [
    ...new Set(entities.map((e) => fabricEntityBaseClass(e.modelType))),
  ].sort();
  const entityImports = usedEntityClasses
    .map((c) => `import ${fabricEntityPackage(c)}.${c};`)
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
${entityImports}
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModEntities {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEntities.java`,
    content,
  };
}

/**
 * 生成 ModMachines.java：注册 BlockEntityType + ScreenHandlerType（可编译占位骨架）。
 *
 * G-2 修复：原实现引用不存在的 ModBlocks.${MACHINE_ID}（方块 id 与 machineId 不一定相同）
 * 和 ${Pascal}BlockEntity / ${Pascal}Menu 顶层类，生成代码无法编译。
 * 现在每个机器生成嵌套占位类（BlockEntity/Menu），注册时用 Blocks.STONE 占位方块，
 * 保证可编译，并注释提示替换为实际实现。
 */

export function fabricModMachinesJava(spec: ModSpecLike, pkg: string): FileNode {
  const machines = spec.machines ?? [];
  const mainCls = mainClassName(spec.modId);
  const fields = machines
    .map(
      (m) =>
        `    public static BlockEntityType<?> ${m.machineId.toUpperCase()}_BE;\n    public static ScreenHandlerType<?> ${m.machineId.toUpperCase()}_MENU;`,
    )
    .join('\n');
  const placeholderClasses = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      const totalSlots = m.inputSlots + m.outputSlots;
      return `    // ${pascal}BlockEntity：能源存储 + 输入/输出槽位 + 简易加工
    public static class ${pascal}BlockEntity extends BlockEntity {
        public static final int ENERGY_CAPACITY = ${m.energyCapacity};
        public static final int ENERGY_PER_TICK = ${m.defaultEnergyPerTick};
        public static final int PROCESS_TIME = ${m.defaultProcessTime};
        private int energy = 0;
        private int progress = 0;
        private final net.minecraft.inventory.SimpleInventory inventory = new net.minecraft.inventory.SimpleInventory(${totalSlots});

        public ${pascal}BlockEntity(BlockPos pos, BlockState state) {
            super(${id}_BE, pos, state);
        }

        // 能源 API：加/取/查
        public int getEnergy() { return energy; }
        public int getMaxEnergy() { return ENERGY_CAPACITY; }
        public int receiveEnergy(int amount) {
            int accepted = Math.min(amount, ENERGY_CAPACITY - energy);
            energy += accepted;
            return accepted;
        }
        public int extractEnergy(int amount) {
            int taken = Math.min(amount, energy);
            energy -= taken;
            return taken;
        }

        // 槽位访问：输入槽在前，输出槽在后
        public net.minecraft.inventory.SimpleInventory getInventory() { return inventory; }

        // tick 处理：耗能推进加工进度（输出槽有空间时）
        public void tickServer() {
            if (energy >= ENERGY_PER_TICK && progress < PROCESS_TIME) {
                energy -= ENERGY_PER_TICK;
                progress++;
            } else if (progress >= PROCESS_TIME) {
                progress = 0;
                // 配方映射：输入物品 ID → 输出物品 ID（未匹配时回退原样搬运）
                for (int i = 0; i < ${m.inputSlots}; i++) {
                    var stack = inventory.getStack(i);
                    if (!stack.isEmpty()) {
                        var outStack = inventory.getStack(${m.inputSlots});
                        if (outStack.isEmpty()) {
                            String outId = recipeOutput(stack.getItem().getTranslationKey());
                            if (outId != null) {
                                var output = new net.minecraft.item.ItemStack(net.minecraft.registry.Registries.ITEM.get(new net.minecraft.util.Identifier(outId)), 1);
                                inventory.setStack(${m.inputSlots}, output);
                                stack.decrement(1);
                            } else {
                                inventory.setStack(${m.inputSlots}, stack.copyWithCount(1));
                                stack.decrement(1);
                            }
                        }
                        break;
                    }
                }
            }
        }

        // 配方映射查找（从 spec 生成）
        private static String recipeOutput(String inputItemId) {
            String id = inputItemId.replace("item.", "").replace(".", ":");
            switch (id) {
${machineRecipeCases(m)}
                default:
                    return null;
            }
        }
    }

    // ${pascal}Menu：输入槽(0..${m.inputSlots - 1}) + 输出槽(${m.inputSlots}..${totalSlots - 1}) + 玩家背包(9×3)
    public static class ${pascal}Menu extends ScreenHandler {
        private final net.minecraft.inventory.SimpleInventory machineInv;

        public ${pascal}Menu(int id, PlayerInventory inv) {
            super(${id}_MENU, id);
            this.machineInv = new net.minecraft.inventory.SimpleInventory(${totalSlots});
            // 机器槽位
            for (int i = 0; i < ${totalSlots}; i++) {
                this.addSlot(new Slot(machineInv, i, 8 + (i % 9) * 18, 18 + (i / 9) * 18));
            }
            // 玩家背包
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(inv, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
                }
            }
            // 快捷栏
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(inv, col, 8 + col * 18, 142));
            }
        }

        @Override
        public net.minecraft.item.ItemStack quickMove(net.minecraft.entity.player.PlayerEntity player, int index) {
            return net.minecraft.item.ItemStack.EMPTY;
        }

        @Override
        public boolean canUse(net.minecraft.entity.player.PlayerEntity player) {
            return true;
        }
    }`;
    })
    .join('\n\n');
  const regs = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      return `        // Machine: ${m.machineId} — ${m.displayName}
        // energyCapacity=${m.energyCapacity}, maxTransfer=${m.maxEnergyTransfer}
        // inputSlots=${m.inputSlots}, outputSlots=${m.outputSlots}
        // processTime=${m.defaultProcessTime}, energyPerTick=${m.defaultEnergyPerTick}
        // guiWidth=${m.guiWidth}, guiHeight=${m.guiHeight}
        // BlockEntityType.Builder.create 的 Factory 接口同样由 Fabric transitive AW 放行，loom 真构建可编译。
        ${id}_BE = Registry.register(Registries.BLOCK_ENTITY_TYPE, Identifier.of(${mainCls}.MOD_ID, "${m.machineId}"), BlockEntityType.Builder.create(${pascal}BlockEntity::new, Blocks.STONE).build(null));
        ${id}_MENU = Registry.register(Registries.SCREEN_HANDLER, Identifier.of(${mainCls}.MOD_ID, "${m.machineId}"), new ScreenHandlerType<>(${pascal}Menu::new, FeatureFlags.VANILLA_FEATURES));`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.block.Blocks;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.BlockEntityType;
import net.minecraft.block.BlockState;
import net.minecraft.util.math.BlockPos;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.slot.Slot;
import net.minecraft.resource.featuretoggle.FeatureFlags;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModMachines {
${fields}
${placeholderClasses}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModMachines.java`,
    content,
  };
}

/**
 * 生成 ModCustomCode.java：把每个 CustomCodeSnippetSpec 的 code 嵌入为独立方法。
 * 方法名取自 snippet.methodName，签名取自 inputSignature/outputSignature（PortType → Java 类型）。
 */

export function fabricModCustomCodeJava(spec: ModSpecLike, pkg: string): FileNode {
  const snippets = spec.customCode ?? [];
  const methods = snippets
    .map((s) => {
      const methodName = s.methodName || 'process';
      const inputParams = Object.entries(s.inputSignature)
        .map(([k, v]) => `${portTypeToJava(v)} ${k}`)
        .join(', ');
      const outputEntries = Object.entries(s.outputSignature);
      const outputType =
        outputEntries.length === 1
          ? portTypeToJava(outputEntries[0][1])
          : outputEntries.length > 1
            ? 'Object'
            : 'void';
      // 缩进用户代码到方法体内部（8 空格）
      const userCode = s.code || '// (empty)';
      const indentedCode = userCode
        .split('\n')
        .map((line) => `        ${line}`)
        .join('\n');
      return `    // snippetId: ${s.snippetId} (language: ${s.language})
    // inputSignature:  ${JSON.stringify(s.inputSignature)}
    // outputSignature: ${JSON.stringify(s.outputSignature)}
    public static ${outputType} ${methodName}(${inputParams}) {
${indentedCode}
    }`;
    })
    .join('\n\n');

  const content = `package ${pkg};

public class ModCustomCode {
${methods}

    public static void initialize() {
        // Custom code snippets loaded (${snippets.length} snippet(s))
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModCustomCode.java`,
    content,
  };
}

/**
 * 生成 ModMultiblocks.java：把每个 MultiBlockSpec 编译为常量（结构尺寸 + 控制器偏移）。
 * 简化：仅生成元数据常量，不实际注册结构（多方块注册 API 较复杂，留待后续完善）。
 */

export function fabricModMultiblocksJava(spec: ModSpecLike, pkg: string): FileNode {
  const multiblocks = spec.multiblocks ?? [];
  const constants = multiblocks
    .map((m) => {
      const name = m.structureId.toUpperCase();
      return `    // 结构: ${m.structureId} (${m.displayName})
    // 尺寸: ${m.width}x${m.height}x${m.depth}, 空心: ${m.hollow}
    // 控制器偏移: (${m.controllerOffset.x}, ${m.controllerOffset.y}, ${m.controllerOffset.z})
    public static final String ${name}_ID = "${m.structureId}";
    public static final int ${name}_WIDTH = ${m.width};
    public static final int ${name}_HEIGHT = ${m.height};
    public static final int ${name}_DEPTH = ${m.depth};
    public static final boolean ${name}_HOLLOW = ${m.hollow};
    public static final int ${name}_CONTROLLER_X = ${m.controllerOffset.x};
    public static final int ${name}_CONTROLLER_Y = ${m.controllerOffset.y};
    public static final int ${name}_CONTROLLER_Z = ${m.controllerOffset.z};`;
    })
    .join('\n');
  const content = `package ${pkg};

public class ModMultiblocks {
${constants}

    public static void initialize() {
        // Multiblock structures registered (${multiblocks.length} structure(s))
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModMultiblocks.java`,
    content,
  };
}

/**
 * 生成 ModEvents.java：根据 conditionIds/actionIds/procedureCallIds 引用生成事件处理逻辑。
 *
 * 结构：
 *   - initialize()：按 eventType 选择 Fabric API 注册事件回调，回调内调用 handle_<handlerId>
 *   - handle_<handlerId>(Object event)：根据 conditionIds 生成 if 语句（invert 加 !），
 *     块内调用 actionIds 对应的 execute_<actionId>，以及 procedureCallIds 对应的 procedure_<name>
 *   - procedure_<procedureName>(Object event)：P1-3 过程方法（命名的可复用逻辑单元，
 *     含 conditionIds/actionIds/procedureCallIds，结构与 handle_ 同构；可被多个 event/procedure 调用）
 *   - check_<conditionId>(Object event)：条件检查方法（含 conditionType/args 注释，return true 占位）
 *   - execute_<actionId>(Object event)：动作执行方法（含 actionType/args 注释，空方法体占位）
 *
 * 简化：每个 conditionId 生成独立 if 块，块内调用所有 actionIds/procedureCallIds（control 边的
 * 精确嵌套关系在扁平结构中已丢失，需 P1.5+ 才能完整还原）。
 */

export function fabricModEventsJava(spec: ModSpecLike, pkg: string): FileNode {
  const handlers = spec.eventHandlers ?? [];
  const conditions = spec.conditions ?? [];
  const actions = spec.actions ?? [];
  const procedures = spec.procedures ?? [];

  // 构建 conditionId → ConditionSpec 映射（用于查找 invert 状态 + dangling 检测）
  const conditionMap = new Map(conditions.map((c) => [c.conditionId, c]));
  // 构建 actionId Set（用于 dangling 检测）
  const actionIdSet = new Set(actions.map((a) => a.actionId));
  // P1-3：构建 procedureId → procedureName 映射（用于解析 procedureCallIds → 方法名）
  const procedureNameMap = new Map(procedures.map((p) => [p.procedureId, p.procedureName]));

  // initialize() 中的事件注册调用（按 eventType 选择 Fabric API，用全限定名避免 import 错误）
  const registrations = handlers
    .map((h) => {
      const handlerMethod = `handle_${sanitizeIdent(h.handlerId)}`;
      return `        // handlerId: ${h.handlerId} (eventType: ${h.eventType})
${fabricEventRegistration(h.eventType, handlerMethod)}`;
    })
    .join('\n');

  // 生成方法体（conditionIds → AND 合取 if 块 + actionIds/procedureCallIds 调用）。
  // handle_ 与 procedure_ 共用此逻辑，区别仅在方法签名与注释。
  // P40：callArgs 为 procedureCallId → 表达式数组（与被调过程 inputs 顺序对应），
  // 缺省表达式由 defaultValueFor 回退为该参数类型的默认值。
  const buildBody = (
    conditionIds: string[],
    actionIds: string[],
    procCallIds: string[],
    callArgs?: Record<string, string[]>,
  ): string => {
    // 过滤 dangling 引用：conditionId/actionId 必须在对应 spec 中存在
    const validCondIds = conditionIds.filter((cid) => {
      if (!conditionMap.has(cid)) {
        return false; // dangling：跳过
      }
      return true;
    });
    const validActionIds = actionIds.filter((aid) => {
      if (!actionIdSet.has(aid)) {
        return false; // dangling：跳过
      }
      return true;
    });

    // 把过程调用 id 列表解析为 procedure_<name>(ctx, args...) 调用语句（缩进由调用方决定）
    const resolveProcCalls = (indent: string): string =>
      procCallIds.length
        ? procCallIds
            .map((pid) => {
              const name = procedureNameMap.get(pid);
              if (!name) return `${indent}// (未知过程: ${pid})`;
              const args = callArgs?.[pid] ?? [];
              const proc = procedures.find((p) => p.procedureId === pid);
              const defaults = (proc?.inputs ?? []).map((inp) => defaultValueFor(inp.type));
              const exprs = (proc?.inputs ?? []).map((inp, i) => args[i] || defaults[i]);
              const argList = exprs?.length ? `, ${exprs.join(', ')}` : '';
              return `${indent}procedure_${sanitizeIdent(name)}(ctx${argList});`;
            })
            .join('\n')
        : '';

    // 多条件使用 AND 合取：所有条件都满足时才执行动作
    // 修复：旧版为每个条件独立 if → actions 重复执行 N 次
    if (validCondIds.length > 0) {
      const combinedCheck = validCondIds
        .map((cid) => {
          const cond = conditionMap.get(cid);
          const invert = cond?.invert ?? false;
          return `${invert ? '!' : ''}check_${sanitizeIdent(cid)}(ctx)`;
        })
        .join(' && ');
      const actionCalls = validActionIds.length
        ? validActionIds.map((aid) => `            execute_${sanitizeIdent(aid)}(ctx);`).join('\n')
        : '';
      const innerProcCalls = resolveProcCalls('            ');
      const innerBody =
        [actionCalls, innerProcCalls].filter(Boolean).join('\n') ||
        '            // (无关联 action)';
      return `        if (${combinedCheck}) {
${innerBody}
        }`;
    }

    // 无条件：直接执行
    if (validActionIds.length || procCallIds.length) {
      return `        // (无关联 condition，直接执行)
${[
  ...validActionIds.map((aid) => `        execute_${sanitizeIdent(aid)}(ctx);`),
  ...resolveProcCalls('        ').split('\n').filter(Boolean),
].join('\n')}`;
    }

    return '        // (无关联 condition 与 action)';
  };

  // 每个事件处理器的 handle_<handlerId> 方法
  const handlerMethods = handlers
    .map((h) => {
      const handlerName = `handle_${sanitizeIdent(h.handlerId)}`;
      const body = buildBody(
        h.conditionIds ?? [],
        h.actionIds ?? [],
        h.procedureCallIds ?? [],
        h.procedureCallArgs,
      );
      return `    // 事件处理器: ${h.handlerId} (eventType: ${h.eventType})
    // eventArgs: ${JSON.stringify(h.eventArgs)}
    private static void ${handlerName}(EventContext ctx) {
${body}
    }`;
    })
    .join('\n\n');

  // P1-3：过程方法（命名的可复用逻辑单元，可被 event/procedure 调用）
  // P40：inputs 参数生成方法签名（procedure_<name>(ctx, type name, ...)）
  const procedureMethods = procedures
    .map((p) => {
      const methodName = `procedure_${sanitizeIdent(p.procedureName)}`;
      const body = buildBody(p.conditionIds, p.actionIds, p.procedureCallIds, p.procedureCallArgs);
      const paramList = (p.inputs ?? [])
        .map((inp) => `${javaTypeFor(inp.type)} ${inp.name}`)
        .join(', ');
      const signature = paramList ? `EventContext ctx, ${paramList}` : 'EventContext ctx';
      return `    // 过程: ${p.procedureId} (name: ${p.procedureName})
    // inputs: ${JSON.stringify(p.inputs ?? [])}
    // 可被 event/procedure 调用，复用此方法
    private static void ${methodName}(${signature}) {
${body}
    }`;
    })
    .join('\n\n');

  // P2.2 block_place：Fabric 无现成放置事件，由 Mixin @Inject 调用的公开通知入口。
  // 构造 EventContext 并逐个调用 block_place 的 handle_ 方法（无 handler 时不生成）。
  const blockPlaceHandlers = handlers.filter((h) => h.eventType === 'block_place');
  const notifyBlockPlaced = blockPlaceHandlers.length
    ? `    // block_place 事件通知入口（由 ModBlockPlaceMixin @Inject 调用，Fabric API 无放置事件）
    public static void notifyBlockPlaced(net.minecraft.world.World level, net.minecraft.util.math.BlockPos pos, net.minecraft.block.BlockState state, net.minecraft.server.network.ServerPlayerEntity player) {
        EventContext ctx = new EventContext();
        ctx.level = level instanceof net.minecraft.server.world.ServerWorld sl ? sl : null;
        ctx.pos = pos;
        ctx.state = state;
        ctx.player = player;
${blockPlaceHandlers.map((h) => `        handle_${sanitizeIdent(h.handlerId)}(ctx);`).join('\n')}
    }`
    : '';

  // item_pickup：Fabric 无拾取事件，由 ModItemPickupMixin @Inject 调用的公开通知入口。
  const itemPickupHandlers = handlers.filter((h) => h.eventType === 'item_pickup');
  const notifyItemPickedup = itemPickupHandlers.length
    ? `    // item_pickup 事件通知入口（由 ModItemPickupMixin @Inject 调用，Fabric API 无拾取事件）
    public static void notifyItemPickedup(net.minecraft.world.World level, net.minecraft.server.network.ServerPlayerEntity player, net.minecraft.item.ItemStack stack) {
        EventContext ctx = new EventContext();
        ctx.level = level instanceof net.minecraft.server.world.ServerWorld sl ? sl : null;
        ctx.player = player;
        ctx.stack = stack;
${itemPickupHandlers.map((h) => `        handle_${sanitizeIdent(h.handlerId)}(ctx);`).join('\n')}
    }`
    : '';

  // 条件检查方法（遍历 spec.conditions 全量生成，含未被 handler 引用的）
  const conditionMethods = conditions
    .map((c) => {
      const methodName = `check_${sanitizeIdent(c.conditionId)}`;
      // P1-7：常见条件类型生成真实检查逻辑（event-logic.ts），未知类型走显性占位（Task 1.1）
      const body =
        conditionCheckBody(c) ??
        `        ${formatUnsupportedComment('condition', c.conditionType, 'UNKNOWN_CONDITION')}
        return true;`;
      return `    // 条件: ${c.conditionId} (invert: ${c.invert})
    // conditionType: ${c.conditionType}
    // args: ${JSON.stringify(c.args)}
    private static boolean ${methodName}(EventContext ctx) {
${body}
    }`;
    })
    .join('\n\n');

  // 动作执行方法（遍历 spec.actions 全量生成，含未被 handler 引用的）
  const actionMethods = actions
    .map((a) => {
      const methodName = `execute_${sanitizeIdent(a.actionId)}`;
      // P1-7：常见动作类型生成真实执行逻辑（event-logic.ts），未知类型走显性占位（Task 1.1）
      const body =
        actionExecuteBody(a) ??
        `        ${formatUnsupportedComment('action', a.actionType, 'UNKNOWN_ACTION')}`;
      return `    // 动作: ${a.actionId}
    // actionType: ${a.actionType}
    // args: ${JSON.stringify(a.args)}
    private static void ${methodName}(EventContext ctx) {
${body}
    }`;
    })
    .join('\n\n');

  const allMethods = [
    handlerMethods,
    notifyBlockPlaced,
    notifyItemPickedup,
    procedureMethods,
    conditionMethods,
    actionMethods,
  ]
    .filter(Boolean)
    .join('\n\n');

  // 事件上下文：承载回调参数（Fabric 回调多参数在此绑定），供条件/动作逻辑读取
  const eventContextClass = `    // 事件上下文：回调参数绑定字段（事件未提供时保持 null，逻辑侧判空保护）
    private static class EventContext {
        net.minecraft.server.network.ServerPlayerEntity player = null;
        net.minecraft.server.world.ServerWorld level = null;
        net.minecraft.util.math.BlockPos pos = null;
        net.minecraft.block.BlockState state = null;
        net.minecraft.item.ItemStack stack = null;
        net.minecraft.entity.Entity target = null;
    }`;

  const content = `package ${pkg};

public class ModEvents {
${eventContextClass}

${allMethods}

    public static void initialize() {
        // 注册事件处理器（按 eventType 调用对应 Fabric API；用全限定名避免 import 错误）
${registrations || '        // (无事件处理器)'}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEvents.java`,
    content,
  };
}
