/**
 * AgentRuntime：智能体运行引擎。
 * 管理 AI 对话循环：用户消息 → AI 推理 → 工具调用 → 审批 → 执行 → AI 推理 → … → 最终回复
 *
 * 核心流程：
 * 1. 用户发送消息
 * 2. 构建 messages（系统提示 + 历史对话 + 工具定义）
 * 3. 调用 AI API（流式）
 * 4. AI 返回文本和/或 tool_calls
 * 5. 对于 tool_calls：
 *    a. 检查 requiresApproval → 若需要，暂停等待用户审批
 *    b. 执行工具，获取结果
 *    c. 将 tool_result 追加到 messages
 *    d. 回到步骤 3（继续推理）
 * 6. AI 返回纯文本 → 作为最终回复
 */

import { findTool, toolsToFunctionDefinitions } from './agent-tools.js';
import { ipcClient } from './ipc-client.js';

// === 类型 ===
export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  /** tool_calls 仅 assistant 消息可能有 */
  toolCalls?: AgentToolCall[];
  /** tool_call_id 仅 tool 消息有 */
  toolCallId?: string;
  timestamp: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** 执行结果（仅已执行的工具调用有） */
  result?: string;
  /** 审批状态 */
  approvalStatus?: 'pending' | 'approved' | 'rejected';
}

export interface AgentState {
  messages: AgentMessage[];
  isRunning: boolean;
  pendingApproval: AgentToolCall | null;
  error: string | null;
  /** 本轮对话的工具调用记录（用于 UI 可视化） */
  toolCallLog: Array<{
    call: AgentToolCall;
    result?: string;
    duration: number;
  }>;
}

export type AgentListener = (state: AgentState) => void;

