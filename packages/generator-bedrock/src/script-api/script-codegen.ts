/**
 * Script API 产物代码生成器：`behavior_pack/scripts/main.js`。
 *
 * ## 为什么产出 `.js` 而不是 `.ts`
 * ─────────────────────────────
 * 这是本模块最关键的设计判断，结论是**产出 JavaScript**（类型信息放 JSDoc）。
 *
 * 1) **基岩的脚本引擎只执行 JavaScript，`manifest.json` 也只接受
 *    `language: "javascript"`**。MS Learn「Add-Ons Reference: manifest.json」
 *    的 modules 表原文：`language` —— "Only present if `type` is `script` …
 *    The only supported value is `javascript`"；minecraft.wiki「Manifest.json」
 *    同。写 `language: "typescript"` 的包**根本不会被加载**，脚本模块直接被跳过，
 *    `entry` 也必须指向 `.js` / `.mjs` 的真实文件。
 * 2) **本仓没有 TS→JS 编译环节**。`GenerationResult.buildCmd` 全仓只被当作
 *    「给用户看的提示文本」（generator-mod 写 `./gradlew build`、
 *    behavior-pack 写空串），kernel 的落盘链路是
 *    `GenerationResult.files` → 逐个写文件 → 打包 zip，中间没有 tsc / esbuild。
 *    产出 `.ts` 等于交付一批游戏跑不了、也没人编译的死文件 —— 这正是本任务
 *    要避免的失败模式。
 * 3) **类型信息不会因此丢失**。改用 JSDoc：编辑器 / `tsc --checkJs` 都能从
 *    `import('@minecraft/server')` 拿到官方同名 d.ts 的类型（`npm i
 *    @minecraft/server` 即可），可读性与可检查性保留，游戏也能直接跑。
 *    作者若坚持用 TS，应在包外自建 TS 工程、编译后覆盖本文件 —— 那是调用方
 *    的构建流程决策，不该由生成器单方面塞进产物。
 *
 * ## 事件注册为什么必须幂等（不要删掉 guard）
 * ────────────────────────────────────────
 * Script API 1.x 的 `world.afterEvents.*.subscribe()` **没有 `unsubscribe()`**
 * （`system.clearRun` / `clearJob` 虽在 1.x d.ts 中存在，但官方标注仅 beta 可用；
 * 2.x 的 `unsubscribe` 同样仍是 beta）。这带来两个坑：
 * - 对**同一个回调引用**重复 `subscribe` 会直接抛 `Callback already subscribed`；
 * - 换一个**新闭包**重复 `subscribe` 不报错，但监听器会成倍累积。脚本模块在
 *   每次进世界 / `/reload` / 开发期反复保存时都会重新求值，一旦在模块顶层直接
 *   subscribe，同一段逻辑就会跑 N 次（发 N 条消息、刷 N 只怪），而且
 *   **没有任何报错**提示你。
 * 正确做法（本模块固化）：模块顶层只做一次 `system.run(register...)`，
 * 注册函数内用模块级 guard 置位，保证订阅在任何情况下只发生一次；
 * `runInterval` 额外用句柄变量做二次幂等（同一个 tick job 重复创建会指数级叠加
 * CPU 开销，比重复消息更难查）。
 * `system.run` 这层包装还有一个独立必要性：Script API 2.0 下脚本默认在世界
 * 加载**之前**求值，直接访问 `world.*` 事件会拿到未就绪的 world。
 */

import {
  AFTER_EVENTS_PATH,
  BEFORE_EVENTS_PATH,
  afterEventBindings,
  beforeEventBindings,
  TICK_EVENT_NAME,
  type EventBinding,
} from './script-events.js';
import type {
  BpScriptActionSpec,
  BpScriptEventSpec,
  BpScriptFormSpec,
  BpScriptSpec,
} from './script-spec.js';
import type { ServerApiFamily } from './script-versions.js';
import {
  ACTION_REQUIRED_ARG,
  formatScriptUnsupportedComment,
  isCancellable,
  isEventKnown,
  SCRIPT_UNSUPPORTED_REASONS,
  type ScriptUnsupportedReasonKey,
} from './unsupported.js';
import type { UnimplementedItem } from '@mc-creator/shared';

