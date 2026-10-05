/**
 * 服务端内核 X 级任务测试（确认闸门 + 真实现）。
 *
 * 覆盖要点（§10.2 执行类须弹窗确认 / §10.6 权限分级 / §7.1 进程保活归外壳 /
 * §13.4 沙箱产物永不自动部署 / §14 原子性与错误分类）：
 * 1. confirm 未配置或返回 false → 拒绝 + 零副作用；
 * 2. confirm true → 真实落盘 + ArtifactRef.sha256 64 位；
 * 3. 重名 → validation；路径穿越 serverId → validation 且外部文件未删；
 * 4. eula 未接受 → validation（不得代用户同意 EULA）；
 * 5. server.properties 值含换行/等号 → 转义防注入；
 * 6. build_project 目录不存在 → validation；构建失败分类正确；
 * 7. deploy_plugin 记录 sha256 账本 + hotReload 只返回建议命令；
 * 8. stop/restart 只校验存在性并返回控制指令（不 spawn 进程）；
 * 9. rollback_build 无历史产物 → validation 明确「无历史产物可回滚」；
 * 10. sandbox 模式写sandboxDir 而非 dataDir。
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProgressEvent } from '@mc-creator/contract';
import { ServerKernel } from './kernel.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkTmp(prefix = 'server-exec-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function collect(handle: {
  progress: AsyncIterable<ProgressEvent>;
}): Promise<ProgressEvent[]> {
  const out: ProgressEvent[] = [];
  for await (const e of handle.progress) out.push(e);
  return out;
}

/** 造一个合法服务端目录（server.properties + plugins/）。 */
function seedServer(dataDir: string, name: string): string {
  const dir = join(dataDir, name);
  mkdirSync(join(dir, 'plugins'), { recursive: true });
  mkdirSync(join(dir, 'logs'), { recursive: true });
  mkdirSync(join(dir, 'world'), { recursive: true });
  writeFileSync(join(dir, 'server.properties'), 'motd=test\nserver-port=25565\n', 'utf8');
  return dir;
}

const YES = () => true;
const NO = () => false;

const IS_WIN = process.platform === 'win32';

/**
 * 在 root 下造一个带假 gradlew 的工程目录（夹具沿用 devkit.test.ts 的做法，
 * 不依赖真实 JDK/Gradle、不触网）。注意必须落在 root 之内——build_project 会
 * 经 guard() 校验 projectDir 未越出 dataDir/sandboxDir。
 */
function makeFakeProject(root: string, name: string, script: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (IS_WIN) {
    writeFileSync(join(dir, 'gradlew.bat'), script, 'utf8');
  } else {
    const p = join(dir, 'gradlew');
    writeFileSync(p, script, { encoding: 'utf8', mode: 0o755 });
    chmodSync(p, 0o755);
  }
  return dir;
}

/** 假脚本：在 build/libs 下造出给定的一批 jar 并 exit 0。 */
function fakeBuildScript(jars: string[]): string {
  if (IS_WIN) {
    return (
      '@echo off\r\nmkdir build\\libs 2>nul\r\n' +
      jars.map((j) => `echo fake> build\\libs\\${j}\r\n`).join('') +
      'exit /b 0\r\n'
    );
  }
  return `#!/bin/sh\nmkdir -p build/libs\n${jars.map((j) => `echo fake > build/libs/${j}\n`).join('')}exit 0\n`;
}

/** 假脚本：输出 Gradle 风格失败日志并 exit 1。 */
function fakeFailScript(): string {
  return IS_WIN
    ? '@echo off\r\necho FAILURE: Build failed with an exception.\r\necho * What went wrong:\r\necho Could not resolve all files for configuration\r\nexit /b 1\r\n'
    : '#!/bin/sh\necho FAILURE: Build failed with an exception.\necho * What went wrong:\necho Could not resolve all files for configuration\nexit 1\n';
}

/** 假脚本：exit 0 但不产出任何 jar。 */
function fakeEmptyScript(): string {
  return IS_WIN
    ? '@echo off\r\necho BUILD SUCCESSFUL\r\nexit /b 0\r\n'
    : '#!/bin/sh\necho BUILD SUCCESSFUL\nexit 0\n';
}

const CREATE_PAYLOAD = {
  name: 'srv1',
  runtime: 'paper',
  versionId: '1.21.1',
  port: 25577,
  acceptEula: true,
} as const;