// === 系统提示 ===
const SYSTEM_PROMPT = `你是 MC Creator 的 AI 编程助手，运行在一个 Minecraft 模组开发 IDE 中。
你不是一个普通代码助手——你的核心职责是**根据用户的自然语言描述，生成完整、正确的 Minecraft 数据包/模组内容**。

## 你的核心能力
- **apply_content_template**：一键生成完整 MC 内容套件（最推荐！）
  - new_ore: 新矿石 → 矿锭 + 矿粒 + 存储方块 + 镐/斧/锹/锄/剑 + 头盔/胸甲/护腿/靴子 + 全套配方 + 标签 + 语言文件
  - new_food: 新食物 → 生/熟 + 烟熏/营火配方 + 语言文件
  - new_dimension: 新维度 → 维度类型 + 生物群系 + 维度生成 + 语言文件
  - new_enchantment: 新附魔 → 自定义附魔(maxLevel/weight/supportedItems/slots) + 语言文件
  - new_effect: 新状态效果 → 自定义效果(color/instant/beneficial) + 语言文件
  - new_structure: 新结构 → jigsaw/random_spread/concentric_rings + 模板池 + 生物群系 + 语言文件
  - new_biome: 新生物群系 → 降水/温度/颜色 + 语言文件
- **generate_datapack**：传入 DatapackSpec JSON，一次性生成完整数据包
- 读取、创建、编辑、删除项目文件
- 搜索代码和文件，获取项目上下文
- 执行构建命令，验证生成结果

## Minecraft 数据包内容模型（1.21.x，pack_format 48）

你必须精通以下所有内容类型，能根据用户描述生成正确格式的数据包文件：

### 配方（recipes）— data/<namespace>/recipe/<id>.json
- crafting_shaped: 有形合成（pattern + key）
- crafting_shapeless: 无形合成（ingredients）
- smelting/blasting/smoking/campfire_cooking: 熔炼类（ingredient + experience + cookingTime）
  - smelting: 200 ticks | blasting/smoking: 100 ticks | campfire_cooking: 600 ticks
- stonecutting: 切石机（ingredient + result + count）
- smithing_transform: 锻造台升级（template + base + addition + result）
- smithing_trim: 盔甲纹饰锻造（template + base + addition）
- brewing: 酿造台（inputPotion + ingredientItem + outputPotion）

### 自定义附魔（enchantments）— data/<namespace>/enchantment/<id>.json（1.21+）
字段: description, supported_items(标签如 #minecraft:enchantable/sword), weight, anvil_cost, min_cost({base, per_level_above_first}), max_cost({base, per_level_above_first}), max_level, slots(any/mainhand/offhand/hand/feet/legs/chest/head/armor/body), is_curse, is_treasure

### 自定义状态效果（effects）— data/<namespace>/effect/<id>.json（1.21+）
字段: description, color(0xRRGGBB), instant, beneficial

### 自定义损伤类型（damageTypes）— data/<namespace>/damage_type/<id>.json（1.19.4+）
字段: message_id(default/player/player_attack/fall/intentional_game_design), scaling(never/when_caused_by_living_non_player/always), exhaustion

### 世界生成
- dimension_types: 固定时间/天空光/天花板/超薄/坐标缩放/床工作/重生锚/minY/height/logicalHeight/infiniburn/effects/ambientLight/piglinSafe
- biomes: precipitation(none/rain/snow)/temperature/temperatureModifier/downfall/skyColor/waterColor/waterFogColor/fogColor/grassColor/foliageColor/surfaceBuilder
- noise_settings: minY/height/noiseSizeHorizontal/noiseSizeVertical/densityFunction
- dimensions: dimensionType + generatorType(noise/flat/debug/void) + biomeSource + biomes + noiseSettings/flatLayers

### 自定义结构（structures）— data/<namespace>/worldgen/structure/<id>.json
字段: placementType(jigsaw/random_spread/concentric_rings), templatePool, maxDistance, size, startHeight, biomes, step(none/beard/beard_thin/encapsulate)

### 盔甲纹饰（trimPatterns + trimMaterials）— 1.20+
- trim_pattern: templateItem, description, decal
- trim_material: materialItem, color(#RRGGBB), description

### 乐器（instruments）— 1.19+
字段: soundEvent, useDuration(tick), range(格), description

### 粒子（particles）
字段: description, override

### 其他已支持类型
- functions: mcfunction 文件（commands 列表）
- lootTables: 战利品表（type + pools[rolls + entries[name,weight,count]]）
- predicates: 谓词（condition JSON）
- advancements: 进度（icon + title + description + trigger + conditions）
- tags/itemTags/blockTags: 标签（values + replace）

## 常用 MC 标签（用于 supported_items 和物品标签）
- #minecraft:enchantable/sword | /bow | /crossbow | /trident | /mining | /fishing | /armor | /mace
- #minecraft:mineable/pickaxe | /axe | /shovel | /hoe
- #minecraft:needs_stone_tool | /needs_iron_tool | /needs_diamond_tool
- #minecraft:logs | /planks | /stairs | /slabs | /doors

## 工作原则
1. **理解用户意图**：先确认用户想要什么类型的 MC 内容（数据包/模组/资源包）
2. **生成完整内容**：根据描述生成包含所有必要字段的完整 Spec，不要省略默认值
3. **MC 专业性**：字段名、数值范围、JSON 结构必须符合原版格式规范
4. **小步迭代**：复杂内容分步生成，每步验证
5. **验证结果**：生成后建议用户检查预览面板或运行构建
6. **中文回答**：所有解释使用中文

当前环境信息会通过 get_project_context 工具获取。`;

// === AgentRuntime ===
export class AgentRuntime {
  private state: AgentState = {
    messages: [],
    isRunning: false,
    pendingApproval: null,
    error: null,
    toolCallLog: [],
  };
  private listeners: Set<AgentListener> = new Set();
  private abortController: AbortController | null = null;
  /** 审批 Promise 的 resolve 回调（轮询改 Promise 回调，避免 100ms 轮询） */
  private approvalResolver: ((approved: boolean) => void) | null = null;

