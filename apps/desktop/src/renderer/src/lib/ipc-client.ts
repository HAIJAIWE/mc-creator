import type {
  GenerateSpecRes,
  GenerateFilesRes,
  BuildRes,
  BuildWithFixRes,
  ExportZipRes,
  SaveFileRes,
  SaveAllFilesRes,
  PrepareBuildDirRes,
  ExportProjectRes,
  ImportProjectRes,
  GeneratorType,
  Project,
  BuildStreamChunkT,
  BuildCheckJavaRes,
  ModrinthSearchRes,
  ModrinthVersionsRes,
  CurseForgeSearchRes,
  CurseForgeFilesRes,
  CurseForgeConfig,
  GitChooseRepoRes,
  GitStatusRes,
  GitLogRes,
  GitCommitRes,
  GitSyncRes,
  GitBranchListRes,
  GitBranchCreateRes,
  GitBranchSwitchRes,
  GitDiffRes,
  LocateMcRes,
  McChooseDirRes,
  InstallModRes,
  LaunchMcRes,
  ImportResourceFilesRes,
} from '../../../shared/ipc-channels.js';

/**
 * 预览模式下的简单规则式 Spec 生成：根据描述关键词 + 生成器类型返回模板 spec。
 * 覆盖常见关键词：剑/工具/矿石/食物/附魔/实体/维度/生物群系/服务器/启动器/皮肤/资源包/整合包/KubeJS/CraftTweaker/行为包。
 */
function buildPreviewSpec(description: string, type: GeneratorType): Record<string, unknown> {
  const desc = description.toLowerCase();
  const base = { description };

  // 常见中文材料名 -> 英文 ID 映射（用于生成 ASCII modId/packId）
  const materialMap: Record<string, string> = {
    红宝石: 'ruby',
    蓝宝石: 'sapphire',
    绿宝石: 'emerald',
    钻石: 'diamond',
    金: 'gold',
    铁: 'iron',
    铜: 'copper',
    银: 'silver',
    青金石: 'lapis',
    红石: 'redstone',
    煤: 'coal',
    木: 'wood',
    石: 'stone',
    沙: 'sand',
    土: 'dirt',
    草: 'grass',
    树: 'log',
    叶: 'leaves',
    花: 'flower',
    药水: 'potion',
    附魔: 'enchantment',
    实体: 'entity',
    生物: 'mob',
    怪物: 'monster',
    维度: 'dimension',
    群系: 'biome',
    结构: 'structure',
    配方: 'recipe',
    函数: 'function',
    标签: 'tag',
    进度: 'advancement',
    战利品: 'loot',
  };

  // 通用 ID/名称提取：按已知关键词分割，取关键词前的词作为素材名
  const keywords = [
    '剑',
    '工具',
    '矿石',
    '物品',
    '方块',
    '食物',
    '附魔',
    '实体',
    '生物',
    '维度',
    '群系',
    '服务器',
    '启动器',
    '皮肤',
    '资源包',
    '整合包',
    '行为包',
  ];
  let materialName = 'demo';
  let materialId = 'demo';
  for (const kw of keywords) {
    const idx = desc.indexOf(kw);
    if (idx > 0) {
      materialName = desc.slice(0, idx).replace(/[的\s]+$/, '');
      // 尝试映射中文名到英文 ID
      for (const [cn, en] of Object.entries(materialMap)) {
        if (materialName.includes(cn)) {
          materialId = en;
          break;
        }
      }
      if (materialId === 'demo') {
        materialId = materialName.replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'demo';
      }
      break;
    }
  }
  // 没命中关键词，取首个中文/英文词
  if (materialName === 'demo') {
    const m = desc.match(/([\u4e00-\u9fa5a-zA-Z]+)/);
    materialName = m?.[1] ?? 'demo';
    for (const [cn, en] of Object.entries(materialMap)) {
      if (materialName.includes(cn)) {
        materialId = en;
        break;
      }
    }
    if (materialId === 'demo') {
      materialId = materialName.replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'demo';
    }
  }
  const packName = materialName.charAt(0).toUpperCase() + materialName.slice(1);

  switch (type) {
    case 'mod':
      return {
        modId: materialId,
        name: packName,
        version: '1.0.0',
        ...base,
        items:
          desc.includes('剑') || desc.includes('工具')
            ? [
                {
                  id: `${materialId}_sword`,
                  name: `${packName} Sword`,
                  maxDamage: 250,
                  rarity: 'rare',
                },
              ]
            : [{ id: materialId, name: packName, maxStackSize: 64 }],
        blocks:
          desc.includes('矿石') || desc.includes('方块')
            ? [{ id: `${materialId}_ore`, name: `${packName} Ore`, hardness: 3, miningLevel: 2 }]
            : [],
      };
    case 'datapack':
      return {
        packId: materialId,
        packName: packName,
        packFormat: 48,
        ...base,
        recipes: desc.includes('配方')
          ? [{ id: 'test', type: 'crafting_shaped', result: `minecraft:${materialId}` }]
          : [],
        functions: desc.includes('函数') ? [{ id: 'test', commands: ['say hello'] }] : [],
      };
    case 'modpack':
      return {
        packId: materialId,
        packName: packName,
        packVersion: '1.0.0',
        author: 'preview',
        format: 'modrinth',
        mcVersion: '1.21.11',
        loader: 'fabric',
        ...base,
      };
    case 'server':
      return { serverName: packName, ...base };
    case 'resource_pack':
      return { packName: packName, packDescription: description, packFormat: 34, ...base };
    case 'skin':
      return { playerName: packName, model: 'classic', ...base };
    case 'launcher':
      return { launcherName: packName, launcherType: 'hmcl', mcVersion: '1.21.11', ...base };
    case 'kubejs':
      return { packId: materialId, packName: packName, mcVersion: '1.21.11', ...base };
    case 'crafttweaker':
      return { packId: materialId, packName: packName, ...base };
    case 'behavior_pack':
      return { packId: materialId, packName: packName, packFormat: 2, ...base };
    case 'behavior_item':
      return {
        packId: materialId,
        packName: packName,
        items: [{ id: materialId, name: packName }],
        ...base,
      };
    case 'behavior_entity':
      return {
        packId: materialId,
        packName: packName,
        entities: [{ id: materialId, name: packName, hostile: !desc.includes('友好') }],
        ...base,
      };
    case 'enchantment':
      return {
        packId: materialId,
        packName: packName,
        enchantments: [
          {
            id: materialId,
            name: packName,
            maxLevel: 3,
            supportedItems: '#minecraft:enchantable/sword',
          },
        ],
        ...base,
      };
    default:
      return { packId: materialId, packName: packName, ...base };
  }
}
function isWebPreview(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as unknown as { __MC_PREVIEW__?: boolean }).__MC_PREVIEW__ === true
  );
}