describe('ServerKernel 确认闸门：未确认 → 拒绝且零副作用', () => {
  it('create_instance 未传 confirm → permission + confirmRequired，目录未创建', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'x1', kind: 'create_instance', payload: CREATE_PAYLOAD })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('permission');
    expect(result.data).toMatchObject({ confirmRequired: true });
    expect(existsSync(join(dataDir, 'srv1'))).toBe(false);
  });

  it('confirm 返回 false → 拒绝且不落盘', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: NO })
      .dispatch({ id: 'x2', kind: 'create_instance', payload: CREATE_PAYLOAD })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'srv1'))).toBe(false);
  });

  it('delete_instance 拒绝时不删除已存在服务端', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'alive');
    const result = await new ServerKernel({ dataDir, confirm: NO })
      .dispatch({ id: 'x3', kind: 'delete_instance', payload: { serverId: 'alive' } })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dir, 'server.properties'))).toBe(true);
  });

  it('未确认时 build_project / deploy_plugin / stop_server / rollback_build 全拒绝', async () => {
    const dataDir = mkTmp();
    const kernel = new ServerKernel({ dataDir });
    const kinds = [
      'build_project',
      'deploy_plugin',
      'stop_server',
      'restart_server',
      'rollback_build',
    ] as const;
    for (const kind of kinds) {
      const result = await kernel
        .dispatch({
          id: `x-${kind}`,
          kind,
          payload: { serverId: 's', projectDir: '.', artifactPath: 'a.jar', projectRef: 'a.jar' },
        })
        .result();
      expect(result.error?.category).toBe('permission');
    }
  });
});

describe('ServerKernel create_instance 真实现', () => {
  it('confirm true → 目录结构 + server.properties/eula/启动脚本/ops/whitelist 全部落地', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'cr1',
        kind: 'create_instance',
        payload: { ...CREATE_PAYLOAD, motd: 'Hello World' },
      })
      .result();
    expect(result.ok).toBe(true);
    const dir = join(dataDir, 'srv1');
    for (const sub of ['plugins', 'world', 'logs', 'config']) {
      expect(existsSync(join(dir, sub))).toBe(true);
    }
    const props = readFileSync(join(dir, 'server.properties'), 'utf8');
    expect(props).toContain('server-port=25577');
    expect(props).toContain('motd=Hello World');
    expect(props).toContain('enable-query=false');
    expect(props).toContain('level-name=world');
    expect(readFileSync(join(dir, 'eula.txt'), 'utf8')).toBe('eula=true\n');
    expect(readFileSync(join(dir, 'ops.json'), 'utf8')).toBe('[]\n');
    expect(readFileSync(join(dir, 'whitelist.json'), 'utf8')).toBe('[]\n');
    expect(readFileSync(join(dir, 'start.bat'), 'utf8')).toContain('-jar "server.jar"');
    expect(readFileSync(join(dir, 'start.sh'), 'utf8')).toContain('exec "java"');
    expect(result.data).toMatchObject({ serverId: 'srv1', runtime: 'paper', port: 25577 });
    expect(result.artifacts?.length).toBe(2);
    expect(result.artifacts?.every((a) => a.kind === 'server-config')).toBe(true);
    expect(result.artifacts?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('未接受 EULA → validation，且不创建任何目录', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'cr2',
        kind: 'create_instance',
        payload: { ...CREATE_PAYLOAD, acceptEula: false },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'EULA_NOT_ACCEPTED' },
    });
    expect(existsSync(join(dataDir, 'srv1'))).toBe(false);
  });

  it('acceptEula 缺失 → validation（不得默认同意）', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'cr3',
        kind: 'create_instance',
        payload: { name: 'srv2', runtime: 'paper', versionId: '1.21.1' },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'EULA_NOT_ACCEPTED' },
    });
  });

  it('runtime 非法 → validation', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'cr4',
        kind: 'create_instance',
        payload: { ...CREATE_PAYLOAD, runtime: 'bukkit' },
      })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('port 越界 → validation', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'cr5', kind: 'create_instance', payload: { ...CREATE_PAYLOAD, port: 70000 } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('重名 → validation，既有server.properties 不被覆盖', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'srv1');
    writeFileSync(join(dir, 'server.properties'), 'motd=sentinel\n');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'cr6', kind: 'create_instance', payload: CREATE_PAYLOAD })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SERVER_EXISTS' },
    });
    expect(readFileSync(join(dir, 'server.properties'), 'utf8')).toBe('motd=sentinel\n');
  });

  it('motd 含换行/等号 → 转义防注入（不产生额外配置行）', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'cr7',
        kind: 'create_instance',
        payload: { ...CREATE_PAYLOAD, motd: 'evil\nonline-mode=false' },
      })
      .result();
    expect(result.ok).toBe(true);
    const props = readFileSync(join(dataDir, 'srv1', 'server.properties'), 'utf8');
    const motdLine = props.split('\n').find((l) => l.startsWith('motd='));
    expect(motdLine).toBeDefined();
    expect(motdLine).not.toContain('\n');
    // 真正的 online-mode 行仍在且未被篡改
    expect(props).toMatch(/^online-mode=true$/m);
  });

  it('gamemode 非法 → validation', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'cr8',
        kind: 'create_instance',
        payload: { ...CREATE_PAYLOAD, gamemode: 'chaos' },
      })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('name 含路径分隔符 → validation（路径穿越防护）', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'cr9',
        kind: 'create_instance',
        payload: { ...CREATE_PAYLOAD, name: '../evil' },
      })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('进度流含 validating / writing / complete 三阶段', async () => {
    const dataDir = mkTmp();
    const handle = new ServerKernel({ dataDir, confirm: YES }).dispatch({
      id: 'cr10',
      kind: 'create_instance',
      payload: CREATE_PAYLOAD,
    });
    const eventsPromise = collect(handle);
    await handle.result();
    expect((await eventsPromise).map((e) => e.stage)).toEqual([
      'validating',
      'writing',
      'complete',
    ]);
  });
});

