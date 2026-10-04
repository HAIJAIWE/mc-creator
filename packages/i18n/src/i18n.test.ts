/**
 * @mc-creator/i18n 单测（vitest）。
 * 覆盖：中英全 key 覆盖、zh 与 shell errors.ts 文案一致、
 * t() 回退逻辑、opConfirm X/R/W 分级。
 *
 * shell 与 contract 零运行时依赖、且都在同一 workspace 内，
 * 这里按包名导入（与生产代码一致），避免相对路径把别的包的源码
 * 拖进本包的 tsc program（composite + rootDir 会直接报 TS6059/TS6307）。
 */
import { describe, expect, it } from 'vitest';
import { MCP_TOOL_PERMISSIONS } from '@mc-creator/contract';
import {
  CLASSIFIED_ERROR_DESC_ZH,
  FILE_ERROR_ZH,
  type ErrorCategory,
  type FileErrorCode,
} from '@mc-creator/shell';
import { en } from './en.js';
import { ALL_KEYS, opConfirm, t, type MessageKey } from './index.js';
import { zh } from './zh.js';

const CATEGORY_KEY: Record<ErrorCategory, MessageKey> = {
  network: 'error.category.network',
  validation: 'error.category.validation',
  version: 'error.category.version',
  disk: 'error.category.disk',
  permission: 'error.category.permission',
  unknown: 'error.category.unknown',
};

const FILE_KEY: Record<FileErrorCode, MessageKey> = {
  NOT_FOUND: 'error.file.not_found',
  PERMISSION: 'error.file.permission',
  CONFLICT: 'error.file.conflict',
  DISK_FULL: 'error.file.disk_full',
  INVALID_PATH: 'error.file.invalid_path',
  UNKNOWN: 'error.file.unknown',
};

describe('keys', () => {
  it('key 总数锁定 29（6 分类 + 6 文件 + 8 操作 + 4 确认 + 5 任务）', () => {
    expect(ALL_KEYS).toHaveLength(29);
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
  });

  it('zh 全覆盖：每个 key 都是非空字符串', () => {
    for (const key of ALL_KEYS) {
      expect(typeof zh[key], key).toBe('string');
      expect(zh[key].length, key).toBeGreaterThan(0);
    }
  });

  it('en 全覆盖：每个 key 都是非空字符串', () => {
    for (const key of ALL_KEYS) {
      expect(typeof en[key], key).toBe('string');
      expect(en[key].length, key).toBeGreaterThan(0);
    }
  });
});

describe('zh 与 shell errors.ts 一致', () => {
  it('error.category.* 6 条与 CLASSIFIED_ERROR_DESC_ZH 逐字一致', () => {
    const categories = Object.keys(CATEGORY_KEY) as ErrorCategory[];
    expect(categories).toHaveLength(6);
    for (const category of categories) {
      expect(zh[CATEGORY_KEY[category]], category).toBe(CLASSIFIED_ERROR_DESC_ZH[category]);
    }
  });

  it('error.file.* 6 条与 FILE_ERROR_ZH 逐字一致', () => {
    const codes = Object.keys(FILE_KEY) as FileErrorCode[];
    expect(codes).toHaveLength(6);
    for (const code of codes) {
      expect(zh[FILE_KEY[code]], code).toBe(FILE_ERROR_ZH[code]);
    }
  });
});

describe('t()', () => {
  it('默认返回中文', () => {
    expect(t('error.category.network')).toBe('网络错误，请检查网络连接后重试。');
    expect(t('task.succeeded')).toBe('任务已成功');
  });

  it('en 返回英文', () => {
    expect(t('error.category.network', 'en')).toBe('Network error. Check your connection and try again.');
    expect(t('task.succeeded', 'en')).toBe('Task succeeded');
  });

  it('en 缺 key 回退中文', () => {
    const key: MessageKey = 'op.launch';
    const saved = en[key];
    delete (en as Record<string, string>)[key];
    try {
      expect(t(key, 'en')).toBe(zh[key]);
    } finally {
      (en as Record<string, string>)[key] = saved;
    }
    expect(t(key, 'en')).toBe(saved);
  });

  it('中英都缺返回 key 本身（fail-open）', () => {
    const key = 'task.queued' as MessageKey;
    const savedZh = zh[key];
    const savedEn = en[key];
    delete (zh as Record<string, string>)[key];
    delete (en as Record<string, string>)[key];
    try {
      expect(t(key, 'en')).toBe(key);
      expect(t(key)).toBe(key);
    } finally {
      (zh as Record<string, string>)[key] = savedZh;
      (en as Record<string, string>)[key] = savedEn;
    }
  });
});

describe('opConfirm()', () => {
  it('4 个有专属确认文案的 X 类工具返回非空（中英）', () => {
    const cases: Array<[string, string, string]> = [
      ['build_project', '确认构建项目吗？', 'Confirm build project?'],
      ['deploy_plugin', '确认部署插件吗？', 'Confirm deploy plugin?'],
      ['restart_server', '确认重启服务吗？', 'Confirm restart server?'],
      ['launch_instance', '确认启动实例吗？', 'Confirm launch instance?'],
    ];
    for (const [tool, expectedZh, expectedEn] of cases) {
      expect(MCP_TOOL_PERMISSIONS[tool], tool).toBe('X');
      expect(opConfirm(tool), tool).toBe(expectedZh);
      expect(opConfirm(tool, 'en'), tool).toBe(expectedEn);
    }
  });

  it('R 类工具全部返回 null（免确认）', () => {
    const rTools = Object.entries(MCP_TOOL_PERMISSIONS)
      .filter(([, level]) => level === 'R')
      .map(([tool]) => tool);
    expect(rTools.length).toBeGreaterThan(0);
    for (const tool of rTools) {
      expect(opConfirm(tool), tool).toBeNull();
    }
  });

  it('W 类与无专属文案的 X 类工具返回 null', () => {
    for (const tool of ['install_mod', 'uninstall_content', 'generate_content', 'stop_server', 'create_instance']) {
      expect(opConfirm(tool), tool).toBeNull();
    }
  });

  it('未知工具名返回 null', () => {
    expect(opConfirm('not_a_tool')).toBeNull();
    expect(opConfirm('')).toBeNull();
  });
});