/**
 * 脚本入口路径 —— **manifest 与产物的唯一真相来源**。
 *
 * manifest 里的 `modules[type=script].entry` 与实际落盘文件都从这里取，
 * 二者不可能对不上（「生成器产出与清单不一致」这类最典型 bug 的根因）。
 */
export const SCRIPT_ENTRY_PATH = 'scripts/main.js';

/** 产物里出现的模块 → 其 value import 符号集合（manifest dependencies 据此生成） */
export type ScriptImports = Map<string, Set<string>>;

/** 一次生成的产物 + 支撑信息 */
export interface ScriptCodegenResult {
  /** scripts/main.js 全文 */
  content: string;
  /** 产物中真实出现的 import（模块名 → 符号名） */
  imports: ScriptImports;
  /** 未实现条目（与产物里的 `MC-Creator: unsupported` 占位注释一一对应） */
  unimplemented: UnimplementedItem[];
  /** 调用方需展示的提示（版本回退、缺参被跳过等） */
  warnings: string[];
}

/** 把 spec 里的字符串安全编成 JS 字面量（用户文案可能含引号 / 换行 / 反斜杠） */
function lit(value: string): string {
  return JSON.stringify(value);
}

/** 代码块按缩进层级输出（产物统一 2 空格，与仓内其它生成器一致） */
function block(lines: string[], indent: number): string[] {
  const pad = '  '.repeat(indent);
  return lines.map((l) => (l.length > 0 ? pad + l : l));
}

/** 处理器上下文：事件绑定或 tick / timeout 的合成绑定 */
interface Ctx {
  /** 标识（用于错误日志与 unsupported 清单 id） */
  label: string;
  /** 绑定表达式；tick / timeout 用合成值 */
  binding: EventBinding;
  /** true = 合成上下文（tick / timeout），需要先做 player 存在性守卫 */
  synthetic: boolean;
}

/** tick / runTimeout 的合成绑定：没有事件对象，借第一个在线玩家当锚点 */
const SYNTHETIC_BINDING: EventBinding = {
  entity: 'player',
  player: 'player',
  dimension: "player.dimension ?? world.getDimension('minecraft:overworld')",
};

/** 模块级幂等标志（变量名进产物注释，便于作者查错） */
const GUARD_FLAG = '__mcCreatorEventsRegistered';
/** tick job 句柄（变量名进产物注释） */
const TICK_HANDLE = '__mcCreatorTickJob';

/** 归并后的一个处理器（同一 phase+event 只订阅一次） */
interface Handler {
  phase: 'after' | 'before';
  event: string;
  specs: BpScriptEventSpec[];
}