describe('ServerKernel delete_instance 真实现', () => {
  it('服务端存在 → 递归删除', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'gone');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'dl1', kind: 'delete_instance', payload: { serverId: 'gone' } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(result.data).toMatchObject({ deleted: true, path: dir });
  });

  it('服务端不存在 → validation', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'dl2', kind: 'delete_instance', payload: { serverId: 'ghost' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('serverId="../../evil" → validation，外部目录未被删', async () => {
    const dataDir = mkTmp();
    const victim = join(dataDir, 'evil');
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, 'keep.txt'), 'keep');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'dl3', kind: 'delete_instance', payload: { serverId: '../../evil' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(readFileSync(join(victim, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('缺 serverId → validation', async () => {
    const result = await new ServerKernel({ confirm: YES })
      .dispatch({ id: 'dl4', kind: 'delete_instance', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

describe('ServerKernel build_project 真实现', () => {
  it('工程目录不存在 → validation（不臆造构建成功）', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'bp1',
        kind: 'build_project',
        payload: { projectDir: join(dataDir, 'no-such-project') },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'PROJECT_DIR_NOT_FOUND' },
    });
  });

  it('缺 projectDir → validation', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp2', kind: 'build_project', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('工程目录越界（../ 逃出 dataDir）→ validation，不触发任何编译', async () => {
    const dataDir = mkTmp();
    const outside = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp3', kind: 'build_project', payload: { projectDir: outside } })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SANDBOX_ESCAPE' },
    });
  });

  it('无 gradlew 的目录 → 构建失败归 validation + code=BUILD_FAILED', async () => {
    const dataDir = mkTmp();
    const projectDir = join(dataDir, 'proj');
    mkdirSync(projectDir, { recursive: true });
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp4', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ category: 'validation', code: 'BUILD_FAILED' });
    expect(result.error?.message).toMatch(/构建失败/);
  });

  it('构建成功 → ok:true + build-artifact ArtifactRef + sha256（不臆造失败）', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp5', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();

    expect(result.ok).toBe(true);
    expect(result.artifacts?.[0]).toMatchObject({ kind: 'build-artifact' });
    expect(result.artifacts?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const data = result.data as {
      jarPath: string;
      sha256: string;
      exitCode: number;
      sandboxed: boolean;
      note: string;
    };
    expect(data.jarPath.replace(/\\/g, '/')).toMatch(/build\/libs\/demo-1\.0\.jar$/);
    expect(data.jarPath).toBe(join(projectDir, 'build', 'libs', 'demo-1.0.jar'));
    expect(data.exitCode).toBe(0);
    expect(data.sandboxed).toBe(false);
    expect(data.note).toMatch(/deploy_plugin/);
    // data.sha256 与 ArtifactRef.sha256 一致（同一份磁盘事实，§0.5）
    expect(data.sha256).toBe(result.artifacts?.[0]?.sha256);
    expect(readFileSync(data.jarPath, 'utf8').trim()).toBe('fake');
  });

  it('data.isolation 如实回报实际强制项，且 network 恒为 false（§8.3）', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp-iso', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();

    expect(result.ok).toBe(true);
    const iso = (result.data as { isolation?: Record<string, unknown> }).isolation;
    // 上层必须能知道「这次到底有没有隔离」，否则 UI 只能显示一个
    // 永远为绿的「已沙箱化」——那正是 MEMORY §2-④ 说的假安全。
    expect(iso).toBeDefined();
    expect(iso?.source === 'job-object' || iso?.source === 'unisolated').toBe(true);
    // 无论如何都不能声称禁了网：Job Object 管不到网络。
    expect(iso?.network).toBe(false);
    // 降级时必须带原因，否则用户无从判断为什么没隔离。
    if (iso?.source === 'unisolated') {
      expect(typeof iso?.reason).toBe('string');
    }
  });

  it('jarName 指定 → 命中指定 jar（排除 -sources/-javadoc，取排序首个其余）', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(
      dataDir,
      'proj',
      fakeBuildScript(['custom-2.0.jar', 'demo-1.0.jar', 'demo-1.0-sources.jar']),
    );
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'bp6',
        kind: 'build_project',
        payload: { projectDir, jarName: 'custom-2.0.jar', timeoutMs: 20000 },
      })
      .result();
    expect(result.ok).toBe(true);
    expect((result.data as { jarPath: string }).jarPath).toBe(
      join(projectDir, 'build', 'libs', 'custom-2.0.jar'),
    );
  });

  it('未指定 jarName → 自动挑一个非附属 jar（-sources 被排除，custom 排序在前）', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(
      dataDir,
      'proj',
      fakeBuildScript(['demo-1.0.jar', 'demo-1.0-sources.jar', 'custom-2.0.jar']),
    );
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp7', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();
    expect(result.ok).toBe(true);
    expect((result.data as { jarPath: string }).jarPath).toBe(
      join(projectDir, 'build', 'libs', 'custom-2.0.jar'),
    );
  });

  it('jarName 指定但文件不存在 → validation + ARTIFACT_NOT_FOUND', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'bp8',
        kind: 'build_project',
        payload: { projectDir, jarName: 'nope-9.9.jar', timeoutMs: 20000 },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'ARTIFACT_NOT_FOUND' },
    });
  });

  it('编译失败（exit 1）→ BUILD_FAILED 且 message 带日志摘要', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeFailScript());
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp9', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ category: 'validation', code: 'BUILD_FAILED' });
    expect(result.error?.message).toMatch(/构建失败/);
    expect(result.error?.message).toMatch(/退出码 1/);
    // 日志摘要取自子进程输出，便于上层回灌修复（§10.3）
    expect(result.error?.message).toMatch(/Could not resolve all files/);
  });

  it('构建 exit 0 但没有任何 jar → ARTIFACT_NOT_FOUND（不返回空产物成功）', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeEmptyScript());
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp10', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'ARTIFACT_NOT_FOUND' },
    });
    expect(result.artifacts).toBeUndefined();
  });

  it('mode=sandbox 构建成功 → sandboxed=true 且 note 说明永不自动部署（§13.4）', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    const projectDir = makeFakeProject(sandboxDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const result = await new ServerKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'bp11', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as { sandboxed: boolean; note: string; jarPath: string };
    expect(data.sandboxed).toBe(true);
    expect(data.note).toMatch(/沙箱/);
    expect(data.note).toMatch(/永不自动部署/);
    // 产物确实只落沙箱目录，正式服务端 dataDir 无任何痕迹
    expect(existsSync(data.jarPath)).toBe(true);
    expect(data.jarPath.startsWith(sandboxDir)).toBe(true);
    expect(existsSync(join(dataDir, 'proj'))).toBe(false);
    expect(existsSync(join(dataDir, 'srv1'))).toBe(false);
  });

  it('mode=sandbox 下 dataDir 内的工程目录越界 → SANDBOX_ESCAPE（根随 mode 切换）', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    // 工程建在 dataDir 下，但 sandbox 模式的 root 是 sandboxDir → 应判越界
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const result = await new ServerKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'bp12', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SANDBOX_ESCAPE' },
    });
    expect(existsSync(join(projectDir, 'build'))).toBe(false);
  });

  it('两次 build_project 串行成功且 data.isolation 仍在（§8.2 队列未破坏返回形状）', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    for (const id of ['bp-q1', 'bp-q2']) {
      const result = await kernel
        .dispatch({ id, kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
        .result();
      expect(result.ok).toBe(true);
      const iso = (result.data as { isolation?: Record<string, unknown> }).isolation;
      expect(iso).toBeDefined();
      expect(iso?.network).toBe(false);
      expect(iso?.source === 'job-object' || iso?.source === 'unisolated').toBe(true);
    }
  });
});

