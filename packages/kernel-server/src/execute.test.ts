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

describe('ServerKernel §7.4 快照备份确认闸门（W 级，未确认零副作用）', () => {
  it('四种快照 kind 未传 confirm → permission + backups/ 未创建', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'bk0');
    const kernel = new ServerKernel({ dataDir });
    const cases = [
      { kind: 'backup_server', payload: { serverId: 'bk0' } },
      { kind: 'list_backups', payload: { serverId: 'bk0' } },
      { kind: 'restore_backup', payload: { serverId: 'bk0', backupId: 'x' } },
      { kind: 'prune_backups', payload: { serverId: 'bk0', keepN: 1 } },
    ] as const;
    for (const [i, c] of cases.entries()) {
      const result = await kernel
        .dispatch({ id: `bk-gate-${i}`, kind: c.kind, payload: c.payload })
        .result();
      expect(result.error?.category).toBe('permission');
      expect(result.data).toMatchObject({ confirmRequired: true });
    }
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
  });

  it('confirm 返回 false → 拒绝且不落快照', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'bk0b');
    const result = await new ServerKernel({ dataDir, confirm: NO })
      .dispatch({ id: 'bk-gate-no', kind: 'backup_server', payload: { serverId: 'bk0b' } })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
  });
});

describe('ServerKernel §7.4 快照备份全链（快照→列表→恢复→裁剪）', () => {
  /** 在既有 seedServer 基础上补 world 文件 + yml + 日志，模拟真实服务端。 */
  function seedFull(dataDir: string, name: string): string {
    const dir = seedServer(dataDir, name);
    writeFileSync(join(dir, 'world', 'level.dat'), 'level-bytes');
    mkdirSync(join(dir, 'world', 'region'), { recursive: true });
    writeFileSync(join(dir, 'world', 'region', 'r.0.0.mca'), 'region-bytes');
    writeFileSync(join(dir, 'bukkit.yml'), 'spawn-limits:\n  monsters: 70\n', 'utf8');
    writeFileSync(join(dir, 'logs', 'latest.log'), 'log-line\n', 'utf8');
    return dir;
  }

  interface BackupData {
    serverId: string;
    backupId: string;
    path: string;
    createdAt: string;
    files: { path: string; sha256: string; size: number }[];
    sha256: string;
  }

  it('backup_server → 落盘 world + properties/yml + manifest，排除 logs/', async () => {
    const dataDir = mkTmp();
    seedFull(dataDir, 'bk1');
    const result = await new ServerKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'bk-a1', kind: 'backup_server', payload: { serverId: 'bk1' } })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as BackupData;
    expect(data.serverId).toBe('bk1');
    expect(data.backupId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.path).toBe(join(dataDir, 'backups', 'bk1', data.backupId));
    const paths = data.files.map((f) => f.path);
    expect(paths).toContain('world/level.dat');
    expect(paths).toContain('world/region/r.0.0.mca');
    expect(paths).toContain('server.properties');
    expect(paths).toContain('bukkit.yml');
    expect(paths.some((p) => p.startsWith('logs/'))).toBe(false);
    for (const f of data.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    // 物理落盘一致 + manifest.json 自描述
    expect(readFileSync(join(data.path, 'world', 'level.dat'), 'utf8')).toBe('level-bytes');
    expect(existsSync(join(data.path, 'logs'))).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(data.path, 'manifest.json'), 'utf8'),
    ) as BackupData & { createdAt: string };
    expect(manifest.createdAt).toBe(data.createdAt);
    expect(manifest.sha256).toBe(data.sha256);
    expect(manifest.files).toHaveLength(data.files.length);
  });

  it('list_backups → 列出快照；restore_backup → 拷回并建议 restart（不自动重启）', async () => {
    const dataDir = mkTmp();
    const dir = seedFull(dataDir, 'bk2');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const snap = await kernel
      .dispatch({ id: 'bk-b1', kind: 'backup_server', payload: { serverId: 'bk2' } })
      .result();
    const backupId = (snap.data as BackupData).backupId;

    const list = await kernel
      .dispatch({ id: 'bk-b2', kind: 'list_backups', payload: { serverId: 'bk2' } })
      .result();
    expect(list.ok).toBe(true);
    const backups = (list.data as { backups: { backupId: string; sha256: string }[] }).backups;
    expect(backups).toHaveLength(1);
    expect(backups[0]?.backupId).toBe(backupId);
    expect(backups[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

    // 篡改线上世界与配置，再恢复
    writeFileSync(join(dir, 'world', 'level.dat'), 'MUTATED');
    writeFileSync(join(dir, 'server.properties'), 'motd=hacked\n');
    const restore = await kernel
      .dispatch({
        id: 'bk-b3',
        kind: 'restore_backup',
        payload: { serverId: 'bk2', backupId },
      })
      .result();
    expect(restore.ok).toBe(true);
    expect(restore.data).toMatchObject({ controlCommand: 'restart' });
    expect((restore.data as { note: string }).note).toMatch(/未自动重启/);
    expect(readFileSync(join(dir, 'world', 'level.dat'), 'utf8')).toBe('level-bytes');
    expect(readFileSync(join(dir, 'server.properties'), 'utf8')).toContain('motd=test');
  });

  it('prune_backups → 按 keepN 裁最旧，保留最新', async () => {
    const dataDir = mkTmp();
    seedFull(dataDir, 'bk3');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const first = (
      await kernel
        .dispatch({ id: 'bk-c1', kind: 'backup_server', payload: { serverId: 'bk3' } })
        .result()
    ).data as BackupData;
    const second = (
      await kernel
        .dispatch({ id: 'bk-c2', kind: 'backup_server', payload: { serverId: 'bk3' } })
        .result()
    ).data as BackupData;
    expect(second.backupId).not.toBe(first.backupId);
    const prune = await kernel
      .dispatch({ id: 'bk-c3', kind: 'prune_backups', payload: { serverId: 'bk3', keepN: 1 } })
      .result();
    expect(prune.ok).toBe(true);
    expect(prune.data).toMatchObject({
      keepN: 1,
      kept: [second.backupId],
      pruned: [first.backupId],
    });
    expect(existsSync(join(dataDir, 'backups', 'bk3', first.backupId))).toBe(false);
    expect(existsSync(join(dataDir, 'backups', 'bk3', second.backupId))).toBe(true);
    const list = await kernel
      .dispatch({ id: 'bk-c4', kind: 'list_backups', payload: { serverId: 'bk3' } })
      .result();
    expect((list.data as { backups: unknown[] }).backups).toHaveLength(1);
  });

  it('prune_backups 缺 keepN → 默认保留 5', async () => {
    const dataDir = mkTmp();
    seedFull(dataDir, 'bk4');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    for (let i = 0; i < 6; i++) {
      const r = await kernel
        .dispatch({ id: `bk-d${i}`, kind: 'backup_server', payload: { serverId: 'bk4' } })
        .result();
      expect(r.ok).toBe(true);
    }
    const prune = await kernel
      .dispatch({ id: 'bk-dp', kind: 'prune_backups', payload: { serverId: 'bk4' } })
      .result();
    expect(prune.ok).toBe(true);
    expect((prune.data as { keepN: number }).keepN).toBe(5);
    expect((prune.data as { kept: unknown[] }).kept).toHaveLength(5);
    expect((prune.data as { pruned: unknown[] }).pruned).toHaveLength(1);
  });
});

