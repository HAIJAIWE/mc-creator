/**
 * StatusBar —— 底部状态栏（IDE 标准层，§1.8 列为此前缺失）
 *
 * ## 为什么在底部而不是顶部
 *
 * 查证 VS Code 与 IntelliJ 的官方文档后得到的结论：
 *
 * | IDE     | 项目上下文（当前文件/编码/缩进/行列）放哪 |
 * | ------- | ------------------------------------------ |
 * | VS Code | **Status Bar（底部）**                     |
 * | IntelliJ | **底部 status bar**                        |
 *
 * 而「内容类型 / 加载器 / MC 版本」这三个值正是同一类东西：当前项目的构建上下文。
 * 它们原本挂在 `TopToolbar` 中间（顶部黄金位置），与 IDE 惯例不符 ——
 * VS Code 官方列出的六个区域里根本没有「工具栏」，标题栏只有
 * **菜单 + Command Center + 布局控制**，不含项目配置下拉框。
 *
 * 现在它们以**只读文本**呈现在这里，点击进设置面板编辑。
 *
 * ## 为什么是只读 + 跳转，而不是直接放三个下拉框
 *
 * - 可编辑的版本在 `SettingsPanel` 的「项目」分组里（唯一编辑入口）
 * - 状态栏塞三个表单控件会很拥挤，且违背「状态栏显示状态、设置面板做编辑」的分工
 * - VS Code 状态栏的语言/缩进项也是「点击 → 打开相关设置」，同一个模式
 */
import { McIcon } from '../assets/mc-ui/McIcon.js';
import { useModStore } from '../store/mod-store.js';
import { useProjectStore } from '../store/project-store.js';
import { useWorkbenchStore, selectSelectPanel } from '../shell/workbench-store.js';
import { GENERATOR_DESCRIPTORS, loaderLabel } from '../../../shared/generator-descriptors.js';
import { useTranslation } from '../hooks/useTranslation.js';

export function StatusBar() {
  const { t, locale } = useTranslation();
  const selectPanel = useWorkbenchStore(selectSelectPanel);

  const generatorType = useModStore((s) => s.generatorType);
  const loader = useModStore((s) => s.loader);
  const mcVersion = useModStore((s) => s.mcVersion);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projects = useProjectStore((s) => s.projects);

  const projectName =
    projects.find((p) => p.id === currentProjectId)?.name ?? t('statusBar.noProject');

  // 只有 mod 类内容才需要 loader（与 TopToolbar 原有的 needsLoader 判定同源）
  const needsLoader = GENERATOR_DESCRIPTORS[generatorType]?.needsLoader ?? false;

  const openProjectSettings = () => selectPanel('settings');

  const itemClass =
    'flex h-full cursor-pointer items-center gap-1 px-2 text-[11px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text';

  return (
    <div
      className="flex h-6 shrink-0 items-stretch justify-between border-t border-mc-border bg-mc-surface px-1"
      role="status"
      aria-label={t('statusBar.label')}
    >
      {/* 左侧：项目身份 + 构建上下文（点击进设置） */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={openProjectSettings}
          className={itemClass}
          title={t('statusBar.openProjectSettings')}
        >
          <McIcon scope="pixel" name="folder" size={11} />
          <span className="max-w-40 truncate">{projectName}</span>
        </button>

        <span className="mx-1 self-center border-l border-mc-border" aria-hidden="true" />

        <button
          type="button"
          onClick={openProjectSettings}
          className={itemClass}
          title={t('statusBar.openProjectSettings')}
        >
          {pickLocalized(GENERATOR_DESCRIPTORS[generatorType]?.label, locale)}
        </button>

        {needsLoader && (
          <button
            type="button"
            onClick={openProjectSettings}
            className={itemClass}
            title={t('statusBar.openProjectSettings')}
          >
            {loaderLabel(loader)}
          </button>
        )}

        <button
          type="button"
          onClick={openProjectSettings}
          className={itemClass}
          title={t('statusBar.openProjectSettings')}
        >
          {mcVersion}
        </button>
      </div>

      {/* 右侧：域上下文（三域并列，§0.2） */}
      <div className="flex items-stretch">
        <span className={`${itemClass} cursor-default`}>{t('statusBar.agentHint')}</span>
      </div>
    </div>
  );
}

/** 取双语标签中匹配当前 locale 的那个（generator-descriptors 的 label 是 {zh, en} 结构） */
function pickLocalized(label: { zh?: string; en?: string } | undefined, locale: string): string {
  if (!label) return '';
  return locale.startsWith('en') ? (label.en ?? label.zh ?? '') : (label.zh ?? label.en ?? '');
}