describe('ServerKernel deploy_plugin 真实现', () => {
  it('JAR 部署 → 复制到 plugins/ + 写sha256 账本 + server-plugin ArtifactRef', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'srv1');
    const jar = join(mkTmp(), 'MyPlugin.jar');
    writeFileSync(jar, 'jar-bytes-v1');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'dp1',
        kind: 'deploy_plugin',
        payload: { serverId: 'srv1', artifactPath: jar },
      })
      .result();
    expect(result.ok).toBe(true);
    const dest = join(dir, 'plugins', 'MyPlugin.jar');
    expect(readFileSync(dest, 'utf8')).toBe('jar-bytes-v1');
    const record = JSON.parse(
      readFileSync(join(dir, 'plugins', '.deployed', 'MyPlugin.jar.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(record['jar']).toBe('MyPlugin.jar');
    expect(String(record['sha256'])).toMatch(/^[0-9a-f]{64}$/);
    expect(record['previousSha256']).toBeNull();
    expect(result.artifacts?.[0]).toMatchObject({ kind: 'server-plugin' });
    expect(result.data).toMatchObject({ jarName: 'MyPlugin.jar', changed: true, hotReload: false });
  });

  it('二次部署不同字节 → 账本记录 previousSha256，changed=false（内容未变则不算变）', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'srv2');
    const jar = join(mkTmp(), 'P.jar');
    writeFileSync(jar, 'v1');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    await kernel
      .dispatch({
        id: 'dp2a',
        kind: 'deploy_plugin',
        payload: { serverId: 'srv2', artifactPath: jar },
      })
      .result();
    const second = await kernel
      .dispatch({
        id: 'dp2b',
        kind: 'deploy_plugin',
        payload: { serverId: 'srv2', artifactPath: jar },
      })
      .result();
    const record = JSON.parse(
      readFileSync(join(dir, 'plugins', '.deployed', 'P.jar.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(second.ok).toBe(true);
    expect(record['previousSha256']).toBe(String(record['sha256']));
    expect((second.data as { changed: boolean }).changed).toBe(false);
  });

  it('hotReload=true → 只返回建议命令，绝不自动发送', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'srv3');
    const jar = join(mkTmp(), 'Hot.jar');
    writeFileSync(jar, 'hot');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'dp3',
        kind: 'deploy_plugin',
        payload: { serverId: 'srv3', artifactPath: jar, hotReload: true },
      })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as { reloadCommand: string; note: string };
    expect(data.reloadCommand).toBe('/reload confirm');
    expect(data.note).toMatch(/未自动发送/);
    // 未向控制台/日志写任何东西：内核不托管进程，仅给建议命令
    expect(existsSync(join(dataDir, 'srv3', 'logs', 'latest.log'))).toBe(false);
    expect(readFileSync(join(dataDir, 'srv3', 'plugins', 'Hot.jar'), 'utf8')).toBe('hot');
  });

  it('非 .jar 产物 → validation', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'srv4');
    const file = join(mkTmp(), 'plugin.zip');
    writeFileSync(file, 'x');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'dp4',
        kind: 'deploy_plugin',
        payload: { serverId: 'srv4', artifactPath: file },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'UNSUPPORTED_FORMAT' },
    });
  });

  it('产物不存在 → validation', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'srv5');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'dp5',
        kind: 'deploy_plugin',
        payload: { serverId: 'srv5', artifactPath: join(dataDir, 'nope.jar') },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SOURCE_NOT_FOUND' },
    });
  });

  it('服务端不存在 → validation', async () => {
    const dataDir = mkTmp();
    const jar = join(mkTmp(), 'X.jar');
    writeFileSync(jar, 'x');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'dp6',
        kind: 'deploy_plugin',
        payload: { serverId: 'ghost', artifactPath: jar },
      })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('服务端缺 plugins/ → validation', async () => {
    const dataDir = mkTmp();
    const dir = join(dataDir, 'noplug');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.properties'), 'motd=x\n');
    const jar = join(mkTmp(), 'Y.jar');
    writeFileSync(jar, 'y');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'dp7',
        kind: 'deploy_plugin',
        payload: { serverId: 'noplug', artifactPath: jar },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'PLUGINS_DIR_MISSING' },
    });
  });
});

