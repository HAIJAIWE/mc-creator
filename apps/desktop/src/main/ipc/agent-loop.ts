import { ipcMain } from 'electron';
import {
  runClosedLoop,
  createZenFreeGateway,
  type ClosedLoopGateway,
  type ClosedLoopValidateResult,
  type GeneratePromptInput,
} from '@mc-creator/agent';
import { validateDatapack, DatapackSpec } from '@mc-creator/shared';
import {
  AGENT_RUN_LOOP,
  AgentRunLoopRequest,
  type AgentRunLoopRes,
} from '../../shared/ipc/agent-loop.js';

/** 可注入的网关工厂（生产默认 zen 免费通道；测试注入 fake 网关，不断网）。 */
export interface AgentLoopDeps {
  createGateway?: () => ClosedLoopGateway;
}

/**
 * JSON-only 输出指令：进 GeneratePromptInput.contextPack 尾段（错误回灌时 runClosedLoop 会追加）。
 *
 * 第 4 条是实测加的：免费模型把 30+ 个「选填数组」全填了，输出膨胀到
 * 推理+正文一起撑爆 completion 预算，正文被截断成半个 JSON
 * （首轮真实回灌的 abort 原因）。显式要求「不用的字段一律不写」把输出压到最小。
 */
const JSON_ONLY_INSTRUCTION = [
  '## 输出约束（必须遵守）',
  '1. 只输出一个合法 JSON 对象，即 DatapackSpec 本体；不要输出 JSON 之外的任何文字（不要 markdown 代码围栏、不要解释说明）。',
  '2. 该 JSON 必须能被 JSON.parse 直接解析；字符串内的换行与引号必须转义。',
  '3. 字段必须符合下面的 DatapackSpec 说明；id 类字段只用小写字母、数字和下划线。',
  '4. **只写你真正用到的字段**。所有选填数组（recipes/tags/functions/... 见下）不写就等于空数组，不要为了“完整”而把它们全部填上；输出越短越好。',
  '5. 除下面明确写「必填」的字段外，其余字段都可省略。',
  '6. 若是修复轮（提示里带「错误回灌」段落）：**只改被点名的那一处**，已经正确的字段原样照抄。特别注意别把字符串字段改成对象、或把数组改成对象。',
].join('\n');

/** 最小可用样例：进 apiTypes 尾段。
 *
 * 实测依据：不给样例时模型要靠推理反推 key/ingredient 的正确形态
 * （推理 token 吃掉 1.2 万，输出还被截断）。一份可复制的最小实例
 * 比文字规则管用得多 —— 形状错的问题直接消失。
 */
const DATAPACK_MINIMAL_EXAMPLE = [
  '## 最小合法样例（形状以此为准，不要发明别的形状）',
  '```json',
  JSON.stringify(
    {
      packId: 'ruby_ore',
      packName: '红宝石矿',
      description: '加入红宝石矿石与合成配方',
      packFormat: 48,
      recipes: [
        {
          id: 'ruby_ore_block',
          type: 'crafting_shaped',
          pattern: ['RRR', 'RRR', 'RRR'],
          key: { R: ['minecraft:redstone'] },
          result: 'ruby_ore:block',
          count: 1,
        },
        {
          id: 'ruby_ingot',
          type: 'smelting',
          ingredient: 'ruby_ore:block',
          result: 'ruby_ore:ingot',
        },
      ],
      functions: [{ id: 'ruby_ore/setup', commands: ['say ruby ore ready'] }],
    },
    null,
    2,
  ),
  '```',
  '注意形状细节：`key` 的每个值是**字符串数组**（不是对象）；`ingredient`/`result`/`source`/`template`/`base`/`addition` 都是**纯字符串物品 ID**（不是 `{item:...}` 对象）。',
].join('\n');