describe('ServerKernel §7.4 快照备份 sandbox 隔离', () => {
  it('mode=sandbox → 快照读写全走 sandbox root，dataDir 无痕迹', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    const dir = seedServer(sandboxDir, 'sbbk');
    writeFileSync(join(dir, 'world', 'level.dat'), 'sandbox-level');
    const kernel = new ServerKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });

    const snap = await kernel
      .dispatch({ id: 'sb-bk1', kind: 'backup_server', payload: { serverId: 'sbbk' } })
      .result();
    expect(snap.ok).toBe(true);
    const backupId = (snap.data as { backupId: string }).backupId;
    expect(existsSync(join(sandboxDir, 'backups', 'sbbk', backupId, 'manifest.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);

    writeFileSync(join(dir, 'world', 'level.dat'), 'MUTATED');
    const restore = await kernel
      .dispatch({ id: 'sb-bk2', kind: 'restore_backup', payload: { serverId: 'sbbk', backupId } })
      .result();
    expect(restore.ok).toBe(true);
    expect(readFileSync(join(dir, 'world', 'level.dat'), 'utf8')).toBe('sandbox-level');
    expect(existsSync(join(dataDir, 'sbbk'))).toBe(false);
  });
});

describe('ServerKernel §7.4 快照备份越界与参数拒绝', () => {
  it('serverId="../../evil" → validation，外部文件未动', async () => {
    const dataDir = mkTmp();
    const victim = join(dataDir, 'evil');
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, 'keep.txt'), 'keep');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    for (const [i, task] of [
      { kind: 'backup_server', payload: { serverId: '../../evil' } },
      { kind: 'list_backups', payload: { serverId: '../../evil' } },
      { kind: 'restore_backup', payload: { serverId: '../../evil', backupId: 'x' } },
      { kind: 'prune_backups', payload: { serverId: '../../evil' } },
    ].entries()) {
      const result = await kernel
        .dispatch({ id: `bk-x${i}`, kind: task.kind, payload: task.payload })
        .result();
      expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    }
    expect(readFileSync(join(victim, 'keep.txt'), 'utf8')).toBe('keep');
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
  });

  it('服务端不存在 → SERVER_NOT_FOUND；快照不存在 → BACKUP_NOT_FOUND', async () => {
    const dataDir = mkTmp();
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const missing = await kernel
      .dispatch({ id: 'bk-y1', kind: 'backup_server', payload: { serverId: 'ghost' } })
      .result();
    expect(missing).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SERVER_NOT_FOUND' },
    });
    const listGhost = await kernel
      .dispatch({ id: 'bk-y2', kind: 'list_backups', payload: { serverId: 'ghost' } })
      .result();
    expect(listGhost).toMatchObject({ ok: false, error: { category: 'validation' } });

    seedServer(dataDir, 'bk5');
    const noSnap = await kernel
      .dispatch({
        id: 'bk-y3',
        kind: 'restore_backup',
        payload: { serverId: 'bk5', backupId: 'no-such-snap' },
      })
      .result();
    expect(noSnap).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'BACKUP_NOT_FOUND' },
    });
    const badId = await kernel
      .dispatch({
        id: 'bk-y4',
        kind: 'restore_backup',
        payload: { serverId: 'bk5', backupId: '../bk5' },
      })
      .result();
    expect(badId).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('缺参数 → validation（缺 serverId / 缺 backupId / keepN 非法）', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'bk6');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const noId = await kernel
      .dispatch({ id: 'bk-z1', kind: 'backup_server', payload: {} })
      .result();
    expect(noId).toMatchObject({ ok: false, error: { category: 'validation' } });
    const noSnapId = await kernel
      .dispatch({ id: 'bk-z2', kind: 'restore_backup', payload: { serverId: 'bk6' } })
      .result();
    expect(noSnapId).toMatchObject({ ok: false, error: { category: 'validation' } });
    for (const [i, keepN] of [-1, 1.5].entries()) {
      const badKeep = await kernel
        .dispatch({ id: `bk-z3${i}`, kind: 'prune_backups', payload: { serverId: 'bk6', keepN } })
        .result();
      expect(badKeep).toMatchObject({ ok: false, error: { category: 'validation' } });
    }
  });
});