export function generateScriptEntry(
  script: BpScriptSpec,
  family: ServerApiFamily,
  packName: string,
): ScriptCodegenResult {
  const imports: ScriptImports = new Map();
  const unimplemented: UnimplementedItem[] = [];
  const warnings: string[] = [];

  // @minecraft/server 是 Script API 的必需依赖：任何 world/system 访问都来自它。
  useImport(imports, '@minecraft/server', 'world');
  useImport(imports, '@minecraft/server', 'system');

  /** 表单按触发事件分组，随该事件的处理器一起生成 */
  const formsByEvent = new Map<string, BpScriptFormSpec[]>();
  for (const form of script.forms) {
    const key = `${form.onPhase}:${form.on ?? 'playerJoin'}`;
    const list = formsByEvent.get(key) ?? [];
    list.push(form);
    formsByEvent.set(key, list);
  }

  /** 待生成的处理器：spec.events 按 phase+event 去重，表单触发的事件自动补进来 */
  const handlers = new Map<string, Handler>();
  for (const ev of script.events) {
    const key = `${ev.phase}:${ev.event}`;
    const existing = handlers.get(key);
    if (existing) existing.specs.push(ev);
    else handlers.set(key, { phase: ev.phase, event: ev.event, specs: [ev] });
  }
  for (const key of formsByEvent.keys()) {
    if (handlers.has(key)) continue;
    const sep = key.indexOf(':');
    handlers.set(key, {
      phase: key.slice(0, sep) as 'after' | 'before',
      event: key.slice(sep + 1),
      specs: [],
    });
  }

  /** 事件订阅体（进 register 函数） */
  const subscribeBlocks: string[] = [];
  /** tick job（含句柄守卫） */
  let tickBlock: string[] = [];
  /** system.runTimeout 延迟任务 */
  const timeoutBlocks: string[] = [];

  for (const handler of handlers.values()) {
    const { phase, event, specs } = handler;
    const label = `world.${phase === 'after' ? 'afterEvents' : 'beforeEvents'}.${event}`;
    const forms = formsByEvent.get(`${phase}:${event}`) ?? [];

    // 未知事件：不生成 subscribe。生成一个不存在的属性 = 运行时 TypeError，
    // 会让整个脚本模块加载失败，一个事件名写错就连带包里所有逻辑一起哑掉。
    if (!isEventKnown(family, phase, event)) {
      subscribeBlocks.push(formatScriptUnsupportedComment('event', event, 'UNKNOWN_EVENT'), '');
      unimplemented.push({
        kind: 'event',
        type: event,
        id: label,
        reason: SCRIPT_UNSUPPORTED_REASONS.UNKNOWN_EVENT,
      });
      continue;
    }

    // tick 特判：world.afterEvents.tick 不存在，逐 tick 逻辑走 system.runInterval
    if (event === TICK_EVENT_NAME) {
      if (phase === 'before') {
        unimplemented.push({
          kind: 'event',
          type: event,
          id: label,
          reason: SCRIPT_UNSUPPORTED_REASONS.TICK_BEFORE_PHASE,
        });
      }
      const interval = Math.max(1, specs[0]?.interval ?? 20);
      const body = renderHandlerBody(
        { label: 'system.runInterval(tick)', binding: SYNTHETIC_BINDING, synthetic: true },
        specs,
        [],
        imports,
        unimplemented,
        warnings,
        false,
      );
      tickBlock = [
        `// 逐 tick 逻辑：system.runInterval，间隔 ${interval} tick`,
        'system.runInterval(() => {',
        ...block(body, 1),
        `}, ${interval});`,
      ];
      continue;
    }

    const cancel = phase === 'before' && specs.some((s) => s.cancel);
    if (cancel && !isCancellable(family, phase, event)) {
      unimplemented.push({
        kind: 'event',
        type: event,
        id: label,
        reason: SCRIPT_UNSUPPORTED_REASONS.BEFORE_EVENT_NOT_CANCELLABLE,
      });
    }
    const binding = (phase === 'after' ? afterEventBindings(family) : beforeEventBindings(family))[
      event
    ] as EventBinding;
    const body = renderHandlerBody(
      { label, binding, synthetic: false },
      specs,
      forms,
      imports,
      unimplemented,
      warnings,
      cancel,
    );
    const subscribePath =
      phase === 'after' ? `${AFTER_EVENTS_PATH}.${event}` : `${BEFORE_EVENTS_PATH}.${event}`;
    subscribeBlocks.push(
      `// ${'─'.repeat(2)} ${label} ${'─'.repeat(2)}`,
      `${subscribePath}.subscribe((event) => {`,
      ...block(body, 1),
      '});',
      '',
    );
  }

  // runTimeout 只能在 guard 内调度：它一旦排上就一定会执行，1.x 没有
  // system.clearRun 能撤回，放在 guard 外会在重载时重复排程。
  for (const t of script.timeouts) {
    const body = renderHandlerBody(
      { label: `system.runTimeout(${t.id})`, binding: SYNTHETIC_BINDING, synthetic: true },
      [t],
      [],
      imports,
      unimplemented,
      warnings,
      false,
    );
    timeoutBlocks.push(
      `// 延迟任务 ${t.id}：${t.delay} tick（${(t.delay / 20).toFixed(2)} 秒）后执行一次`,
      'system.runTimeout(() => {',
      ...block(body, 1),
      `}, ${t.delay});`,
      '',
    );
  }

  const registerBody: string[] = [];
  if (tickBlock.length > 0) {
    registerBody.push(
      // registerBody 的行相对函数体为 0 级；外层统一再缩进 1 级，
      // 故这里的 if 块按 0 级拼、内部 tickBlock 按 1 级拼。
      ...block([`if (${TICK_HANDLE} === null) {`, ...block(tickBlock, 1), '}'], 0),
      '',
    );
  }
  registerBody.push(...subscribeBlocks);
  if (timeoutBlocks.length > 0) {
    registerBody.push(...timeoutBlocks);
  }
  // 去掉尾部空行，避免产物出现「} 前的悬空空行」
  while (registerBody.length > 0 && registerBody[registerBody.length - 1] === '') {
    registerBody.pop();
  }
  if (registerBody.length === 0) {
    registerBody.push('// spec 未声明任何事件 / 定时任务：后续请在本函数内手写监听。');
  }

  const content = [
    headerComment(packName),
    renderImports(imports),
    guardDecl(),
    ...(tickBlock.length > 0 ? [tickHandleDecl(), ''] : []),
    '/**',
    ' * 注册全部事件监听（**幂等**）。',
    ' *',
    ' * guard 的必要性见文件头注释：Script API 1.x 的事件监听无法注销，而脚本模块',
    ' * 会在每次进世界 / /reload / 开发期保存时重新求值。这里在注册前置位，保证',
    ' * 无论本函数被调用多少次，订阅都只发生一次。',
    ' */',
    'function registerMcCreatorEvents() {',
    ...block([`if (${GUARD_FLAG}) {`, '  return;', '}', `${GUARD_FLAG} = true;`, ''], 1),
    ...block(registerBody, 1),
    '}',
    '',
    '/**',
    ' * 顶层只调度一次，且必须延到 world 就绪之后：Script API 2.0 下脚本默认在世界',
    ' * 加载前求值，此时直接读 world.* 会拿到未就绪的 world。',
    ' */',
    `system.run(registerMcCreatorEvents);`,
    '',
  ].join('\n');

  return { content, imports, unimplemented, warnings };
}