/** DatapackSpec 字段说明：进 GeneratePromptInput.apiTypes（先读 schemas/datapack-spec.ts 再写）。 */
const DATAPACK_API_TYPES = [
  '## DatapackSpec 顶层字段',
  '- packId: string（必填，/^[a-z0-9_]+$/，数据包命名空间）',
  '- packName: string（必填，显示名）',
  '- description: string（选填，描述）',
  '- packFormat: number（必填；1.21.11 对应 48）',
  '- recipes: RecipeSpec[]（选填）。crafting_shaped 必须同时给 pattern+key，且 pattern 各行等宽、最多 3 行、每行最多 3 字符，pattern 引用的每个字符都必须在 key 中定义；crafting_shapeless 必须给 ingredients；smelting/blasting/smoking/campfire_cooking 必须给 ingredient；smithing_transform 必须给 template+base+addition',
  '- tags/functions/advancements/lootTables/predicates/itemTags/blockTags：选填数组（function 每项 {id, commands}，id 只用小写字母/数字/下划线）',
  '- dimensions/dimensionTypes/biomes/noiseSettings：选填数组（dimensionType 的 height 须 16–4096、minY 须 -2032–2031 且 minY+height≤2032；biome 的 temperature 须 -2–2、downfall 须 0–1）',
  '- enchantments/effects：选填，但需要 packFormat≥26（1.21+）；damageTypes 需要 packFormat≥9；trimPatterns/trimMaterials 需要 packFormat≥14；instruments 需要 packFormat≥9',
  '- structures/structureSets/configuredFeatures/placedFeatures/templatePools/processorLists/jukeboxSongs/paintingVariants/wolfVariants/bannerPatterns/chatTypes/densityFunctions/noises/flatPresets：选填数组',
].join('\n');

/**
 * 组装 GeneratePromptInput（L2/datapack）。
 * JSON-only 输出指令 + DatapackSpec 字段说明分别进 contextPack / apiTypes，
 * 用户原始需求原样进 userPrompt（永不截断）。
 */
export function buildAgentLoopPrompt(prompt: string, mcVersion: string): GeneratePromptInput {
  return {
    kind: 'datapack',
    userPrompt: prompt,
    versionContext: `mc_version: ${mcVersion}（运行时版本，以此为准）`,
    apiTypes: `${DATAPACK_API_TYPES}\n${DATAPACK_MINIMAL_EXAMPLE}`,
    contextPack: JSON_ONLY_INSTRUCTION,
    budgetChars: 12000,
  };
}

/**
 * 从模型输出中提取第一个配平的 {...} 块。
 *
 * 实测免费模型即使被要求 JSON-only，仍会在前后夹散文或 markdown 围栏
 * （首轮真实回灌即因此失败）。直接 JSON.parse 整段等于把模型的
 * 表达习惯当成错误；提取配平块后解析，失败才判无效。字符串内的
 * 转义引号与花括号按 JSON 词法跳过，不做正则猜测。
 * 返回 null 表示连候选块都没有。
 */
export function extractJsonBlock(text: string): string | null {
  const unfenced = text.replace(/```[a-zA-Z]*\n?/g, '');
  const start = unfenced.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return unfenced.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 闭环 validate：提块 → JSON.parse → DatapackSpec 结构校验 → 真 validateDatapack。
 * - 无配平块/解析失败：detail 注明并附原文前 200 字；
 * - 结构/语义失败：detail 含校验 issues 原文（错误回灌才有料）；
 * - 通过时经 onAccept 交出完整 spec（zod defaults 已填充）。
 *
 * 截断与形状错误必须分开说：免费通道的 completion 预算被推理 token 吃掉大半
 * （实测 14097 completion 里 11991 是 reasoning），正文常在半途被截断。
 * 那种情况下 detail 若写成「没有配平的 JSON 块」，修复轮会去改 JSON 形状，
 * 而真因是「写太长」——于是修一轮还是截断，轮次白烧。
 */
export function validateGeneratedSpec(
  text: string,
  onAccept: (spec: Record<string, unknown>) => void,
): ClosedLoopValidateResult {
  const candidate = extractJsonBlock(text);
  if (candidate === null) {
    const head = text.replace(/```[a-zA-Z]*\n?/g, '').trimStart();
    const truncated = head.startsWith('{') && !head.trimEnd().endsWith('}');
    const detail = truncated
      ? `模型输出疑似被截断（JSON 块未闭合，长度 ${text.length} 字）：不是形状错，修复时应缩短内容。原文前 200 字：${text.slice(0, 200)}`
      : `模型输出中没有配平的 JSON 块（原文前 200 字）：${text.slice(0, 200)}`;
    return { ok: false, detail };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, detail: `模型未返回合法 JSON（原文前 200 字）：${text.slice(0, 200)}` };
  }
  const structural = DatapackSpec.safeParse(parsed);
  if (!structural.success) {
    const zodDetail = structural.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    return { ok: false, detail: `Spec 结构校验失败：\n${zodDetail}` };
  }
  const vr = validateDatapack(structural.data);
  if (!vr.valid) {
    const detail = vr.issues
      .map((i) => `[${i.level}][${i.type}${i.id ? `:${i.id}` : ''}][${i.field}] ${i.message}`)
      .join('\n');
    return { ok: false, detail: `Datapack 校验失败：\n${detail}` };
  }
  onAccept(structural.data as unknown as Record<string, unknown>);
  return { ok: true, kind: 'datapack' };
}