describe('ServerKernel restart_server / stop_server（§7.1 不做进程托管）', () => {
  it('stop_server → 返回控制指令与note，不 spawn 进程', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'run1');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'ct1',
        kind: 'stop_server',
        payload: { serverId: 'run1', gracefulMs: 45000 },
      })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      action: 'stop_server',
      gracefulMs: 45000,
      controlCommand: 'stop',
    });
    expect((result.data as { serverDir: string }).serverDir).toBe(dir);
    expect((result.data as { note: string }).note).toMatch(/进程生命周期由外壳服务管理/);
  });

  it('restart_server → 默认 gracefulMs 30000，控制指令 restart', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'run2');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'ct2', kind: 'restart_server', payload: { serverId: 'run2' } })
      .result();
    expect(result.data).toMatchObject({
      action: 'restart_server',
      gracefulMs: 30000,
      controlCommand: 'restart',
    });
  });

  it('服务端目录不存在 → validation（不臆造控制指令）', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'ct3', kind: 'stop_server', payload: { serverId: 'ghost' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('缺 server.properties → validation（目录存在但不是合法服务端）', async () => {
    const dataDir = mkTmp();
    mkdirSync(join(dataDir, 'bare'), { recursive: true });
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'ct4', kind: 'restart_server', payload: { serverId: 'bare' } })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SERVER_CONFIG_MISSING' },
    });
  });

  it('gracefulMs 非法 → validation', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'run3');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'ct5', kind: 'stop_server', payload: { serverId: 'run3', gracefulMs: -5 } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

