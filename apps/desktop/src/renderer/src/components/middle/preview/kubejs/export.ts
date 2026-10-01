import { countLangEntries, toMdTable, toMdOverview } from '../../shared/index.js';
import type { ExportHandler } from '../../shared/index.js';
import type { KubejsSpec } from '@mc-creator/shared';
import { RECIPE_TYPE_LABEL, TAG_TYPE_LABEL, REGISTRY_TYPE_LABEL } from './constants.js';

/** KubeJS 预览面板的导出配置（json / csv / markdown） */
export const KJ_EXPORT: ExportHandler<KubejsSpec> = {
  prefix: (kj) => kj.packId,
  scopes: {
    all: {
      data: (kj) => kj,
      toMd: (kj) =>
        toMdOverview(
          `# ${kj.packName || kj.packId}`,
          [
            `- **Pack ID**: ${kj.packId}`,
            `- **Format**: ${kj.packFormat}`,
            `- **MC 版本**: ${kj.mcVersion}`,
            `- **描述**: ${kj.description || '—'}`,
          ],
          [
            {
              heading: '配方列表',
              lines: kj.recipes.map(
                (r) =>
                  `- \`${r.id}\` — ${RECIPE_TYPE_LABEL[r.type] ?? r.type} → ${r.result} x${r.count}`,
              ),
            },
            {
              heading: '标签列表',
              lines: kj.tags.map(
                (t) =>
                  `- \`${t.id}\` — ${TAG_TYPE_LABEL[t.type] ?? t.type} (${t.values.length} 条目)`,
              ),
            },
            {
              heading: '事件列表',
              lines: kj.events.map((e) => `- \`${e.id}\` — ${e.type} (${e.target || '—'})`),
            },
            {
              heading: '注册表',
              lines: kj.registry.map(
                (r) =>
                  `- \`${r.id}\` — ${REGISTRY_TYPE_LABEL[r.type] ?? r.type} (${r.items.length + r.blocks.length} 条目)`,
              ),
            },
            {
              heading: '工具提示',
              lines: kj.tooltips.map(
                (t) => `- \`${t.itemId}\` — ${t.lines.length} 行${t.advanced ? ' (高级)' : ''}`,
              ),
            },
          ],
        ),
    },
    recipes: {
      data: (kj) => kj.recipes,
      toCsv: (kj) =>
        [
          'ID,Type,Result,Count',
          ...kj.recipes.map((r) => `"${r.id}","${r.type}","${r.result}",${r.count}`),
        ].join('\n'),
      toMd: (kj) =>
        toMdTable(
          `# ${kj.packName || kj.packId} - 配方列表`,
          `共 ${kj.recipes.length} 个配方`,
          ['ID', '类型', '产物', '数量'],
          kj.recipes.map((r) => [
            `\`${r.id}\``,
            RECIPE_TYPE_LABEL[r.type] ?? r.type,
            r.result,
            String(r.count),
          ]),
        ),
    },
    tags: {
      data: (kj) => kj.tags,
      toCsv: (kj) =>
        [
          'ID,Type,Values,Replace',
          ...kj.tags.map(
            (t) => `"${t.id}","${t.type}","${t.values.join(';')}",${t.replace ? 'Yes' : 'No'}`,
          ),
        ].join('\n'),
      toMd: (kj) =>
        toMdTable(
          `# ${kj.packName || kj.packId} - 标签列表`,
          `共 ${kj.tags.length} 个标签`,
          ['ID', '类型', '条目数', '替换'],
          kj.tags.map((t) => [
            `\`${t.id}\``,
            TAG_TYPE_LABEL[t.type] ?? t.type,
            String(t.values.length),
            t.replace ? '是' : '否',
          ]),
        ),
    },
    events: {
      data: (kj) => kj.events,
      toCsv: (kj) =>
        ['ID,Type,Target', ...kj.events.map((e) => `"${e.id}","${e.type}","${e.target}"`)].join(
          '\n',
        ),
      toMd: (kj) =>
        toMdTable(
          `# ${kj.packName || kj.packId} - 事件列表`,
          `共 ${kj.events.length} 个事件`,
          ['ID', '类型', '目标'],
          kj.events.map((e) => [`\`${e.id}\``, e.type, e.target || '—']),
        ),
    },
    tooltips: {
      data: (kj) => kj.tooltips,
      toCsv: (kj) =>
        [
          'ItemID,Lines,Advanced',
          ...kj.tooltips.map((t) => `"${t.itemId}",${t.lines.length},${t.advanced ? 'Yes' : 'No'}`),
        ].join('\n'),
      toMd: (kj) =>
        toMdTable(
          `# ${kj.packName || kj.packId} - 工具提示`,
          `共 ${kj.tooltips.length} 个工具提示`,
          ['物品 ID', '行数', '高级'],
          kj.tooltips.map((t) => [
            `\`${t.itemId}\``,
            String(t.lines.length),
            t.advanced ? '是' : '否',
          ]),
        ),
    },
    registry: {
      data: (kj) => kj.registry,
      toCsv: (kj) =>
        [
          'ID,Type,Items,Blocks',
          ...kj.registry.map((r) => `"${r.id}","${r.type}",${r.items.length},${r.blocks.length}`),
        ].join('\n'),
      toMd: (kj) =>
        toMdTable(
          `# ${kj.packName || kj.packId} - 注册表`,
          `共 ${kj.registry.length} 个注册表条目`,
          ['ID', '类型', '物品数', '方块数'],
          kj.registry.map((r) => [
            `\`${r.id}\``,
            REGISTRY_TYPE_LABEL[r.type] ?? r.type,
            String(r.items.length),
            String(r.blocks.length),
          ]),
        ),
    },
    lang: {
      data: (kj) => kj.lang,
      toCsv: (kj) =>
        [
          'Lang,Key,Value',
          ...Object.entries(kj.lang ?? {}).flatMap(([langCode, dict]) =>
            Object.entries(dict).map(([k, v]) => `"${langCode}","${k}","${v.replace(/"/g, '""')}"`),
          ),
        ].join('\n'),
      toMd: (kj) => {
        const { entries: langEntries, languages: langCount } = countLangEntries(kj.lang);
        return toMdTable(
          `# ${kj.packName || kj.packId} - 语言条目`,
          `共 ${langEntries} 条翻译，覆盖 ${langCount} 种语言`,
          ['语言', '键', '值'],
          Object.entries(kj.lang ?? {}).flatMap(([langCode, dict]) =>
            Object.entries(dict).map(([k, v]) => [langCode, `\`${k}\``, v]),
          ),
        );
      },
    },
  },
};