/**
 * 处理一次 AI 规格闭环（可单测的纯函数；registerAgentLoopHandlers 只做 ipc 接线）。
 * - kind 非 datapack：直接返回明确不支持错，不臆测；
 * - 网关超时/失败一律收敛为 abort（ok:false），不抛；
 * - 进度经 onStep 打 main console 日志（不新增流式通道）。
 */
export async function handleAgentRunLoop(
  raw: unknown,
  deps: AgentLoopDeps = {},
): Promise<AgentRunLoopRes> {
  const req = AgentRunLoopRequest.parse(raw);
  if (req.kind !== 'datapack') {
    return { ok: false, error: `不支持的 kind：“${req.kind}”，当前仅支持 "datapack"` };
  }

  // 单轮 5 分钟：免费通道慢模型一轮可达 60s+（首轮实测 fix 轮撞上 120s 默认超时）。
  // 闭环是后台任务，用户不等交互响应；宁可等足，不提前判死。
  const gateway = deps.createGateway?.() ?? createZenFreeGateway({ timeoutMs: 300_000 });
  let acceptedSpec: Record<string, unknown> | null = null;

  const result = await runClosedLoop({
    prompt: buildAgentLoopPrompt(req.prompt, req.mcVersion),
    gateway,
    validate: (text: string) =>
      validateGeneratedSpec(text, (spec) => {
        acceptedSpec = spec;
      }),
    // 默认诊断器：透传 validate detail（pipeline 语义下省略 diagnose 会导致
    // diagnose-ok 缺失→直接 abort、fix 永不可达；透传既保留 abort 语义，
    // 又让错误回灌有料）。网关超时/失败的 abort 收敛由 runClosedLoop 保留。
    diagnose: (detail?: string) => ({ ok: true, detail: detail ?? '校验未通过' }),
    maxAttempts: req.maxAttempts,
    onStep: (e) => {
      console.log(
        `[agent-loop] stage=${e.stage} ok=${e.ok} attempts=${e.attempts} next=${e.next.action}` +
          (e.detail !== undefined ? ` detail=${e.detail.slice(0, 300)}` : ''),
      );
    },
  });

  if (result.outcome === 'succeed' && acceptedSpec !== null) {
    return {
      ok: true,
      spec: acceptedSpec,
      transcript: result.transcript,
      attempts: result.attempts,
    };
  }
  const lastFail = [...result.history].reverse().find((h) => !h.ok);
  return {
    ok: false,
    error: lastFail?.detail ?? 'AI 闭环未收敛，转人工确认',
    transcript: result.transcript,
    attempts: result.attempts,
  };
}

/** 注册 AGENT_RUN_LOOP 通道（生产接线；实际挂载到 registerIpcHandlers 由后续任务补一行）。 */
export function registerAgentLoopHandlers(deps: AgentLoopDeps = {}): void {
  ipcMain.handle(AGENT_RUN_LOOP, (_e, raw: unknown) => handleAgentRunLoop(raw, deps));
}
