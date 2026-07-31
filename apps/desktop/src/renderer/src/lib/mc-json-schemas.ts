/**
 * Minecraft JSON Schema 注册：
 * 为 Monaco 编辑器的 JSON 语言服务提供 Schema 补全和验证。
 * 覆盖 Minecraft 常见的 JSON 文件：pack.mcmeta、block model、item model、recipe、loot table 等。
 */

import type { OnMount } from '@monaco-editor/react';

/**
 * Minecraft JSON Schema 定义（内联，避免外部依赖）。
 * key = 文件路径 glob 匹配模式，value = JSON Schema URI 或内联 schema。
 */
const MC_SCHEMAS: Array<{
  /** 文件路径匹配模式（endsWith 匹配） */
  filePattern: string;
  /** Schema 名称（用于 UI 显示） */
  name: string;
  /** 内联 JSON Schema */
  schema: Record<string, unknown>;
}> = [
  {
    filePattern: 'pack.mcmeta',
    name: 'Pack Metadata',
    schema: {
      type: 'object',
      properties: {
        pack: {
          type: 'object',
          properties: {
            pack_format: { type: 'integer', description: '资源包/数据包格式版本' },
            description: {
              oneOf: [
                { type: 'string', description: '包描述文本' },
                {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    translate: { type: 'string' },
                    fallback: { type: 'string' },
                    color: { type: 'string' },
                    extra: { type: 'array' },
                  },
                },
              ],
            },
          },
          required: ['pack_format', 'description'],
        },
      },
      required: ['pack'],
    },
  },
  {
    filePattern: '/models/',
    name: 'Model JSON',
    schema: {
      type: 'object',
      properties: {
        parent: { type: 'string', description: '父模型路径' },
        textures: {
          type: 'object',
          description: '纹理变量映射',
          additionalProperties: { type: 'string' },
        },
        elements: {
          type: 'array',
          description: '模型元素（立方体）',
          items: {
            type: 'object',
            properties: {
              from: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              to: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              rotation: {
                type: 'object',
                properties: {
                  origin: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                  axis: { type: 'string', enum: ['x', 'y', 'z'] },
                  angle: { type: 'number' },
                  rescale: { type: 'boolean' },
                },
              },
              faces: { type: 'object' },
              shade: { type: 'boolean' },
            },
          },
        },
        display: {
          type: 'object',
          description: '显示变换',
          properties: {
            thirdperson_righthand: { $ref: '#/$defs/display' },
            thirdperson_lefthand: { $ref: '#/$defs/display' },
            firstperson_righthand: { $ref: '#/$defs/display' },
            firstperson_lefthand: { $ref: '#/$defs/display' },
            gui: { $ref: '#/$defs/display' },
            head: { $ref: '#/$defs/display' },
            ground: { $ref: '#/$defs/display' },
            fixed: { $ref: '#/$defs/display' },
          },
        },
        overrides: { type: 'array' },
      },
      $defs: {
        display: {
          type: 'object',
          properties: {
            rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            translation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
          },
        },
      },
    },
  },
  {
    filePattern: '/recipes/',
    name: 'Recipe JSON',
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '配方类型',
          enum: [
            'minecraft:crafting_shaped',
            'minecraft:crafting_shapeless',
            'minecraft:smelting',
            'minecraft:blasting',
            'minecraft:smoking',
            'minecraft:campfire_cooking',
            'minecraft:stonecutting',
            'minecraft:smithing_transform',
            'minecraft:smithing_trim',
          ],
        },
        pattern: {
          type: 'array',
          description: '有序合成模式',
          items: { type: 'string' },
        },
        key: {
          type: 'object',
          description: '模式键映射',
          additionalProperties: {
            type: 'object',
            properties: {
              item: { type: 'string' },
              tag: { type: 'string' },
            },
          },
        },
        ingredients: {
          type: 'array',
          description: '无序合成原料',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: { item: { type: 'string' }, tag: { type: 'string' } },
              },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { item: { type: 'string' }, tag: { type: 'string' } },
                },
              },
            ],
          },
        },
        ingredient: {
          type: 'object',
          description: '单个原料',
          properties: { item: { type: 'string' }, tag: { type: 'string' } },
        },
        result: {
          oneOf: [
            { type: 'string', description: '结果物品 ID' },
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                count: { type: 'integer', minimum: 1 },
              },
            },
          ],
        },
        experience: { type: 'number', minimum: 0, description: '熔炼经验' },
        cookingtime: { type: 'integer', minimum: 0, description: '熔炼时间（tick）' },
        group: { type: 'string', description: '配方组' },
        category: { type: 'string', description: '配方分类' },
      },
      required: ['type'],
    },
  },
  {
    filePattern: '/loot_table/',
    name: 'Loot Table JSON',
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '战利品表类型',
          enum: [
            'minecraft:empty',
            'minecraft:entity',
            'minecraft:block',
            'minecraft:chest',
            'minecraft:fishing',
            'minecraft:gift',
            'minecraft:barter',
            'minecraft:command',
            'minecraft:selector',
            'minecraft:advancement_reward',
            'minecraft:generic',
          ],
        },
        pools: {
          type: 'array',
          description: '战利品池',
          items: { type: 'object' },
        },
        functions: {
          type: 'array',
          description: '战利品函数',
          items: { type: 'object' },
        },
      },
    },
  },
  {
    filePattern: '/advancement/',
    name: 'Advancement JSON',
    schema: {
      type: 'object',
      properties: {
        display: {
          type: 'object',
          properties: {
            icon: {
              type: 'object',
              properties: {
                item: { type: 'string' },
                nbt: { type: 'string' },
              },
            },
            title: { oneOf: [{ type: 'string' }, { type: 'object' }] },
            description: { oneOf: [{ type: 'string' }, { type: 'object' }] },
            frame: { type: 'string', enum: ['task', 'challenge', 'goal'] },
            show_toast: { type: 'boolean' },
            announce_to_chat: { type: 'boolean' },
            hidden: { type: 'boolean' },
            background: { type: 'string' },
          },
        },
        parent: { type: 'string', description: '父进度 ID' },
        criteria: {
          type: 'object',
          description: '达成条件',
          additionalProperties: { type: 'object' },
        },
        requirements: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
        rewards: { type: 'object' },
      },
    },
  },
  {
    filePattern: '/sounds.json',
    name: 'Sounds JSON',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          replace: { type: 'boolean' },
          subtitle: { type: 'string' },
          sounds: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    volume: { type: 'number', minimum: 0 },
                    pitch: { type: 'number', minimum: 0 },
                    weight: { type: 'integer', minimum: 0 },
                    stream: { type: 'boolean' },
                    attenuation_distance: { type: 'integer', minimum: 0 },
                    preload: { type: 'boolean' },
                    type: { type: 'string', enum: ['event', 'sound'] },
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
];