describe('ServerKernel rollback_build 真实现', () => {
  it('无部署记录 → validation 明确「无历史产物可回滚」', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'rb1');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'rb2',
        kind: 'rollback_build',
        payload: { serverId: 'rb1', projectRef: 'Nope.jar' },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'NO_HISTORY' },
    });
    expect(result.error?.message).toMatch(/无历史产物可回滚|无部署记录/);
  });

  it('有部署记录但没有上一版 → validation', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'rb3');
    mkdirSync(join(dir, 'plugins', '.deployed'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'A.jar'), 'current');
    writeFileSync(
      join(dir, 'plugins', '.deployed', 'A.jar.json'),
      JSON.stringify({ jar: 'A.jar', sha256: 'a'.repeat(64), previousSha256: null }),
    );
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'rb4',
        kind: 'rollback_build',
        payload: { serverId: 'rb3', projectRef: 'A.jar' },
      })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'NO_HISTORY' },
    });
  });

  it('指定 previousSha256 且备份存在 → 恢复上一版并更新账本', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'rb5');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const jarV1 = join(mkTmp(), 'B.jar');
    writeFileSync(jarV1, 'version-one');
    await kernel
      .dispatch({
        id: 'rb5a',
        kind: 'deploy_plugin',
        payload: { serverId: 'rb5', artifactPath: jarV1 },
      })
      .result();
    const v1Sha = (
      JSON.parse(readFileSync(join(dir, 'plugins', '.deployed', 'B.jar.json'), 'utf8')) as {
        sha256: string;
      }
    ).sha256;
    const jarV2 = join(mkTmp(), 'B.jar');
    writeFileSync(jarV2, 'version-two');
    await kernel
      .dispatch({
        id: 'rb5b',
        kind: 'deploy_plugin',
        payload: { serverId: 'rb5', artifactPath: jarV2 },
      })
      .result();
    expect(readFileSync(join(dir, 'plugins', 'B.jar'), 'utf8')).toBe('version-two');

    const rollback = await kernel
      .dispatch({
        id: 'rb5c',
        kind: 'rollback_build',
        payload: { serverId: 'rb5', projectRef: 'B.jar', previousSha256: v1Sha },
      })
      .result();
    expect(rollback.ok).toBe(true);
    // 回滚恢复上一版字节，并给出可再次回滚的哈希
    expect(readFileSync(join(dir, 'plugins', 'B.jar'), 'utf8')).toBe('version-one');
    expect((rollback.data as { previousSha256: string }).previousSha256).toBe(v1Sha);
  });

  it('两次不同内容部署后回滚 → 恢复上一版字节', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'rb6');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const j1 = join(mkTmp(), 'C.jar');
    writeFileSync(j1, 'one');
    await kernel
      .dispatch({
        id: 'rb6a',
        kind: 'deploy_plugin',
        payload: { serverId: 'rb6', artifactPath: j1 },
      })
      .result();
    const sha1 = (
      JSON.parse(readFileSync(join(dir, 'plugins', '.deployed', 'C.jar.json'), 'utf8')) as {
        sha256: string;
      }
    ).sha256;
    const j2 = join(mkTmp(), 'C.jar');
    writeFileSync(j2, 'two');
    await kernel
      .dispatch({
        id: 'rb6b',
        kind: 'deploy_plugin',
        payload: { serverId: 'rb6', artifactPath: j2 },
      })
      .result();
    expect(readFileSync(join(dir, 'plugins', 'C.jar'), 'utf8')).toBe('two');

    const rollback = await kernel
      .dispatch({
        id: 'rb6c',
        kind: 'rollback_build',
        payload: { serverId: 'rb6', projectRef: 'C.jar', previousSha256: sha1 },
      })
      .result();
    expect(rollback.ok).toBe(true);
    expect(readFileSync(join(dir, 'plugins', 'C.jar'), 'utf8')).toBe('one');
    expect(result_data_sha(rollback)).toMatch(/^[0-9a-f]{64}$/);
    expect(rollback.artifacts?.[0]).toMatchObject({ kind: 'server-plugin' });
  });

  it('缺 projectRef → validation', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'rb7');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'rb8', kind: 'rollback_build', payload: { serverId: 'rb7' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

function result_data_sha(result: { data?: unknown }): string {
  return String((result.data as { sha256?: unknown }).sha256);
}

describe('ServerKernel sandbox 模式隔离（§13.4）', () => {
  it('mode=sandbox → 写sandboxDir 而非 dataDir', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    const kernel = new ServerKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });
    const result = await kernel
      .dispatch({ id: 'sb1', kind: 'create_instance', payload: CREATE_PAYLOAD })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(sandboxDir, 'srv1', 'server.properties'))).toBe(true);
    expect(existsSync(join(dataDir, 'srv1'))).toBe(false);
    expect((result.data as { mode: string }).mode).toBe('sandbox');
  });

  it('mode=sandbox 未配sandboxDir → validation', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'sb2', kind: 'create_instance', payload: CREATE_PAYLOAD })
      .result();
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SANDBOX_ROOT_MISSING' },
    });
  });

  it('sandbox 模式下 deploy_plugin 也只落沙箱', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    seedServer(sandboxDir, 'sbsrv');
    const jar = join(mkTmp(), 'S.jar');
    writeFileSync(jar, 's');
    const kernel = new ServerKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });
    const result = await kernel
      .dispatch({
        id: 'sb3',
        kind: 'deploy_plugin',
        payload: { serverId: 'sbsrv', artifactPath: jar },
      })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(sandboxDir, 'sbsrv', 'plugins', 'S.jar'))).toBe(true);
    expect(existsSync(join(dataDir, 'sbsrv'))).toBe(false);
  });
});

