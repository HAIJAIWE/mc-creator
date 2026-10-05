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
  ModpackResolveRes,
  ModpackCheckConflictsRes,
  ModpackExportMrpackRes,
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
  LargeFileMetaT,
  RagSearchRes,
  KernelListKindsRes,
  KernelReadReq,
  KernelTaskResultT,
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
  }
  // 穷尽性检查：13 种 GeneratorType 已在上方 switch 全覆盖，
  // 新增类型时此处编译失败（避免预览模板静默漏掉新类型）。
  const _exhaustive: never = type;
  return _exhaustive;
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
    /** 当前项目 id（可选）：主进程据此隔离并持久化增量构建缓存 */
    projectId?: string;
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
        // 与主进程 GENERATE_FILES 保持一致：回传校验并填充默认值后的完整 spec
        spec: req.spec as Record<string, unknown>,
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
   * RAG 知识库检索（主进程 TF-IDF + 内存 LRU，供“引用来源”展示与智能体工具调用）。
   */
  ragSearch: (req: {
    query: string;
    generatorType?: string;
    topK?: number;
  }): Promise<RagSearchRes> => window.mcApi.ragSearch(req),
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
  // === 整合包：依赖解析 + 冲突检测 + mrpack 导出 ===
  modpackResolve: (req: {
    mods: { projectId: string; name?: string }[];
    mcVersion: string;
    loader: string;
    allowCache?: boolean;
  }): Promise<ModpackResolveRes> => window.mcApi.modpackResolve(req),
  modpackCheckConflicts: (req: {
    mods: unknown[];
    mcVersion: string;
    loader: string;
  }): Promise<ModpackCheckConflictsRes> => window.mcApi.modpackCheckConflicts(req),
  modpackExportMrpack: (
    req: { spec: unknown; projectId?: string; defaultName?: string },
    onProgress?: (p: {
      loaded: number;
      total: number;
      percentage: number;
      currentFile: string;
      done: boolean;
    }) => void,
  ): Promise<ModpackExportMrpackRes> => {
    if (!onProgress) return window.mcApi.modpackExportMrpack(req);
    const off = window.mcApi.onModpackExportProgress((data) => onProgress(data));
    return window.mcApi.modpackExportMrpack(req).finally(off);
  },
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

  // ============================================================
  // 项目感知文件操作（自动锚定到项目工作区）
  // ============================================================

  /** 列出项目目录 */
  fileProjectListDir: (projectId: string, path?: string) =>
    window.mcApi.fileProjectListDir(projectId, path ?? ''),

  /** 列出项目目录树（递归，支持深度限制） */
  fileProjectListTree: (projectId: string, path?: string, maxDepth?: number) =>
    window.mcApi.fileProjectListTree(projectId, path ?? '', maxDepth ?? -1),

  /** 读取项目文件 */
  fileProjectReadText: (projectId: string, path: string, encoding?: string) =>
    window.mcApi.fileProjectReadText(projectId, path, encoding),

  /** 写入项目文件 */
  fileProjectWriteText: (projectId: string, path: string, content: string, encoding?: string) =>
    window.mcApi.fileProjectWriteText(projectId, path, content, encoding),

  /** 创建项目目录 */
  fileProjectMakeDir: (projectId: string, path: string) =>
    window.mcApi.fileProjectMakeDir(projectId, path),

  /** 删除项目文件/目录 */
  fileProjectDeleteItem: (projectId: string, path: string) =>
    window.mcApi.fileProjectDeleteItem(projectId, path),

  /** 获取项目工作区根目录 */
  fileProjectGetWorkspace: (projectId: string) => window.mcApi.fileProjectGetWorkspace(projectId),

  /** 获取项目输出目录 */
  fileProjectGetOutputDir: (projectId: string) => window.mcApi.fileProjectGetOutputDir(projectId),

  /** 获取项目构建缓存目录 */
  fileProjectGetBuildCacheDir: (projectId: string) =>
    window.mcApi.fileProjectGetBuildCacheDir(projectId),

  /** 获取项目临时目录 */
  fileProjectGetTempDir: (projectId: string) => window.mcApi.fileProjectGetTempDir(projectId),

  /** 获取项目资源包目录 */
  fileProjectGetResourcePacksDir: (projectId: string) =>
    window.mcApi.fileProjectGetResourcePacksDir(projectId),

  /** 获取项目 Mod 目录 */
  fileProjectGetModsDir: (projectId: string) => window.mcApi.fileProjectGetModsDir(projectId),

  /** 获取项目导出目录 */
  fileProjectGetExportsDir: (projectId: string) => window.mcApi.fileProjectGetExportsDir(projectId),

  /** 确保项目标准子目录存在 */
  fileProjectEnsureDirs: (projectId: string) => window.mcApi.fileProjectEnsureDirs(projectId),

  // ============================================================
  // 文件元数据与冲突检测
  // ============================================================

  /** 获取项目文件元数据（mtime + size + hash） */
  fileProjectGetFileMeta: (projectId: string, path: string) =>
    window.mcApi.fileProjectGetFileMeta(projectId, path),

  /** 带元数据校验的项目文件写入 */
  fileProjectWriteTextWithMeta: (
    projectId: string,
    path: string,
    content: string,
    expectedMeta?: { mtime: number; size: number; hash: string },
    encoding?: string,
  ) => window.mcApi.fileProjectWriteTextWithMeta(projectId, path, content, expectedMeta, encoding),

  // ============================================================
  // 大文件流式传输
  // ============================================================

  /**
   * 流式写入大文件
   * @param projectId 项目 ID
   * @param path 相对路径
   * @param data 文件数据（Uint8Array）
   * @param options 选项：onProgress 进度回调，expectedHash 预期 MD5
   * @returns 写入结果，包含元数据
   */
  fileProjectWriteStream: async (
    projectId: string,
    path: string,
    data: Uint8Array,
    options?: {
      onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void;
      expectedHash?: string;
    },
  ): Promise<{
    success: boolean;
    meta?: { size: number; mtime: number; hash: string };
    error?: string;
  }> => {
    return window.mcApi.fileProjectWriteStream(projectId, path, data, options);
  },

  /**
   * 流式读取大文件
   * @param projectId 项目 ID
   * @param path 相对路径
   * @param onChunk 分片回调
   * @param options 选项：onProgress 进度回调，chunkSize 分片大小
   * @returns 读取结果
   */
  fileProjectReadStream: (
    projectId: string,
    path: string,
    onChunk: (
      chunk: Uint8Array,
      isLast: boolean,
      progress: { loaded: number; total: number; percentage: number },
    ) => void,
    options?: {
      onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void;
      chunkSize?: number;
    },
  ): Promise<{ success: boolean; error?: string }> => {
    return window.mcApi.fileProjectReadStream(
      projectId,
      path,
      (data) => {
        onChunk(data.chunk, data.isLast, data.progress);
        if (options?.onProgress && data.progress) {
          options.onProgress(data.progress);
        }
      },
      options,
    );
  },

  /**
   * 下载生成器产出的大文件
   * @param projectId 项目 ID
   * @param largeFiles 大文件元数据列表
   * @param onProgress 总体进度回调
   * @param onFileProgress 单文件进度回调
   * @returns 下载结果
   */
  downloadLargeFiles: async (
    projectId: string,
    largeFiles: LargeFileMetaT[],
    onProgress?: (progress: {
      loaded: number;
      total: number;
      percentage: number;
      currentFile: string;
    }) => void,
    onFileProgress?: (
      filePath: string,
      progress: { loaded: number; total: number; percentage: number },
    ) => void,
  ): Promise<{
    success: boolean;
    files: Array<{ path: string; content: string }>;
    error?: string;
  }> => {
    const results: Array<{ path: string; content: string }> = [];
    let totalLoaded = 0;
    const totalSize = largeFiles.reduce((sum, f) => sum + f.size, 0);

    for (const file of largeFiles) {
      const chunks: Uint8Array[] = [];
      let fileLoaded = 0;

      await ipcClient.fileProjectReadStream(
        projectId,
        file.path,
        (chunk, isLast, progress) => {
          chunks.push(chunk);
          fileLoaded += chunk.byteLength;
          totalLoaded += chunk.byteLength;

          if (onFileProgress) {
            onFileProgress(file.path, {
              loaded: fileLoaded,
              total: file.size,
              percentage: progress?.percentage ?? Math.round((fileLoaded / file.size) * 100),
            });
          }
          if (onProgress) {
            onProgress({
              loaded: totalLoaded,
              total: totalSize,
              percentage: Math.round((totalLoaded / totalSize) * 100),
              currentFile: file.path,
            });
          }
        },
        { chunkSize: 1024 * 1024 },
      );

      // 合并分片
      const fullBuffer = Buffer.concat(chunks);
      results.push({ path: file.path, content: fullBuffer.toString('utf8') });
    }

    return { success: true, files: results };
  },

  // ============================================================
  // 内核只读通道（§4.2 / §10.2）
  // ============================================================
  //
  // 只有 R 类（只读免确认）。W/X 类走 preload 的 `kernel:execute`，而那条通道
  // **刻意没有进 contextBridge 白名单**（确认弹窗的 UI 还没验证），所以这里也没有
  // 对应方法 —— 类型层面就不给「以为能调」的错觉。

  /** 内核 kind 自描述表（kind → 内核 / R·W·X 分级 / 风险 / 是否对 UI 可达）。 */
  kernelListKinds: (): Promise<KernelListKindsRes> => window.mcApi.kernelListKinds(),

  /** 调一个只读内核 kind；kind 不在白名单时主进程会直接拒（ZodError）。 */
  kernelRead: (req: KernelReadReq): Promise<KernelTaskResultT> => window.mcApi.kernelRead(req),

  /**
   * 监听项目变更
   * @param handler 变更回调
   * @returns 取消订阅函数
   */
  onProjectChanged: (
    handler: (payload: { type: 'created' | 'updated' | 'deleted'; projectId: string }) => void,
  ) => {
    return window.mcApi.onProjectChanged?.(handler) ?? (() => {});
  },
};