/** 注册幂等标志声明块 */
function guardDecl(): string {
  return [
    '/**',
    ' * 事件注册幂等标志（模块级）。',
    ' *',
    ' * 必须先声明再赋值：脚本模块运行在严格模式，给未声明的变量赋值会直接抛',
    ' * ReferenceError，等于整个脚本模块加载失败（一条事件都注册不上）。',
    ' */',
    `let ${GUARD_FLAG} = false;`,
  ].join('\n');
}

/** tick job 句柄声明块（含「为什么要句柄」的说明） */
function tickHandleDecl(): string {
  return [
    '/**',
    ' * tick 任务句柄。',
    ' *',
    ' * system.runInterval 创建的 job 不会自动结束，1.x 也没有稳定的取消 API',
    ' * （system.clearRun / clearJob 仅 beta 可用）。重复创建同一个 tick job 会让',
    ' * 每 tick 的回调数成倍增长，帧率直接塌掉 —— 而且不报错，极难排查。',
    ' * 所以除了上层的注册 guard，这里再用句柄做一次幂等：句柄非空就不再建。',
    ' */',
    `let ${TICK_HANDLE} = null;`,
  ].join('\n');
}

/** 登记一次 value import */
function useImport(imports: ScriptImports, module: string, symbol: string): void {
  const set = imports.get(module) ?? new Set<string>();
  set.add(symbol);
  imports.set(module, set);
}