describe('ServerKernel R 类任务行为不变 + 确认请求形状', () => {
  it('R 类任务不触发 confirm，read_logs/read_config 仍正常', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'r1');
    let called = 0;
    const kernel = new ServerKernel({
      dataDir,
      confirm: () => {
        called++;
        return true;
      },
    });
    writeFileSync(join(dataDir, 'r1', 'logs', 'latest.log'), '[boot] Done\n', 'utf8');
    const logs = await kernel
      .dispatch({ id: 'r2', kind: 'read_logs', payload: { serverId: 'r1' } })
      .result();
    expect(logs.ok).toBe(true);
    expect((logs.data as { tail: string[] }).tail[0]).toBe('[boot] Done');
    const cfg = await kernel
      .dispatch({ id: 'r3', kind: 'read_config', payload: { serverId: 'r1' } })
      .result();
    expect((cfg.data as { text: string }).text).toContain('motd=test');
    expect(called).toBe(0);
  });

  it('create_instance 确认请求含中文summary + risk=execute', async () => {
    const dataDir = mkTmp();
    let summary = '';
    let risk = '';
    await new ServerKernel({
      dataDir,
      confirm: (req) => {
        summary = req.summary;
        risk = req.risk;
        return false;
      },
    })
      .dispatch({ id: 'r4', kind: 'create_instance', payload: CREATE_PAYLOAD })
      .result();
    expect(risk).toBe('execute');
    expect(summary).toContain('srv1');
    expect(summary).toContain('eula.txt');
  });

  it('confirm 抛异常 → 按未确认处理', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({
      dataDir,
      confirm: () => {
        throw new Error('boom');
      },
    })
      .dispatch({ id: 'r5', kind: 'create_instance', payload: CREATE_PAYLOAD })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'srv1'))).toBe(false);
  });

  it('未知 kind 仍返回 unknown 分类', async () => {
    const result = await new ServerKernel({ confirm: YES })
      .dispatch({ id: 'r6', kind: 'nope_xyz', payload: null })
      .result();
    expect(result).toEqual({
      ok: false,
      error: { category: 'unknown', message: '不支持的任务: nope_xyz', retryable: false },
    });
  });
});

