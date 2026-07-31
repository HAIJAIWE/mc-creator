import { describe, it, expect } from 'vitest';
import { ModGenerator, MockProvider, Orchestrator } from '@mc-creator/core';
import { GenerateSpecRequest, GenerateFilesRequest } from '../shared/ipc-channels.js';
import { buildChatSystemMessage } from './chat-system-message.js';

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

/**
 * P12.6 buildChatSystemMessage 单元测试：验证 chat 模式 system message 构建。
 */
describe('P12 buildChatSystemMessage', () => {
  it('无 context 时返回默认 system message', () => {
    expect(buildChatSystemMessage(undefined)).toBe(
      '你是 Minecraft mod 专家助手，帮助用户设计 mod。简洁回答。',
    );
  });

  it('空对象 context 时返回增强 system message（包含默认前缀）', () => {
    // context 存在但所有字段为 undefined 时，应进入分支构建（包含默认前缀）
    const msg = buildChatSystemMessage({});
    expect(msg).toContain('你是 Minecraft mod 专家助手');
    expect(msg).toContain('请基于用户当前项目上下文回答');
  });

  it('context.generatorType=mod 时 system message 包含「模组」', () => {
    const msg = buildChatSystemMessage({ generatorType: 'mod' });
    expect(msg).toContain('当前项目类型：模组');
  });

  it('context.generatorType=datapack 时 system message 包含「数据包」', () => {
    const msg = buildChatSystemMessage({ generatorType: 'datapack' });
    expect(msg).toContain('当前项目类型：数据包');
  });

  it('context.generatorType 为未知值时 system message 包含原值', () => {
    const msg = buildChatSystemMessage({ generatorType: 'custom_xyz' });
    expect(msg).toContain('当前项目类型：custom_xyz');
  });

  it('context.description 时 system message 包含用户描述', () => {
    const msg = buildChatSystemMessage({ description: '添加一个红宝石矿石' });
    expect(msg).toContain('用户对项目的描述：添加一个红宝石矿石');
  });

  it('context.specSummary 时 system message 包含 spec 摘要', () => {
    const summary = 'modId: ruby_mod\nitems[2]: ruby, ruby_sword';
    const msg = buildChatSystemMessage({ specSummary: summary });
    expect(msg).toContain('当前 spec 摘要：');
    expect(msg).toContain(summary);
  });

  it('完整 context（三项齐全）时 system message 包含所有部分', () => {
    const msg = buildChatSystemMessage({
      generatorType: 'modpack',
      description: '整合包描述',
      specSummary: 'modId: pack',
    });
    expect(msg).toContain('当前项目类型：整合包');
    expect(msg).toContain('整合包描述');
    expect(msg).toContain('modId: pack');
  });
});