  /** 订阅状态变更 */
  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 获取当前状态快照 */
  getState(): AgentState {
    return { ...this.state };
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** 发送用户消息，启动 Agent 循环 */
  async sendUserMessage(content: string): Promise<void> {
    this.state.messages.push({ role: 'user', content, timestamp: Date.now() });
    this.state.isRunning = true;
    this.state.error = null;
    this.state.toolCallLog = [];
    this.notify();

    try {
      await this.runAgentLoop();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.state.error = (e as Error).message;
      }
    } finally {
      this.state.isRunning = false;
      this.notify();
    }
  }

  /** 审批待定工具调用 */
  approveToolCall(): void {
    if (!this.state.pendingApproval) return;
    this.state.pendingApproval.approvalStatus = 'approved';
    this.notify();
    // 触发 Promise resolve
    this.approvalResolver?.(true);
    this.approvalResolver = null;
  }

  /** 拒绝待定工具调用 */
  rejectToolCall(reason?: string): void {
    if (!this.state.pendingApproval) return;
    this.state.pendingApproval.approvalStatus = 'rejected';
    // 将拒绝结果追加为 tool 消息
    this.state.messages.push({
      role: 'tool',
      content: `用户拒绝执行此操作${reason ? `：${reason}` : ''}`,
      toolCallId: this.state.pendingApproval.id,
      timestamp: Date.now(),
    });
    this.state.pendingApproval = null;
    this.notify();
    // 触发 Promise resolve
    this.approvalResolver?.(false);
    this.approvalResolver = null;
  }

  /** 中止当前运行 */
  abort(): void {
    this.abortController?.abort();
    this.state.isRunning = false;
    this.state.pendingApproval = null;
    this.approvalResolver?.(false);
    this.approvalResolver = null;
    this.notify();
  }

  /** 清空对话历史 */
  clearHistory(): void {
    this.state.messages = [];
    this.state.toolCallLog = [];
    this.state.error = null;
    this.notify();
  }

  // === 内部方法 ===

  /** 核心 Agent 循环 */
  private async runAgentLoop(): Promise<void> {
    const maxIterations = 10; // 最多 10 轮工具调用
    let iteration = 0;

    while (iteration < maxIterations && !this.abortController?.signal.aborted) {
      iteration++;
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      // 构建发给 AI 的消息
      const aiMessages = this.buildAiMessages();

      // 调用 AI（流式）
      const response = await this.callAi(aiMessages, signal);

      // 如果已中止，退出循环
      if (signal.aborted) break;

      // 如果 AI 返回了 tool_calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // 追加 assistant 消息（含 tool_calls）
        this.state.messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
          timestamp: Date.now(),
        });
        this.notify();