describe('ServerKernel build_project 产物验证（step 2.5，接 devkit.validateArtifact）', () => {
  it('构建成功 → data.validation 存在，sandboxDir 在 root 内', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bp-val1', kind: 'build_project', payload: { projectDir, timeoutMs: 20000 } })
      .result();
    expect(result.ok).toBe(true);
    const validation = (result.data as { validation?: Record<string, unknown> }).validation as {
      ok: boolean;
      timedOut: boolean;
      log: string;
      enforced: Record<string, unknown>;
      sandboxDir: string;
    };
    expect(validation).toBeDefined();
    expect(validation.ok).toBe(true);
    expect(validation.timedOut).toBe(false);
    expect(typeof validation.log).toBe('string');
    // log 只取尾 20 行
    expect(validation.log.split('\n').length).toBeLessThanOrEqual(20);
    expect(validation.enforced).toMatchObject({ network: false });
    expect(typeof validation.sandboxDir).toBe('string');
    expect(validation.sandboxDir.startsWith(dataDir)).toBe(true);
    // data.isolation 保持原样（仍是构建隔离的映射），验证字段是新增的 validation
    expect((result.data as { isolation?: unknown }).isolation).toBeDefined();
  });

  it('验证失败不推翻构建成功 → ok:true 但 validation.ok=false', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    // 经模块命名空间替换一次 validateArtifact（动态 import 取同一模块实例，
    // 不动文件顶部既有 import；单次生效后 restore，不影响其他用例）。
    const { vi: vitestVi } = await import('vitest');
    const devkit = await import('@mc-creator/devkit');
    const spy = vitestVi.spyOn(devkit, 'validateArtifact').mockResolvedValueOnce({
      ok: false,
      log: 'artifact unreadable: mock failure',
      timedOut: false,
      enforced: {
        source: 'unisolated',
        memory: false,
        cpu: false,
        network: false,
        treeKill: false,
        reason: 'mock-validation-failure',
      },
      sandboxDir: join(dataDir, 'validate-mock'),
    });
    try {
      const result = await new ServerKernel({ dataDir, confirm: YES })
        .dispatch({
          id: 'bp-val2',
          kind: 'build_project',
          payload: { projectDir, timeoutMs: 20000 },
        })
        .result();
      expect(result.ok).toBe(true);
      const validation = (result.data as { validation?: Record<string, unknown> }).validation as {
        ok: boolean;
        log: string;
      };
      expect(validation).toBeDefined();
      expect(validation.ok).toBe(false);
      expect(validation.log).toMatch(/mock failure/);
    } finally {
      spy.mockRestore();
    }
  });
});