/** import 语句块（按模块名排序，保证产物稳定可比对） */
function renderImports(imports: ScriptImports): string {
  const lines: string[] = [];
  for (const module of [...imports.keys()].sort()) {
    const symbols = [...(imports.get(module) as Set<string>)].sort();
    lines.push(`import { ${symbols.join(', ')} } from '${module}';`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 渲染单个处理器体（含 try/catch 与 try 内的上下文声明、动作、表单）。
 *
 * 单独抽出来是因为事件订阅、tick job、runTimeout 三处结构完全一致，
 * 差异只有 label / 绑定 / 前置声明。
 */
function renderHandlerBody(
  ctx: Ctx,
  specs: Array<Pick<BpScriptEventSpec, 'actions' | 'code'>>,
  forms: BpScriptFormSpec[],
  imports: ScriptImports,
  unimplemented: UnimplementedItem[],
  warnings: string[],
  cancel: boolean,
): string[] {
  const inner: string[] = [...renderContextDecls(ctx)];

  if (cancel) {
    inner.push('// before 事件：取消后原行为（破坏 / 放置 / 使用）不会继续');
    inner.push('event.cancel = true;');
  }
  for (const spec of specs) {
    if (!spec.code) continue;
    inner.push(`// ── 作者代码（${ctx.label}）`);
    inner.push(...spec.code.split('\n'));
  }
  for (const spec of specs) {
    inner.push(...renderActions(spec.actions, ctx, imports, unimplemented, warnings));
  }
  inner.push(...renderForms(forms, ctx, imports, unimplemented));

  if (inner.filter((l) => l.length > 0).length === 0) {
    inner.push('// 该事件暂无可执行动作（spec 中 actions / code 为空），请在此手写逻辑');
  }

  return [
    'try {',
    ...block(inner, 1),
    '} catch (err) {',
    ...block([`console.error('[MC Creator] ${ctx.label} 处理失败:', err);`], 1),
    '}',
  ];
}

/**
 * 处理器上下文声明。
 *
 * 统一为「有就声明、没有就不声明」，不按实际用到的占位符裁剪：
 * - 作者在 `code` 里大概率要引用 `target` / `location` / `player`，裁剪会让
 *   手写片段编译不过（CheckJS 下是类型错误，运行期是 ReferenceError）；
 * - 未使用的局部 `const` 在游戏里零成本，产物可读性反而更好。
 */
function renderContextDecls(ctx: Ctx): string[] {
  const b = ctx.binding;
  const lines: string[] = [];

  if (ctx.synthetic) {
    lines.push('// tick / 延迟任务没有事件对象，借第一个在线玩家当锚点');
    lines.push('const player = world.getPlayers()[0];');
    lines.push('if (!player) {');
    lines.push('  // 世界里没有在线玩家，无事可做');
    lines.push('  return;');
    lines.push('}');
    lines.push('const target = player;');
    lines.push('const dimension = player.dimension;');
    lines.push('const location = player.location;');
    return lines;
  }

  if (b.player) {
    lines.push(`const player = ${b.player};`);
    lines.push(`const target = ${b.entity ?? b.player};`);
  } else if (b.entity) {
    lines.push(`const target = ${b.entity};`);
  }
  if (b.otherEntity) {
    lines.push(`// 攻击来源可能不存在（如摔落伤害），故容错`);
    lines.push(`const other = ${b.otherEntity} ?? undefined;`);
  }
  if (b.block) {
    lines.push(`const block = ${b.block};`);
  }
  if (b.dimension) {
    lines.push(`const dimension = ${b.dimension};`);
  }
  const locSrc = b.block ?? b.entity ?? b.player;
  if (locSrc) {
    if (locSrc === b.block && b.block) lines.push('const location = block.location;');
    else if (locSrc === b.player && b.player) lines.push('const location = player.location;');
    else if (locSrc === b.entity && b.entity) lines.push('const location = target.location;');
    else lines.push(`const location = ${locSrc}.location;`);
  }
  return lines;
}

/** 渲染动作代码（缺参 / 无上下文时产出显性占位而不是编出坏代码） */
function renderActions(
  actions: BpScriptActionSpec[],
  ctx: Ctx,
  imports: ScriptImports,
  unimplemented: UnimplementedItem[],
  warnings: string[],
): string[] {
  if (actions.length === 0) return [];
  const lines: string[] = [];
  for (const action of actions) {
    const requiredKey = ACTION_REQUIRED_ARG[action.kind];
    const requiredValue = action[requiredKey] as string | undefined;
    if (!requiredValue) {
      lines.push(formatScriptUnsupportedComment('action', action.kind, 'ACTION_MISSING_ARG'));
      unimplemented.push({
        kind: 'action',
        type: action.kind,
        id: ctx.label,
        reason: SCRIPT_UNSUPPORTED_REASONS.ACTION_MISSING_ARG,
      });
      continue;
    }
    const missing = needsOf(action)
      .filter((p) => !hasContext(p, ctx))
      .map((p) => PLACEHOLDER_LABEL[p] ?? p);
    if (missing.length > 0) {
      warnings.push(
        `事件 ${ctx.label} 的动作 ${action.kind} 缺少可用上下文（${missing.join('/')}），已跳过`,
      );
      unimplemented.push({
        kind: 'action',
        type: action.kind,
        id: ctx.label,
        reason: SCRIPT_UNSUPPORTED_REASONS.ACTION_NO_TARGET,
      });
      continue;
    }
    lines.push(...renderActionCall(action, requiredValue));
    if (action.kind === 'give_item') useImport(imports, '@minecraft/server', 'ItemStack');
  }
  return lines;
}

/** 占位符 → 给人看的名字（warnings 文案用） */
const PLACEHOLDER_LABEL: Record<string, string> = {
  entity: '实体',
  player: '玩家',
  block: '方块',
  dimension: '维度',
  location: '位置',
};

/** 每种动作需要哪些上下文占位符 */
function needsOf(action: BpScriptActionSpec): string[] {
  switch (action.kind) {
    case 'spawn_entity':
    case 'set_block':
    case 'play_sound':
      return ['dimension', 'location'];
    case 'add_tag':
    case 'remove_tag':
    case 'add_effect':
    case 'give_item':
      return ['entity'];
    case 'send_message':
      // audience=all 走 world.sendMessage（world 作用域，无需上下文）；
      // audience=player 走 player.sendMessage，需要 player 上下文。
      return action.audience === 'player' ? ['player'] : [];
  }
}

/** 占位符在当前上下文里是否有可用的已声明变量 */
function hasContext(placeholder: string, ctx: Ctx): boolean {
  if (ctx.synthetic) return true;
  const b = ctx.binding;
  switch (placeholder) {
    case 'entity':
      return Boolean(b.entity ?? b.player);
    case 'player':
      return Boolean(b.player);
    case 'block':
      return Boolean(b.block);
    case 'dimension':
      return Boolean(b.dimension);
    case 'location':
      return Boolean(b.block ?? b.entity ?? b.player);
    default:
      return false;
  }
}

/** 单个动作 → 一行（或多行）已核实的 API 调用 */
function renderActionCall(action: BpScriptActionSpec, value: string): string[] {
  const v = lit(value);
  switch (action.kind) {
    case 'spawn_entity':
      return [`dimension.spawnEntity(${v}, location);`];
    case 'set_block':
      return [`dimension.setBlockType(location, ${v});`];
    case 'add_tag':
      return [`target.addTag(${v});`];
    case 'remove_tag':
      return [`target.removeTag(${v});`];
    case 'send_message':
      return action.audience === 'player'
        ? [`player.sendMessage(${v});`]
        : [`world.sendMessage(${v});`];
    case 'add_effect':
      return [`target.addEffect(${v}, ${action.duration}, { amplifier: ${action.amplifier} });`];
    case 'play_sound':
      return [`dimension.playSound(${v}, location);`];
    case 'give_item':
      return [
        "const inventory = /** @type {import('@minecraft/server').EntityInventoryComponent | undefined} */ (",
        "  target.getComponent('minecraft:inventory'),",
        ');',
        'if (inventory) {',
        `  inventory.addItem(new ItemStack(${v}, ${action.count}));`,
        '}',
      ];
  }
}

/** 渲染 @minecraft/server-ui 表单代码 */
function renderForms(
  forms: BpScriptFormSpec[],
  ctx: Ctx,
  imports: ScriptImports,
  unimplemented: UnimplementedItem[],
): string[] {
  if (forms.length === 0) return [];
  if (!ctx.synthetic && !ctx.binding.player) {
    for (const form of forms) {
      unimplemented.push({
        kind: 'action',
        type: `form:${form.kind}`,
        id: form.id,
        reason: SCRIPT_UNSUPPORTED_REASONS.FORM_NO_PLAYER,
      });
    }
    return [];
  }
  const lines: string[] = [];
  for (const form of forms) {
    const cls = form.kind === 'modal' ? 'ModalFormData' : 'ActionFormData';
    useImport(imports, '@minecraft/server-ui', cls);
    const v = `form_${form.id.replace(/[^\w]/g, '_')}`;
    lines.push(`// 表单 ${form.id}（@minecraft/server-ui ${cls}）`);
    lines.push(`const ${v} = new ${cls}()`);
    lines.push(`  .title(${lit(form.title)});`);
    if (form.kind === 'modal') {
      if (form.body) {
        lines.push('// 注意：ModalFormData 没有 body 属性（只有 ActionFormData /');
        lines.push('// MessageFormData 有），故本条 body 已被忽略。');
      }
      lines.push(`${v}.button1(${lit(form.button1)});`);
      lines.push(`${v}.button2(${lit(form.button2)});`);
    } else {
      if (form.body) lines.push(`${v}.body(${lit(form.body)});`);
      for (const b of form.buttons) lines.push(`${v}.button(${lit(b)});`);
    }
    lines.push(`${v}`);
    lines.push('  .show(player)');
    lines.push('  .then((r) => {');
    lines.push('    // 玩家直接关闭表单时 canceled=true，此时不应执行任何后续逻辑');
    lines.push('    if (r.canceled) {');
    lines.push('      return;');
    lines.push('    }');
    lines.push(
      `    console.log('[MC Creator] 表单 ${form.id} 响应:', r.selection ?? r.formValues);`,
    );
    lines.push('  })');
    lines.push('  .catch((e) => {');
    lines.push(`    console.error('[MC Creator] 表单 ${form.id} 显示失败:', e);`);
    lines.push('  });');
  }
  return lines;
}

/** 文件头注释：说明语言选择与幂等要求，产物第一屏就是「为什么」 */
function headerComment(packName: string): string {
  return [
    '/**',
    ` * ${packName} —— 基岩版 Script API 入口脚本（MC Creator 自动生成）。`,
    ' *',
    ' * 本文件由 @mc-creator/generator-bedrock 生成，请改生成器而不是直接改这里。',
    ' *',
    ' * 为什么是 .js 而不是 .ts',
    ' * ---------------------------',
    ' * 1) 基岩脚本引擎只执行 JavaScript：manifest.json 中 script 模块的',
    ' *    `language` 字段合法值只有 "javascript"，`entry` 也必须指向 .js/.mjs。',
    ' *    产出 .ts 的包不会被加载。',
    ' * 2) 本仓产物落盘链路（GenerationResult.files → kernel 写文件 → 导出 zip）',
    ' *    没有 TS→JS 编译环节，buildCmd 只是提示文本、不驱动构建。',
    ' * 3) 类型信息改由 JSDoc 承载：`npm i @minecraft/server` 后编辑器与',
    ' *    `tsc --checkJs` 仍能拿到完整类型，兼顾可读性、可检查性与可运行性。',
    ' *    要用 TypeScript 就在包外自建 TS 工程，编译后覆盖本文件。',
    ' *',
    ' * 事件注册必须幂等（guard 见文件末尾）',
    ' * ------------------------------------',
    ' * Script API 1.x 的事件监听没有 unsubscribe()，同一回调重复 subscribe 会抛',
    ' * "Callback already subscribed"，换新闭包重复 subscribe 则静默累积 —— 退出',
    ' * 重进世界、/reload、开发期反复保存都会触发，表现为同一逻辑跑 N 次且无报错。',
    ' * 故用模块级 guard 保证只订阅一次；tick job 再用句柄做二次幂等。',
    ' */',
    '',
  ].join('\n');
}

/** 供 manifest 生成器取「产物里真实出现的模块」的辅助谓词 */
export function hasModuleImport(imports: ScriptImports, module: string): boolean {
  return imports.has(module);
}

export type { ScriptUnsupportedReasonKey };
