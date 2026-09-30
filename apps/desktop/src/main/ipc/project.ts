/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain, dialog } from 'electron';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import JSZip from 'jszip';
import { assertWithin } from '../ipc-utils.js';
import { loadProjects, saveProject, deleteProject, getProject } from '../project-store.js';
import {
  EXPORT_ZIP,
  ExportZipRequest,
  SAVE_FILE,
  SaveFileRequest,
  SAVE_ALL_FILES,
  SaveAllFilesRequest,
  EXPORT_SPEC,
  IMPORT_SPEC,
  ExportSpecRequest,
  ImportSpecResponse,
  SpecSnapshotSchema,
  LIST_PROJECTS,
  GET_PROJECT,
  SAVE_PROJECT,
  DELETE_PROJECT,
  EXPORT_PROJECT,
  IMPORT_PROJECT,
  ExportProjectRequest,
  ProjectSchema,
  IMPORT_RESOURCE_FILES,
  ImportResourceFilesRequest,
  type ExportZipRes,
  type SaveFileRes,
  type SaveAllFilesRes,
  type ExportProjectRes,
  type ImportProjectRes,
  type Project,
  type ImportResourceFilesRes,
} from '../../shared/ipc-channels.js';

export function registerProjectHandlers(): void {
  // 导出 zip
  ipcMain.handle(EXPORT_ZIP, async (_e, raw: unknown): Promise<ExportZipRes> => {
    const req = ExportZipRequest.parse(raw);
    const result = await dialog.showSaveDialog({
      defaultPath: req.defaultName,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    const zip = new JSZip();
    for (const f of req.files) {
      if (f.path.endsWith('.png')) {
        // PNG 的 content 是 base64 字符串，写入 zip 时需 decode 为二进制
        zip.file(f.path, Buffer.from(f.content, 'base64'));
      } else {
        zip.file(f.path, f.content);
      }
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(result.filePath, buf);
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // 单文件保存到磁盘
  ipcMain.handle(SAVE_FILE, async (_e, raw: unknown): Promise<SaveFileRes> => {
    const req = SaveFileRequest.parse(raw);
    const defaultName = req.defaultName || req.path.split('/').pop() || 'file.txt';
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    // PNG 走 base64 解码写入，其他文件按 utf-8 文本写入
    if (req.path.endsWith('.png')) {
      await writeFile(result.filePath, Buffer.from(req.content, 'base64'));
    } else {
      await writeFile(result.filePath, req.content, 'utf-8');
    }
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // 协作编辑：导出 Spec 快照文件（.mc-spec.json）
  ipcMain.handle(EXPORT_SPEC, async (_e, raw: unknown) => {
    const req = ExportSpecRequest.parse(raw);
    const result = await dialog.showSaveDialog({
      defaultPath: `${req.generatorType}-spec.mc-spec.json`,
      filters: [{ name: 'MC Spec 快照', extensions: ['mc-spec.json', 'json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    const snapshot = {
      meta: {
        exportedAt: new Date().toISOString(),
        exporter: '',
        description: req.description,
        generatorType: req.generatorType,
      },
      spec: req.spec,
    };
    await writeFile(result.filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // 协作编辑：导入 Spec 快照文件
  ipcMain.handle(IMPORT_SPEC, async (): Promise<z.infer<typeof ImportSpecResponse>> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'MC Spec 快照', extensions: ['mc-spec.json', 'json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { snapshot: null, canceled: true };
    }
    try {
      const content = await readFile(result.filePaths[0], 'utf-8');
      const parsed = SpecSnapshotSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        return {
          snapshot: null,
          canceled: false,
          error: `Spec 快照格式无效：${parsed.error.issues.map((i) => i.path.join('.') || i.message).join('; ')}`,
        };
      }
      return { snapshot: parsed.data, canceled: false };
    } catch (e) {
      return { snapshot: null, canceled: false, error: `读取失败：${(e as Error).message}` };
    }
  });

  // 保存全部文件到磁盘（选择目录后按相对路径写入）
  ipcMain.handle(SAVE_ALL_FILES, async (_e, raw: unknown): Promise<SaveAllFilesRes> => {
    const req = SaveAllFilesRequest.parse(raw);
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true, savedDir: null, count: 0 };
    }
    const baseDir = result.filePaths[0];
    let count = 0;
    for (const f of req.files) {
      // 安全：禁止 ../.. 逃逸出 baseDir
      assertWithin(baseDir, f.path);
      const abs = join(baseDir, f.path);
      await mkdir(dirname(abs), { recursive: true });
      if (f.path.endsWith('.png')) {
        await writeFile(abs, Buffer.from(f.content, 'base64'));
      } else {
        await writeFile(abs, f.content, 'utf-8');
      }
      count++;
    }
    return { ok: true, canceled: false, savedDir: baseDir, count };
  });

  // 资源文件导入：弹出文件选择对话框，读取文件并 base64 编码返回
  ipcMain.handle(
    IMPORT_RESOURCE_FILES,
    async (_e, raw: unknown): Promise<ImportResourceFilesRes> => {
      const req = ImportResourceFilesRequest.parse(raw);
      const filters = [{ name: req.title, extensions: req.extensions }];
      const result = await dialog.showOpenDialog({
        title: req.title,
        properties: req.multiSelect ? ['openFile', 'multiSelections'] : ['openFile'],
        filters,
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true, files: [] };
      }
      const files: ImportResourceFilesRes['files'] = [];
      for (const filePath of result.filePaths) {
        try {
          const buf = await readFile(filePath);
          const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
          files.push({
            sourcePath: filePath,
            fileName: basename(filePath),
            ext,
            base64: buf.toString('base64'),
            size: buf.length,
          });
        } catch (err) {
          // 单文件读取失败不阻断整体导入，跳过
          console.warn(`导入资源文件失败: ${filePath}`, err);
        }
      }
      return { ok: true, canceled: false, files };
    },
  );

  // 项目管理
  ipcMain.handle(LIST_PROJECTS, async () => {
    return loadProjects();
  });

  ipcMain.handle(GET_PROJECT, async (_e, raw: unknown): Promise<Project | null> => {
    const { id } = z.object({ id: z.string() }).parse(raw);
    return getProject(id);
  });

  ipcMain.handle(SAVE_PROJECT, async (_e, raw: unknown) => {
    const project = ProjectSchema.parse(raw);
    saveProject(project);
    return { ok: true };
  });

  ipcMain.handle(DELETE_PROJECT, async (_e, raw: unknown) => {
    const { id } = z.object({ id: z.string() }).parse(raw);
    deleteProject(id);
    return { ok: true };
  });

  // === 项目导出（P28）：把整个 Project 序列化为 project.json 打包成 zip ===
  ipcMain.handle(EXPORT_PROJECT, async (_e, raw: unknown): Promise<ExportProjectRes> => {
    const req = ExportProjectRequest.parse(raw);
    const project = req.project;
    const result = await dialog.showSaveDialog({
      defaultPath: `${project.name}.mcproject.zip`,
      filters: [{ name: 'MC Project', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(project, null, 2));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(result.filePath, buf);
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // === 项目导入（P28）：解压 zip → 解析 project.json → 校验 → 生成新 id 保存 ===
  ipcMain.handle(IMPORT_PROJECT, async (): Promise<ImportProjectRes> => {
    try {
      const openResult = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'MC Project', extensions: ['zip'] }],
      });
      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { project: null, error: null };
      }
      const buf = await readFile(openResult.filePaths[0]);
      const zip = await JSZip.loadAsync(buf);
      const projectFile = zip.file('project.json');
      if (!projectFile) {
        return { project: null, error: 'zip 内未找到 project.json' };
      }
      const jsonStr = await projectFile.async('string');
      const parsed = ProjectSchema.parse(JSON.parse(jsonStr));
      // 生成新 id + 更新时间戳，避免覆盖原项目
      const now = new Date().toISOString();
      const newProject: Project = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      saveProject(newProject);
      return { project: newProject, error: null };
    } catch (e) {
      return { project: null, error: (e as Error).message };
    }
  });
}