/**
 * 根据文件路径查找匹配的 Schema
 */
function findSchemaForPath(filePath: string): Record<string, unknown> | null {
  for (const { filePattern, schema } of MC_SCHEMAS) {
    if (filePath.endsWith(filePattern) || filePath.includes(filePattern)) {
      return schema;
    }
  }
  return null;
}

/**
 * 在 Monaco onMount 回调中调用：
 * - 为 JSON 文件启用 diagnostics（验证 + 补全）
 * - 根据当前文件路径自动匹配 Minecraft Schema
 * - 累积 schemas 而非覆盖，支持多编辑器场景
 */
export const registerJsonSchemaSupport: OnMount = (editor, monaco) => {
  // 为当前编辑器注册文件特定的 Schema（累积而非覆盖）
  const model = editor.getModel();
  if (model) {
    const uri = model.uri.path;
    const schema = findSchemaForPath(uri);
    // 读取已有 schemas，追加而非覆盖
    const currentOptions = monaco.languages.json.jsonDefaults.diagnosticsOptions;
    const existingSchemas = currentOptions.schemas ?? [];
    const newSchemas = schema
      ? [
          ...existingSchemas.filter((s: { uri: string }) => s.uri !== `mc-schema://${uri}`),
          { uri: `mc-schema://${uri}`, fileMatch: [uri], schema },
        ]
      : existingSchemas;

    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemaValidation: 'error',
      enableSchemaRequest: false,
      schemas: newSchemas,
    });
  }
};