/** 假脚本：产 jar + 把构建进程看到的 JAVA_HOME 写进 java_home.txt（断言 env 透传用）。 */
function fakeJavaHomeScript(jars: string[]): string {
  if (IS_WIN) {
    return (
      '@echo off\r\nmkdir build\\libs 2>nul\r\n' +
      jars.map((j) => `echo fake> build\\libs\\${j}\r\n`).join('') +
      'echo %JAVA_HOME%> java_home.txt\r\n' +
      'exit /b 0\r\n'
    );
  }
  return `#!/bin/sh\nmkdir -p build/libs\n${jars.map((j) => `echo fake > build/libs/${j}\n`).join('')}echo "$JAVA_HOME" > java_home.txt\nexit 0\n`;
}

describe('ServerKernel build_project JDK 自动下载 opt-in（§8.1#1）', () => {
  it('关：不带 mcVersion → 不触发下载，行为不变且 runtimes/ 未创建', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeBuildScript(['demo-1.0.jar']));
    const { vi: vitestVi } = await import('vitest');
    const devkit = await import('@mc-creator/devkit');
    const spy = vitestVi.spyOn(devkit, 'ensureJdk');
    try {
      const result = await new ServerKernel({ dataDir, confirm: YES })
        .dispatch({
          id: 'jdk-off1',
          kind: 'build_project',
          payload: { projectDir, timeoutMs: 20000 },
        })
        .result();
      expect(result.ok).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      expect(existsSync(join(dataDir, 'runtimes'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('开：带 mcVersion 且无 javaHome → 下载并用其 JAVA_HOME 构建', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeJavaHomeScript(['demo-1.0.jar']));
    const fakeJavaHome = join(mkTmp(), 'jdk-21');
    mkdirSync(fakeJavaHome, { recursive: true });
    const { vi: vitestVi } = await import('vitest');
    const devkit = await import('@mc-creator/devkit');
    const spy = vitestVi.spyOn(devkit, 'ensureJdk').mockResolvedValueOnce({
      javaHome: fakeJavaHome,
      source: 'download' as const,
    });
    try {
      const result = await new ServerKernel({ dataDir, confirm: YES })
        .dispatch({
          id: 'jdk-on1',
          kind: 'build_project',
          payload: { projectDir, timeoutMs: 20000, mcVersion: '1.21.4' },
        })
        .result();
      expect(result.ok).toBe(true);
      // mcVersion 1.21.4 → JDK 21；缓存目录为 <root>/runtimes。
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toMatchObject({
        version: 21,
        cacheDir: join(dataDir, 'runtimes'),
      });
      // 构建进程实际看到的 JAVA_HOME 就是下载返回的 javaHome（env 透传被覆盖）。
      expect(readFileSync(join(projectDir, 'java_home.txt'), 'utf8').trim()).toBe(fakeJavaHome);
    } finally {
      spy.mockRestore();
    }
  });

  it('开但显式给了 javaHome → 不下载，直接用给定值', async () => {
    const dataDir = mkTmp();
    const projectDir = makeFakeProject(dataDir, 'proj', fakeJavaHomeScript(['demo-1.0.jar']));
    const { vi: vitestVi } = await import('vitest');
    const devkit = await import('@mc-creator/devkit');
    const spy = vitestVi.spyOn(devkit, 'ensureJdk');
    try {
      const result = await new ServerKernel({ dataDir, confirm: YES })
        .dispatch({
          id: 'jdk-on2',
          kind: 'build_project',
          payload: {
            projectDir,
            timeoutMs: 20000,
            mcVersion: '1.21.4',
            javaHome: 'C:\\explicit\\jdk-21',
          },
        })
        .result();
      expect(result.ok).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      expect(readFileSync(join(projectDir, 'java_home.txt'), 'utf8').trim()).toBe(
        'C:\\explicit\\jdk-21',
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ServerKernel §7.4 定时账本：确认闸门与参数拒绝', () => {
  it('schedule_task/cancel_task 未传 confirm → permission，账本未创建', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'ts1');
    const kernel = new ServerKernel({ dataDir });
    const s = await kernel
      .dispatch({
        id: 'ts-g1',
        kind: 'schedule_task',
        payload: { serverId: 'ts1', action: 'backup', runAt: '2026-01-01T00:00:00.000Z' },
      })
      .result();
    expect(s.error?.category).toBe('permission');
    expect(s.data).toMatchObject({ confirmRequired: true });
    const c = await kernel
      .dispatch({ id: 'ts-g2', kind: 'cancel_task', payload: { taskId: 'task-x' } })
      .result();
    expect(c.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'server-tasks'))).toBe(false);
  });

  it('confirm 返回 false → 拒绝且不写账本', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'ts1b');
    const result = await new ServerKernel({ dataDir, confirm: NO })
      .dispatch({
        id: 'ts-g3',
        kind: 'schedule_task',
        payload: { serverId: 'ts1b', action: 'stop', runAt: '2026-01-01T00:00:00.000Z' },
      })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'server-tasks'))).toBe(false);
  });

  it('list_tasks/run_due_tasks 不触发 confirm（R 级）', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'tsr');
    let called = 0;
    const kernel = new ServerKernel({
      dataDir,
      confirm: () => {
        called++;
        return true;
      },
    });
    const list = await kernel.dispatch({ id: 'ts-r1', kind: 'list_tasks', payload: {} }).result();
    expect(list.ok).toBe(true);
    const due = await kernel.dispatch({ id: 'ts-r2', kind: 'run_due_tasks', payload: {} }).result();
    expect(due.ok).toBe(true);
    expect(called).toBe(0);
  });

  it('schedule 缺参/非法 → validation（action 非法/broadcast 缺 message/二选一缺失/非法时间）', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'tsv');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const badAction = await kernel
      .dispatch({
        id: 'ts-v1',
        kind: 'schedule_task',
        payload: { serverId: 'tsv', action: 'reboot', runAt: '2026-01-01T00:00:00.000Z' },
      })
      .result();
    expect(badAction).toMatchObject({ ok: false, error: { category: 'validation' } });
    const noMsg = await kernel
      .dispatch({
        id: 'ts-v2',
        kind: 'schedule_task',
        payload: { serverId: 'tsv', action: 'broadcast', runAt: '2026-01-01T00:00:00.000Z' },
      })
      .result();
    expect(noMsg).toMatchObject({ ok: false, error: { category: 'validation' } });
    const neither = await kernel
      .dispatch({
        id: 'ts-v3',
        kind: 'schedule_task',
        payload: { serverId: 'tsv', action: 'backup' },
      })
      .result();
    expect(neither).toMatchObject({ ok: false, error: { category: 'validation' } });
    const badTime = await kernel
      .dispatch({
        id: 'ts-v4',
        kind: 'schedule_task',
        payload: { serverId: 'tsv', action: 'backup', runAt: 'not-a-time' },
      })
      .result();
    expect(badTime).toMatchObject({ ok: false, error: { category: 'validation' } });
    const badInterval = await kernel
      .dispatch({
        id: 'ts-v5',
        kind: 'schedule_task',
        payload: { serverId: 'tsv', action: 'backup', intervalMs: -5 },
      })
      .result();
    expect(badInterval).toMatchObject({ ok: false, error: { category: 'validation' } });
    const badNow = await kernel
      .dispatch({ id: 'ts-v6', kind: 'run_due_tasks', payload: { now: 'nope' } })
      .result();
    expect(badNow).toMatchObject({ ok: false, error: { category: 'validation' } });
    const noTaskId = await kernel
      .dispatch({ id: 'ts-v7', kind: 'cancel_task', payload: {} })
      .result();
    expect(noTaskId).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('服务端不存在 → SERVER_NOT_FOUND；cancel 不存在 → TASK_NOT_FOUND', async () => {
    const dataDir = mkTmp();
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const missing = await kernel
      .dispatch({
        id: 'ts-n1',
        kind: 'schedule_task',
        payload: { serverId: 'ghost', action: 'backup', runAt: '2026-01-01T00:00:00.000Z' },
      })
      .result();
    expect(missing).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'SERVER_NOT_FOUND' },
    });
    const cancelGhost = await kernel
      .dispatch({ id: 'ts-n2', kind: 'cancel_task', payload: { taskId: 'task-nope' } })
      .result();
    expect(cancelGhost).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'TASK_NOT_FOUND' },
    });
  });
});