/** 封装 window.mcApi，提供类型安全调用 */
export const ipcClient = {
  generateSpec: async (
    description: string,
    generatorType: GeneratorType,
  ): Promise<GenerateSpecRes> => {
    if (isWebPreview()) {
      // 预览模式：用关键词匹配预置模板（无需模型 API）
      const { SPEC_CONFIGS } = await import('@mc-creator/core/browser.js');
      const schema = SPEC_CONFIGS[generatorType]?.schema;
      if (!schema) {
        return { ok: false, error: `未知生成器类型: ${generatorType}` };
      }

      const spec = buildPreviewSpec(description, generatorType);
      const check = schema.safeParse(spec);
      if (!check.success) {
        return {
          ok: false,
          error: `生成的 Spec 校验失败: ${check.error.issues.map((i) => i.message).join('; ')}`,
        };
      }
      return {
        ok: true,
        spec: check.data as GenerateSpecRes['spec'],
        raw: JSON.stringify(check.data, null, 2),
      };
    }
    return window.mcApi.generateSpec(description, generatorType);
  },
  generateFiles: async (req: {
    loader: string;
    mcVersion: string;
    spec: unknown;
    generatorType: GeneratorType;
  }): Promise<GenerateFilesRes> => {
    if (isWebPreview()) {
      // 预览模式：渲染进程内直接跑 core 生成器（与主进程 GENERATE_FILES 逻辑一致）
      // 通过浏览器安全入口导入，避免把 Node-only 的 builder 模块拖进浏览器 bundle
      const { createDefaultRegistry, SPEC_CONFIGS, formatSpecIssues } =
        await import('@mc-creator/core/browser.js');
      const gen = createDefaultRegistry().get(req.generatorType);
      if (!gen) {
        return { files: [], warnings: [`不支持的生成器类型：${req.generatorType}`] };
      }
      const schema = SPEC_CONFIGS[req.generatorType]?.schema;
      if (schema) {
        const check = schema.safeParse(req.spec);
        if (!check.success) {
          throw new Error(`${req.generatorType} Spec 校验失败：${formatSpecIssues(check.error)}`);
        }
        req = { ...req, spec: check.data };
      }
      const result = await gen.generate({
        loader: req.loader,
        mcVersion: req.mcVersion,
        modId:
          (req.spec as { modId?: string }).modId ||
          (req.spec as { packId?: string }).packId ||
          'mc_creator',
        spec: req.spec as never,
        projectPath: '',
      } as never);
      return {
        files: result.files,
        warnings: result.warnings,
        unimplemented: result.unimplemented ?? [],
      };
    }
    return window.mcApi.generateFiles(req);
  },
  build: (projectPath: string): Promise<BuildRes> => window.mcApi.build(projectPath),
  loadModelConfig: () => window.mcApi.loadModelConfig(),
  saveModelConfig: (config: { name: string; modelId: string; baseURL: string; apiKey: string }) =>
    window.mcApi.saveModelConfig(config),
  listModelProfiles: <T = unknown>() => window.mcApi.listModelProfiles<T>(),
  saveModelProfiles: (req: {
    profiles: { id: string; name: string; modelId: string; baseURL: string; apiKey: string }[];
    activeId: string;
  }) => window.mcApi.saveModelProfiles(req),
  testModelConnection: (req: { baseURL: string; modelId: string; apiKey: string }) =>
    window.mcApi.testModelConnection(req),
  chat: (message: string) => window.mcApi.chat(message),
  /**
   * P12 chat 模式工具调用增强：chatStream 添加可选 context 参数。
   * context 由调用方（如 ChatPanel）从项目 store 提取并传入，
   * main 进程会据此构建增强 system message。
   */
  chatStream: (
    message: string,
    onChunk: (delta: string, done: boolean) => void,
    context?: { generatorType?: string; description?: string; specSummary?: string },
  ) => window.mcApi.chatStream(message, onChunk, context),
  explainCode: (
    fileName: string,
    code: string,
    generatorType: string | undefined,
    onChunk: (delta: string, done: boolean) => void,
  ) => window.mcApi.explainCode(fileName, code, generatorType, onChunk),
  compareModels: (
    req: {
      description: string;
      generatorType: string;
      models: { name: string; modelId: string; baseURL: string; apiKey: string }[];
    },
    onChunk: (data: { modelName: string; delta: string; done: boolean }) => void,
  ) => window.mcApi.compareModels(req, onChunk),
  fixSuggest: (
    buildLog: string,
    files: { path: string; content: string }[],
    onChunk: (delta: string, done: boolean) => void,
  ) => window.mcApi.fixSuggest(buildLog, files, onChunk),
  buildWithFix: (projectPath: string): Promise<BuildWithFixRes> =>
    window.mcApi.buildWithFix(projectPath),
  // Phase 3.2：取消构建 + JDK 预检
  abortBuild: (): Promise<{ ok: boolean; killed: number }> => window.mcApi.abortBuild(),
  checkJava: (mcVersion?: string): Promise<BuildCheckJavaRes> => window.mcApi.checkJava(mcVersion),
  buildStream: (projectPath: string, onChunk: (chunk: BuildStreamChunkT) => void) =>
    window.mcApi.buildStream(projectPath, onChunk),
  exportZip: (req: {
    files: { path: string; content: string }[];
    defaultName: string;
  }): Promise<ExportZipRes> => window.mcApi.exportZip(req),
  saveFile: (req: { path: string; content: string; defaultName?: string }): Promise<SaveFileRes> =>
    window.mcApi.saveFile(req),
  saveAllFiles: (req: { files: { path: string; content: string }[] }): Promise<SaveAllFilesRes> =>
    window.mcApi.saveAllFiles(req),
  prepareBuildDir: (files: { path: string; content: string }[]): Promise<PrepareBuildDirRes> =>
    window.mcApi.prepareBuildDir(files),
  listProjects: (): Promise<Project[]> => window.mcApi.listProjects(),
  getProject: (id: string): Promise<Project | null> => window.mcApi.getProject(id),
  saveProject: (project: Project): Promise<{ ok: true }> => window.mcApi.saveProject(project),
  deleteProject: (id: string): Promise<{ ok: true }> => window.mcApi.deleteProject(id),
  exportProject: (project: Project): Promise<ExportProjectRes> =>
    window.mcApi.exportProject(project),
  importProject: (): Promise<ImportProjectRes> => window.mcApi.importProject(),
  exportSpec: (req: { spec: unknown; generatorType: string; description?: string }) =>
    window.mcApi.exportSpec(req),
  importSpec: () => window.mcApi.importSpec(),
  launcherListVersions: () => window.mcApi.launcherListVersions(),
  launcherDownload: (req: { version: string }) => window.mcApi.launcherDownload(req),
  launcherLaunch: (req: { version: string; username: string; memory: string; gameDir?: string }) =>
    window.mcApi.launcherLaunch(req),
  launcherInstallLoader: (req: { version: string; loader: 'fabric' | 'neoforge' }) =>
    window.mcApi.launcherInstallLoader(req),
  launcherListMods: (version: string) => window.mcApi.launcherListMods(version),
  launcherInstallMod: (req: { version: string; name: string; url: string }) =>
    window.mcApi.launcherInstallMod(req),
  launcherRemoveMod: (req: { version: string; name: string }) =>
    window.mcApi.launcherRemoveMod(req),
  launcherInstallSkin: (req: { version: string; skinApiUrl?: string }) =>
    window.mcApi.launcherInstallSkin(req),
  modrinthSearch: (req: {
    query: string;
    loader?: string;
    mcVersion?: string;
    limit?: number;
  }): Promise<ModrinthSearchRes> => window.mcApi.modrinthSearch(req),
  modrinthVersions: (req: {
    projectId: string;
    loader?: string;
    mcVersion?: string;
  }): Promise<ModrinthVersionsRes> => window.mcApi.modrinthVersions(req),
  curseforgeSearch: (req: {
    query: string;
    loader?: string;
    mcVersion?: string;
    limit?: number;
  }): Promise<CurseForgeSearchRes> => window.mcApi.curseforgeSearch(req),
  curseforgeFiles: (req: {
    modId: number;
    loader?: string;
    mcVersion?: string;
  }): Promise<CurseForgeFilesRes> => window.mcApi.curseforgeFiles(req),
  loadCurseForgeConfig: (): Promise<CurseForgeConfig> => window.mcApi.loadCurseForgeConfig(),
  saveCurseForgeConfig: (config: CurseForgeConfig): Promise<{ ok: true }> =>
    window.mcApi.saveCurseForgeConfig(config),
  // 源代码管理
  gitChooseRepo: (): Promise<GitChooseRepoRes> => window.mcApi.gitChooseRepo(),
  gitStatus: (repoPath: string): Promise<GitStatusRes> => window.mcApi.gitStatus(repoPath),
  gitLog: (repoPath: string, limit: number): Promise<GitLogRes> =>
    window.mcApi.gitLog(repoPath, limit),
  gitCommit: (repoPath: string, message: string, all: boolean): Promise<GitCommitRes> =>
    window.mcApi.gitCommit(repoPath, message, all),
  gitPull: (repoPath: string): Promise<GitSyncRes> => window.mcApi.gitPull(repoPath),
  gitPush: (repoPath: string): Promise<GitSyncRes> => window.mcApi.gitPush(repoPath),
  // Git 增强
  gitBranchList: (repoPath: string): Promise<GitBranchListRes> =>
    window.mcApi.gitBranchList(repoPath),
  gitBranchCreate: (repoPath: string, name: string): Promise<GitBranchCreateRes> =>
    window.mcApi.gitBranchCreate(repoPath, name),
  gitBranchSwitch: (repoPath: string, name: string): Promise<GitBranchSwitchRes> =>
    window.mcApi.gitBranchSwitch(repoPath, name),
  gitAdd: (repoPath: string, paths: string[]): Promise<{ ok: boolean; error?: string }> =>
    window.mcApi.gitAdd(repoPath, paths),
  gitReset: (repoPath: string, paths: string[]): Promise<{ ok: boolean; error?: string }> =>
    window.mcApi.gitReset(repoPath, paths),
  gitDiff: (repoPath: string, path: string, staged?: boolean): Promise<GitDiffRes> =>
    window.mcApi.gitDiff(repoPath, path, staged),
  // Minecraft 启动器（离线）
  locateMc: (): Promise<LocateMcRes> => window.mcApi.locateMc(),
  chooseMcDir: (): Promise<McChooseDirRes> => window.mcApi.chooseMcDir(),
  installMod: (jarPath: string, mcDir?: string): Promise<InstallModRes> =>
    window.mcApi.installMod(jarPath, mcDir),
  launchMc: (mcDir?: string): Promise<LaunchMcRes> => window.mcApi.launchMc(mcDir),
  // 终端（PTY 桥接）
  terminalSpawn: (req: {
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): Promise<{ pid: number }> => window.mcApi.terminalSpawn(req),
  terminalWrite: (pid: number, data: string): Promise<void> =>
    window.mcApi.terminalWrite(pid, data),
  terminalResize: (pid: number, cols: number, rows: number): Promise<void> =>
    window.mcApi.terminalResize(pid, cols, rows),
  terminalKill: (pid: number): Promise<void> => window.mcApi.terminalKill(pid),
  // 资源文件导入
  importResourceFiles: (req?: {
    title?: string;
    extensions?: string[];
    multiSelect?: boolean;
  }): Promise<ImportResourceFilesRes> => window.mcApi.importResourceFiles(req ?? {}),
};
