import { countLangEntries, toMdTable, toMdOverview } from '../../shared/index.js';
import type { ExportHandler } from '../../shared/index.js';
import type { CraftTweakerSpec } from '@mc-creator/shared';
import { RECIPE_TYPE_LABEL, TAG_TYPE_LABEL } from './constants.js';

/** CraftTweaker 预览面板的导出配置（json / csv / markdown） */
export const CT_EXPORT: ExportHandler<CraftTweakerSpec> = {
  prefix: (ct) => ct.packId,
  scopes: {
    all: {
      data: (ct) => ct,
      toMd: (ct) =>
        toMdOverview(
          `# ${ct.packName || ct.packId}`,
          [
            `- **Pack ID**: ${ct.packId}`,
            `- **Format**: ${ct.packFormat}`,
            `- **MC 版本**: ${ct.mcVersion}`,
            `- **描述**: ${ct.description || '—'}`,
          ],
          [
            {
              heading: '配方列表',
              lines: ct.recipes.map(
                (r) =>
                  `- \`${r.id}\` — ${RECIPE_TYPE_LABEL[r.type] ?? r.type} → ${r.result} x${r.count}`,
              ),
            },
            {
              heading: '标签列表',
              lines: ct.tags.map(
                (t) =>
                  `- \`${t.id}\` — ${TAG_TYPE_LABEL[t.type] ?? t.type} (${t.values.length} 条目)`,
              ),
            },
            {
              heading: '事件列表',
              lines: ct.events.map((e) => `- \`${e.id}\` — ${e.type} (${e.target || '—'})`),
            },
            {
              heading: '工具提示',
              lines: ct.tooltips.map(
                (t) => `- \`${t.itemId}\` — ${t.lines.length} 行${t.advanced ? ' (高级)' : ''}`,
              ),
            },
          ],
        ),
    },
    recipes: {
      data: (ct) => ct.recipes,
      toCsv: (ct) =>
        [
          'ID,Type,Result,Count',
          ...ct.recipes.map((r) => `"${r.id}","${r.type}","${r.result}",${r.count}`),
        ].join('\n'),
      toMd: (ct) =>
        toMdTable(
          `# ${ct.packName || ct.packId} - 配方列表`,
          `共 ${ct.recipes.length} 个配方`,
          ['ID', '类型', '产物', '数量'],
          ct.recipes.map((r) => [
            `\`${r.id}\``,
            RECIPE_TYPE_LABEL[r.type] ?? r.type,
            r.result,
            String(r.count),
          ]),
        ),
    },
    tags: {
      data: (ct) => ct.tags,
      toCsv: (ct) =>
        [
          'ID,Type,Values,Replace',
          ...ct.tags.map(
            (t) => `"${t.id}","${t.type}","${t.values.join(';')}",${t.replace ? 'Yes' : 'No'}`,
          ),
        ].join('\n'),
      toMd: (ct) =>
        toMdTable(
          `# ${ct.packName || ct.packId} - 标签列表`,
          `共 ${ct.tags.length} 个标签`,
          ['ID', '类型', '条目数', '替换'],
          ct.tags.map((t) => [
            `\`${t.id}\``,
            TAG_TYPE_LABEL[t.type] ?? t.type,
            String(t.values.length),
            t.replace ? '是' : '否',
          ]),
        ),
    },
    events: {
      data: (ct) => ct.events,
      toCsv: (ct) =>
        ['ID,Type,Target', ...ct.events.map((e) => `"${e.id}","${e.type}","${e.target}"`)].join(
          '\n',
        ),
      toMd: (ct) =>
        toMdTable(
          `# ${ct.packName || ct.packId} - 事件列表`,
          `共 ${ct.events.length} 个事件`,
          ['ID', '类型', '目标'],
          ct.events.map((e) => [`\`${e.id}\``, e.type, e.target || '—']),
        ),
    },
    tooltips: {
      data: (ct) => ct.tooltips,
      toCsv: (ct) =>
        [
          'ItemID,Lines,Advanced',
          ...ct.tooltips.map((t) => `"${t.itemId}",${t.lines.length},${t.advanced ? 'Yes' : 'No'}`),
        ].join('\n'),
      toMd: (ct) =>
        toMdTable(
          `# ${ct.packName || ct.packId} - 工具提示`,
          `共 ${ct.tooltips.length} 个工具提示`,
          ['物品 ID', '行数', '高级'],
          ct.tooltips.map((t) => [
            `\`${t.itemId}\``,
            String(t.lines.length),
            t.advanced ? '是' : '否',
          ]),
        ),
    },
    lang: {
      data: (ct) => ct.lang,
      toCsv: (ct) =>
        [
          'Lang,Key,Value',
          ...Object.entries(ct.lang ?? {}).flatMap(([langCode, dict]) =>
            Object.entries(dict).map(([k, v]) => `"${langCode}","${k}","${v.replace(/"/g, '""')}"`),
          ),
        ].join('\n'),
      toMd: (ct) => {
        const { entries: langEntries, languages: langCount } = countLangEntries(ct.lang);
        return toMdTable(
          `# ${ct.packName || ct.packId} - 语言条目`,
          `共 ${langEntries} 条翻译，覆盖 ${langCount} 种语言`,
          ['语言', '键', '值'],
          Object.entries(ct.lang ?? {}).flatMap(([langCode, dict]) =>
            Object.entries(dict).map(([k, v]) => [langCode, `\`${k}\``, v]),
          ),
        );
      },
    },
  },
};