describe('ServerKernel §7.4 定时账本：调度→到期→done/interval', () => {
  it('一次性 backup：调度→注入 now 触发文件动作→done 不重发', async () => {
    const dataDir = mkTmp();
    const dir = seedServer(dataDir, 'td1');
    writeFileSync(join(dir, 'world', 'level.dat'), 'level-bytes');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const sched = await kernel
      .dispatch({
        id: 'td-a1',
        kind: 'schedule_task',
        payload: { serverId: 'td1', action: 'backup', runAt: '2026-01-01T00:00:00.000Z' },
      })
      .result();
    expect(sched.ok).toBe(true);
    const taskId = (sched.data as { taskId: string }).taskId;
    expect(taskId).toMatch(/^task-/);
    expect((sched.data as { nextRun: string }).nextRun).toBe('2026-01-01T00:00:00.000Z');
    // 账本落盘且无 tmp 残留
    expect(existsSync(join(dataDir, 'server-tasks', 'tasks.json'))).toBe(true);

    // 未到期不触发
    const early = await kernel
      .dispatch({
        id: 'td-a2',
        kind: 'run_due_tasks',
        payload: { now: '2025-12-31T23:00:00.000Z' },
      })
      .result();
    expect(early.ok).toBe(true);
    expect((early.data as { fired: unknown[] }).fired).toEqual([]);

    // 到期触发：backup 文件动作真实落盘
    const fired = await kernel
      .dispatch({
        id: 'td-a3',
        kind: 'run_due_tasks',
        payload: { now: '2026-01-01T00:00:01.000Z' },
      })
      .result();
    expect(fired.ok).toBe(true);
    const entries = (
      fired.data as {
        fired: {
          taskId: string;
          serverId: string;
          action: string;
          result: { backupId: string; path: string };
        }[];
      }
    ).fired;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.taskId).toBe(taskId);
    expect(entries[0]?.action).toBe('backup');
    expect(entries[0]?.result.backupId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(join(entries[0]?.result.path ?? '', 'manifest.json'))).toBe(true);

    // 一次性 done 不重发
    const again = await kernel
      .dispatch({
        id: 'td-a4',
        kind: 'run_due_tasks',
        payload: { now: '2026-01-01T05:00:00.000Z' },
      })
      .result();
    expect((again.data as { fired: unknown[] }).fired).toEqual([]);
    const list = await kernel.dispatch({ id: 'td-a5', kind: 'list_tasks', payload: {} }).result();
    const tasks = (list.data as { tasks: { taskId: string; status: string }[] }).tasks;
    expect(tasks.find((t) => t.taskId === taskId)?.status).toBe('done');
  });

  it('interval 任务执行后 nextRun=now+intervalMs 写回并可再次触发', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'td2');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const sched = await kernel
      .dispatch({
        id: 'td-b1',
        kind: 'schedule_task',
        payload: {
          serverId: 'td2',
          action: 'stop',
          runAt: '2026-01-01T00:00:00.000Z',
          intervalMs: 3600000,
        },
      })
      .result();
    const taskId = (sched.data as { taskId: string }).taskId;
    const first = await kernel
      .dispatch({
        id: 'td-b2',
        kind: 'run_due_tasks',
        payload: { now: '2026-01-01T00:30:00.000Z' },
      })
      .result();
    const f1 = (first.data as { fired: { taskId: string; controlCommand: string }[] }).fired;
    expect(f1).toHaveLength(1);
    expect(f1[0]?.controlCommand).toBe('stop');
    // nextRun 已推进为 now+interval
    const listed = await kernel.dispatch({ id: 'td-b3', kind: 'list_tasks', payload: {} }).result();
    const task = (
      listed.data as { tasks: { taskId: string; nextRun: string; intervalMs: number }[] }
    ).tasks.find((t) => t.taskId === taskId);
    expect(task?.nextRun).toBe('2026-01-01T01:30:00.000Z');
    expect(task?.intervalMs).toBe(3600000);
    // 推进前不重发，推进后再次触发
    const quiet = await kernel
      .dispatch({
        id: 'td-b4',
        kind: 'run_due_tasks',
        payload: { now: '2026-01-01T01:00:00.000Z' },
      })
      .result();
    expect((quiet.data as { fired: unknown[] }).fired).toEqual([]);
    const second = await kernel
      .dispatch({
        id: 'td-b5',
        kind: 'run_due_tasks',
        payload: { now: '2026-01-01T01:30:00.000Z' },
      })
      .result();
    expect((second.data as { fired: unknown[] }).fired).toHaveLength(1);
  });

  it('restart 到期只返回控制指令待办（不启进程）', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'td3');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const sched = await kernel
      .dispatch({
        id: 'td-c1',
        kind: 'schedule_task',
        payload: { serverId: 'td3', action: 'restart', runAt: '2026-02-01T00:00:00.000Z' },
      })
      .result();
    const taskId = (sched.data as { taskId: string }).taskId;
    const due = await kernel
      .dispatch({
        id: 'td-c2',
        kind: 'run_due_tasks',
        payload: { now: '2026-02-01T00:00:01.000Z' },
      })
      .result();
    const fired = (
      due.data as {
        fired: { taskId: string; serverId: string; action: string; controlCommand: string }[];
      }
    ).fired;
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      taskId,
      serverId: 'td3',
      action: 'restart',
      controlCommand: 'restart',
    });
  });

  it('broadcast 到期只返回 {action,message} 待办，不经内核发送', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'td4');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const sched = await kernel
      .dispatch({
        id: 'td-d1',
        kind: 'schedule_task',
        payload: {
          serverId: 'td4',
          action: 'broadcast',
          message: 'hello players',
          runAt: '2026-03-01T00:00:00.000Z',
        },
      })
      .result();
    const taskId = (sched.data as { taskId: string }).taskId;
    const due = await kernel
      .dispatch({
        id: 'td-d2',
        kind: 'run_due_tasks',
        payload: { now: '2026-03-01T00:00:01.000Z' },
      })
      .result();
    const fired = (
      due.data as { fired: { taskId: string; serverId: string; action: string; message: string }[] }
    ).fired;
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      taskId,
      serverId: 'td4',
      action: 'broadcast',
      message: 'hello players',
    });
    // 内核未写任何业务文件（logs/ 未被触碰）
    expect(existsSync(join(dataDir, 'td4', 'logs', 'latest.log'))).toBe(false);
  });

  it('cancel 幂等：首次 ok 移除，再次 TASK_NOT_FOUND；list_tasks 按 serverId 过滤', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'td5a');
    seedServer(dataDir, 'td5b');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const s1 = await kernel
      .dispatch({
        id: 'td-e1',
        kind: 'schedule_task',
        payload: { serverId: 'td5a', action: 'stop', runAt: '2026-04-01T00:00:00.000Z' },
      })
      .result();
    const t1 = (s1.data as { taskId: string }).taskId;
    const s2 = await kernel
      .dispatch({
        id: 'td-e2',
        kind: 'schedule_task',
        payload: { serverId: 'td5b', action: 'stop', runAt: '2026-04-01T00:00:00.000Z' },
      })
      .result();
    const t2 = (s2.data as { taskId: string }).taskId;
    const all = await kernel.dispatch({ id: 'td-e3', kind: 'list_tasks', payload: {} }).result();
    expect((all.data as { tasks: unknown[] }).tasks).toHaveLength(2);
    const filtered = await kernel
      .dispatch({ id: 'td-e4', kind: 'list_tasks', payload: { serverId: 'td5a' } })
      .result();
    const ft = (filtered.data as { tasks: { taskId: string }[] }).tasks;
    expect(ft).toHaveLength(1);
    expect(ft[0]?.taskId).toBe(t1);
    const cancel = await kernel
      .dispatch({ id: 'td-e5', kind: 'cancel_task', payload: { taskId: t1 } })
      .result();
    expect(cancel.ok).toBe(true);
    const after = await kernel.dispatch({ id: 'td-e6', kind: 'list_tasks', payload: {} }).result();
    expect((after.data as { tasks: { taskId: string }[] }).tasks.map((t) => t.taskId)).toEqual([
      t2,
    ]);
    // 到期只剩 t2
    const due = await kernel
      .dispatch({
        id: 'td-e7',
        kind: 'run_due_tasks',
        payload: { now: '2026-04-01T00:00:01.000Z' },
      })
      .result();
    expect((due.data as { fired: { taskId: string }[] }).fired.map((f) => f.taskId)).toEqual([t2]);
    // 幂等：再次取消同一 taskId → TASK_NOT_FOUND
    const recancel = await kernel
      .dispatch({ id: 'td-e8', kind: 'cancel_task', payload: { taskId: t1 } })
      .result();
    expect(recancel).toMatchObject({
      ok: false,
      error: { category: 'validation', code: 'TASK_NOT_FOUND' },
    });
  });

  it('run_due_tasks 无到期返回 fired:[]（空账本亦如此）', async () => {
    const dataDir = mkTmp();
    seedServer(dataDir, 'td6');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    const empty = await kernel
      .dispatch({
        id: 'td-f1',
        kind: 'run_due_tasks',
        payload: { now: '2026-05-01T00:00:00.000Z' },
      })
      .result();
    expect(empty).toMatchObject({ ok: true, data: { fired: [] } });
    await kernel
      .dispatch({
        id: 'td-f2',
        kind: 'schedule_task',
        payload: { serverId: 'td6', action: 'stop', runAt: '2026-06-01T00:00:00.000Z' },
      })
      .result();
    const early = await kernel
      .dispatch({
        id: 'td-f3',
        kind: 'run_due_tasks',
        payload: { now: '2026-05-01T00:00:00.000Z' },
      })
      .result();
    expect((early.data as { fired: unknown[] }).fired).toEqual([]);
  });
});