        // 逐个处理 tool_calls
        for (const toolCall of response.toolCalls) {
          const tool = findTool(toolCall.name);
          if (!tool) {
            this.state.messages.push({
              role: 'tool',
              content: `未知工具：${toolCall.name}`,
              toolCallId: toolCall.id,
              timestamp: Date.now(),
            });
            continue;
          }

          // 需要审批的工具
          if (tool.requiresApproval) {
            this.state.pendingApproval = toolCall;
            this.notify();

            // 等待用户审批
            const approved = await this.waitForApproval();
            // 中止时退出循环
            if (signal.aborted) break;
            if (!approved) {
              continue; // 拒绝了，跳过此工具
            }
            this.state.pendingApproval = null;
          }

          // 执行工具
          const startTime = Date.now();
          try {
            const result = await tool.execute(toolCall.arguments);
            const duration = Date.now() - startTime;
            toolCall.result = result;

            this.state.toolCallLog.push({ call: toolCall, result, duration });
            this.state.messages.push({
              role: 'tool',
              content: result,
              toolCallId: toolCall.id,
              timestamp: Date.now(),
            });
          } catch (e) {
            const errorResult = `工具执行错误：${(e as Error).message}`;
            toolCall.result = errorResult;
            this.state.toolCallLog.push({
              call: toolCall,
              result: errorResult,
              duration: Date.now() - startTime,
            });
            this.state.messages.push({
              role: 'tool',
              content: errorResult,
              toolCallId: toolCall.id,
              timestamp: Date.now(),
            });
          }
          this.notify();
        }
        // 继续循环，让 AI 基于工具结果继续推理
      } else {
        // AI 返回纯文本，追加为最终回复
        this.state.messages.push({
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
        });
        this.notify();
        break; // 结束循环
      }
    }

    if (iteration >= maxIterations) {
      this.state.messages.push({
        role: 'assistant',
        content: '已达到最大工具调用轮次（10），请继续对话以完成剩余操作。',
        timestamp: Date.now(),
      });
      this.notify();
    }
  }

  /** 构建 AI 消息数组（含工具定义注入） */
  private buildAiMessages(): Array<{
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }> {
    // 将工具定义注入系统提示，让 AI 知道可用的工具和调用格式
    const toolDefs = toolsToFunctionDefinitions();
    const toolInstructions = toolDefs
      .map((td) => {
        const params = td.function.parameters;
        const paramDesc = Object.entries(params.properties)
          .map(
            ([name, schema]) =>
              `  - ${name} (${(schema as Record<string, unknown>).type}): ${(schema as Record<string, unknown>).description}`,
          )
          .join('\n');
        return `### ${td.function.name}\n${td.function.description}\n参数:\n${paramDesc}\n必须参数: ${params.required.join(', ')}`;
      })
      .join('\n\n');

    const enhancedSystemPrompt = `${SYSTEM_PROMPT}

你可以使用以下工具。调用时在回复中插入如下格式的代码块：
\`\`\`tool:工具名
{JSON 参数}
\`\`\`

可用工具：
${toolInstructions}`;

    return [
      { role: 'system', content: enhancedSystemPrompt },
      ...this.state.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
    ];
  }

  /** 调用 AI API（通过 IPC 流式通信，支持中止和超时） */
  private async callAi(
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
  ): Promise<{ content: string; toolCalls?: AgentToolCall[] }> {
    // 构建 prompt 从 messages
    const prompt = messages
      .map(
        (m) =>
          `${m.role === 'system' ? '[系统]' : m.role === 'user' ? '[用户]' : m.role === 'assistant' ? '[助手]' : '[工具]'} ${m.content}`,
      )
      .join('\n\n');

    let fullContent = '';
    const TIMEOUT_MS = 120_000; // 2 分钟超时

    // 调用流式聊天 IPC
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timeout = setTimeout(() => {
        // 超时时用已收到的内容 resolve，避免 Promise 永远挂起
        const parsedToolCalls = this.parseToolCallsFromContent(fullContent);
        resolve({ content: fullContent || '（AI 响应超时）', toolCalls: parsedToolCalls });
      }, TIMEOUT_MS);

      ipcClient.chatStream(prompt, (delta: string, done: boolean) => {
        if (signal.aborted) {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        fullContent += delta;
        // 实时更新
        this.notify();
        if (done) {
          clearTimeout(timeout);
          // 尝试从内容中解析 tool_calls
          const parsedToolCalls = this.parseToolCallsFromContent(fullContent);
          resolve({ content: fullContent, toolCalls: parsedToolCalls });
        }
      });

      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }

  /** 从 AI 回复中解析工具调用（AI 可能在文本中嵌入 JSON 工具调用） */
  private parseToolCallsFromContent(content: string): AgentToolCall[] {
    const toolCalls: AgentToolCall[] = [];
    // 匹配 ```tool:tool_name\n{...}\n``` 格式
    const regex = /```tool:(\w+)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const argsStr = match[2].trim();
      try {
        const args = JSON.parse(argsStr);
        toolCalls.push({
          id: `tc_${Date.now()}_${toolCalls.length}`,
          name,
          arguments: args,
        });
      } catch {
        // 解析失败，忽略
      }
    }
    return toolCalls;
  }

  /** 等待用户审批（Promise 回调模式，避免轮询） */
  private waitForApproval(): Promise<boolean> {
    return new Promise((resolve) => {
      this.approvalResolver = resolve;
    });
  }
}

/** 全局单例 */
export const agentRuntime = new AgentRuntime();
