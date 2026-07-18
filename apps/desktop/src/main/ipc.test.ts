import { describe, it, expect } from 'vitest';
import { ModGenerator, MockProvider, Orchestrator } from '@mc-creator/core';
import { GenerateSpecRequest, GenerateFilesRequest } from '../shared/ipc-channels.js';

// 直接测试 schema 解析 + core 引擎调用（不启动 Electron）
describe('IPC 处理逻辑（不经过 ipcMain）', () => {
  it('GenerateSpec：描述 → spec', async () => {
    const req = GenerateSpecRequest.parse({ description: '做一个 mod' });
    const o = new Orchestrator(
      new MockProvider(
        JSON.stringify({
          modId: 'demo',
          version: '1.0.0',
          name: 'Demo',
          description: '',
          items: [],
          blocks: [],
        }),
      ),
    );
    const spec = await o.generateModSpec(req.description);
    expect(spec.modId).toBe('demo');
  });

  it('GenerateFiles：spec → 文件树', async () => {
    const req = GenerateFilesRequest.parse({
      loader: 'fabric',
      mcVersion: '1.21.11',
      spec: {
        modId: 'demo',
        version: '1.0.0',
        name: 'Demo',
        description: '',
        items: [],
        blocks: [],
      },
    });
    const spec = req.spec as any;
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: req.loader,
      mcVersion: req.mcVersion,
      modId: spec.modId,
      spec,
      projectPath: '',
    });
    expect(result.files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(true);
  });
});