describe('ServerKernel §7.4 定时账本 sandbox 隔离与越界拒绝', () => {
  it('mode=sandbox → 账本走 sandbox root，dataDir 无痕迹', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    seedServer(sandboxDir, 'sbtd');
    const kernel = new ServerKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });
    const sched = await kernel
      .dispatch({
        id: 'sb-t1',
        kind: 'schedule_task',
        payload: {
          serverId: 'sbtd',
          action: 'broadcast',
          message: 'hi',
          runAt: '2026-07-01T00:00:00.000Z',
        },
      })
      .result();
    expect(sched.ok).toBe(true);
    expect(existsSync(join(sandboxDir, 'server-tasks', 'tasks.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'server-tasks'))).toBe(false);
    const list = await kernel.dispatch({ id: 'sb-t2', kind: 'list_tasks', payload: {} }).result();
    expect((list.data as { tasks: unknown[] }).tasks).toHaveLength(1);
    const due = await kernel
      .dispatch({
        id: 'sb-t3',
        kind: 'run_due_tasks',
        payload: { now: '2026-07-01T00:00:01.000Z' },
      })
      .result();
    expect((due.data as { fired: unknown[] }).fired).toHaveLength(1);
    expect(existsSync(join(dataDir, 'sbtd'))).toBe(false);
  });

  it('serverId 越界 → validation，外部文件未动且无账本', async () => {
    const dataDir = mkTmp();
    const victim = join(dataDir, 'evil');
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, 'keep.txt'), 'keep');
    const kernel = new ServerKernel({ dataDir, confirm: YES });
    for (const [i, payload] of [
      { serverId: '../../evil', action: 'backup', runAt: '2026-01-01T00:00:00.000Z' },
      { serverId: '../evil', action: 'stop', intervalMs: 1000 },
    ].entries()) {
      const result = await kernel
        .dispatch({ id: `sb-x${i}`, kind: 'schedule_task', payload })
        .result();
      expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    }
    expect(readFileSync(join(victim, 'keep.txt'), 'utf8')).toBe('keep');
    // 越界未落账本（或账本仍空）
    if (existsSync(join(dataDir, 'server-tasks', 'tasks.json'))) {
      const listed = await kernel
        .dispatch({ id: 'sb-x-list', kind: 'list_tasks', payload: {} })
        .result();
      expect((listed.data as { tasks: unknown[] }).tasks).toHaveLength(0);
    } else {
      expect(existsSync(join(dataDir, 'server-tasks'))).toBe(false);
    }
    const badList = await kernel
      .dispatch({ id: 'sb-x3', kind: 'list_tasks', payload: { serverId: '../../evil' } })
      .result();
    expect(badList).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});
