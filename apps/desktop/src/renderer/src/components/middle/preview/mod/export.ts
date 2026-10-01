import { toMdTable, toMdOverview } from '../../shared/index.js';
import type { ExportHandler } from '../../shared/index.js';
import type { ModSpec } from '@mc-creator/shared';
import { RARITY_LABEL } from './constants.js';

/** Mod 预览面板的导出配置（json / csv / markdown） */
export const MOD_EXPORT: ExportHandler<ModSpec> = {
  prefix: (m) => m.modId,
  scopes: {
    all: {
      data: (m) => m,
      toMd: (m) =>
        toMdOverview(
          `# ${m.name || m.modId}`,
          [
            `- **Mod ID**: ${m.modId}`,
            `- **版本**: ${m.version}`,
            `- **License**: ${m.license}`,
            `- **作者**: ${m.authors.join(', ') || '—'}`,
            `- **描述**: ${m.description || '—'}`,
          ],
          [
            {
              heading: '物品列表',
              lines: m.items.map(
                (i) =>
                  `- **${i.name}** (\`${i.id}\`) — 稀有度 ${RARITY_LABEL[i.rarity]} · 堆叠 ${i.maxStackSize}`,
              ),
            },
            {
              heading: '方块列表',
              lines: m.blocks.map(
                (b) => `- **${b.name}** (\`${b.id}\`) — 材质 ${b.material} · 硬度 ${b.hardness}`,
              ),
            },
            {
              heading: '依赖',
              lines: m.dependencies.map(
                (d) => `- \`${d.modId}\` ${d.version} ${d.mandatory ? '(必需)' : '(可选)'}`,
              ),
            },
          ],
        ),
    },
    items: {
      data: (m) => m.items,
      toCsv: (m) =>
        [
          'ID,Name,Rarity,MaxStackSize,MaxDamage,FuelTick,Category,CreativeTab,Food',
          ...m.items.map(
            (i) =>
              `"${i.id}","${i.name}","${i.rarity}",${i.maxStackSize},${i.maxDamage},${i.fuelTick},"${i.itemCategory}","${i.creativeTab}",${i.food ? 'Yes' : 'No'}`,
          ),
        ].join('\n'),
      toMd: (m) =>
        toMdTable(
          `# ${m.name || m.modId} - 物品列表`,
          `共 ${m.items.length} 个物品`,
          ['ID', '名称', '稀有度', '堆叠'],
          m.items.map((i) => [
            `\`${i.id}\``,
            i.name,
            RARITY_LABEL[i.rarity],
            String(i.maxStackSize),
          ]),
        ),
    },
    blocks: {
      data: (m) => m.blocks,
      toCsv: (m) =>
        [
          'ID,Name,Material,Hardness,Resistance,LightLevel,BlockType,Transparent',
          ...m.blocks.map(
            (b) =>
              `"${b.id}","${b.name}","${b.material}",${b.hardness},${b.resistance},${b.lightLevel},"${b.blockType}",${b.transparent ? 'Yes' : 'No'}`,
          ),
        ].join('\n'),
      toMd: (m) =>
        toMdTable(
          `# ${m.name || m.modId} - 方块列表`,
          `共 ${m.blocks.length} 个方块`,
          ['ID', '名称', '材质', '硬度'],
          m.blocks.map((b) => [`\`${b.id}\``, b.name, b.material, String(b.hardness)]),
        ),
    },
    deps: {
      data: (m) => m.dependencies,
      toCsv: (m) =>
        [
          'ModID,Version,Mandatory',
          ...m.dependencies.map((d) => `"${d.modId}","${d.version}",${d.mandatory ? 'Yes' : 'No'}`),
        ].join('\n'),
      toMd: (m) =>
        toMdTable(
          `# ${m.name || m.modId} - 依赖列表`,
          `共 ${m.dependencies.length} 个依赖`,
          ['Mod ID', '版本', '必需'],
          m.dependencies.map((d) => [`\`${d.modId}\``, d.version, d.mandatory ? '是' : '否']),
        ),
    },
  },
};
