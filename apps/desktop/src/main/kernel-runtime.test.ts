/**
 * 内核宿主接线测试（§4.2 / §10.2 / §10.6 / §14）。
 *
 * 覆盖任务书点名的四件事，外加几条「不改实现就会变红」的护栏：
 * 1. **构造**：三个内核被装配起来，dataDir 一致，只读 kind 真的能跑通；
 * 2. **dataDir 一致性**：runtime.dataDir 与 `resolveKernelRoot()` 与
 *    `path-manager.APP_DATA_DIR` 三者对齐；并且 `runStartupRecovery({ kernelRoot })`
 *    拿到的就是**同一个字符串** —— 实跑一次扫描，证明半成品实例确实被内核那份
 *    dataDir 认出来并隔离掉（这条防的是「两处各算一个路径」）；
 * 3. **释放**：dispose 之后任何 dispatch 返回结构化的 KERNEL_RUNTIME_DISPOSED；
 * 4. **§10.6 门控**：confirm 回调确实被内核调用；confirm=false 时内核不产生
 *    任何副作用（磁盘上一个字节都不多）。
 */

// path-manager 顶层 import electron，这里 mock 出一个最小的 app。
// 只用来读 APP_DATA_DIR 常量（生产里 kernelRoot 与全局目录同层，见 resolveKernelRoot）。
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\mock\\userData' },
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createKernelRuntime,
  getKernelRuntime,
  initKernelRuntime,
  setKernelRuntime,
  describeKernelKinds,
  permissionOf,
  riskOf,
  resolveKernelRoot,
  RESERVED_KERNEL_IDS,
  KERNEL_APP_DIR_NAME,
  KERNEL_ROOT_DIR_NAME,
  type KernelConfirmRequest,
  type KernelRuntime,
  type KernelRuntimeOptions,
} from './kernel-runtime.js';
import { runStartupRecovery } from './startup-recovery.js';
import { APP_DATA_DIR } from './path-manager.js';

const YES = (): boolean => true;
const NO = (): boolean => false;

let dirs: string[] = [];
let rt: KernelRuntime | null = null;

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-kernel-rt-'));
  dirs.push(dir);
  return dir;
}

function make(
  dataDir: string,
  confirm: (req: KernelConfirmRequest) => boolean | Promise<boolean>,
): KernelRuntime {
  const created = createKernelRuntime({ dataDir, confirm });
  rt = created;
  return created;
}

beforeEach(() => {
  dirs = [];
  rt = null;
  setKernelRuntime(null);
});

afterEach(async () => {
  rt?.dispose();
  setKernelRuntime(null);
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});

describe('resolveKernelRoot：内核数据根目录的取值', () => {
  it('落在 userData/mc-creator/kernel 三层下', () => {
    const root = resolveKernelRoot('C:\\Users\\x\\AppData\\mc-creator');
    expect(root).toBe(join('C:\\Users\\x\\AppData\\mc-creator', 'mc-creator', 'kernel'));
    expect(KERNEL_ROOT_DIR_NAME).toBe('kernel');
    expect(root.endsWith(join('mc-creator', 'kernel'))).toBe(true);
  });

  it('KERNEL_APP_DIR_NAME 必须与 path-manager.APP_DATA_DIR 一致（防各写各的）', () => {
    // 这条断言是本文件存在的理由之一：kernel-runtime 刻意不复用 path-manager 的常量
    // （复用会把 electron 拖进来，破坏可单测性），代价就是必须有人盯着两者不漂移。
    expect(KERNEL_APP_DIR_NAME).toBe(APP_DATA_DIR);
    expect(resolveKernelRoot('X').startsWith(join('X', APP_DATA_DIR))).toBe(true);
  });

  it('不与既有全局目录同级铺开：内核根比 mc-creator 深一层（避免 instances/ 撞名）', () => {
    const root = resolveKernelRoot('X');
    expect(root).not.toBe(join('X', APP_DATA_DIR));
    // GLOBAL_SERVERS_DIR / MC_LAUNCHER_DIR 是直接铺在 mc-creator 下（深一层），
    // 内核根再深一层（两层），这才容得下 instances/ 与 <serverId>/ 并存。
    expect(root.split(/[\\/]/).length).toBe('X'.split(/[\\/]/).length + 2);
  });
});

describe('createKernelRuntime：构造与 dataDir 一致性', () => {
  it('装配三个内核，edition 各自正确，且共用同一个 dataDir', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);
    expect(k.java.edition).toBe('java');
    expect(k.server.edition).toBe('server');
    expect(k.bedrock.edition).toBe('bedrock');
    expect(k.dataDir).toBe(dataDir);
    // 三个内核都从同一个根读：java 读 <root>/instances、server 读 <root>/<serverId>
    expect(k.mode).toBe('live');
  });

  it('get_capabilities 三个内核都能跑通，且 edition 真的改道（§10.2 强制第一步）', async () => {
    const k = make(await tmpRoot(), YES);
    for (const edition of ['java', 'server', 'bedrock'] as const) {
      const r = await k.runRead('get_capabilities', { edition });
      expect(r.ok).toBe(true);
      const data = r.data as { capabilities: unknown[] };
      expect(Array.isArray(data.capabilities)).toBe(true);
      expect(data.capabilities.length).toBeGreaterThan(0);
    }
    // 三张能力表内容不同 ⇒ edition 确实改道了，而不是三个都落到 java
    const [java, server, bedrock] = await Promise.all(
      (['java', 'server', 'bedrock'] as const).map(
        async (e) => (await k.runRead('get_capabilities', { edition: e })).data,
      ),
    );
    expect(JSON.stringify(java)).not.toBe(JSON.stringify(server));
    expect(JSON.stringify(java)).not.toBe(JSON.stringify(bedrock));
  });

  it('list_instances 读的就是 <dataDir>/instances，且目录不存在时返回空数组而非报错', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);
    const empty = await k.runRead('list_instances');
    expect(empty.ok).toBe(true);
    expect((empty.data as { instances: string[] }).instances).toEqual([]);

    await mkdir(join(dataDir, 'instances', 'alpha'), { recursive: true });
    await mkdir(join(dataDir, 'instances', 'beta'), { recursive: true });
    const listed = await k.runRead('list_instances');
    expect((listed.data as { instances: string[] }).instances).toEqual(['alpha', 'beta']);
  });

  it('dataDir 为空时只读任务退化而不是抛异常（内核既定语义）', async () => {
    const k = createKernelRuntime({ dataDir: '', confirm: YES });
    rt = k;
    const r = await k.runRead('list_instances');
    expect(r.ok).toBe(true);
    expect((r.data as { instances: string[] }).instances).toEqual([]);
  });

  it('单例：initKernelRuntime 幂等，getKernelRuntime 读到同一个，setKernelRuntime 可换', async () => {
    const dataDir = await tmpRoot();
    const a = initKernelRuntime({ dataDir, confirm: YES });
    const b = initKernelRuntime({ dataDir: join(dataDir, 'other'), confirm: NO });
    expect(b).toBe(a); // 幂等：已初始化时不再替换（否则 dataDir 会被悄悄改掉）
    expect(getKernelRuntime()).toBe(a);

    const c = make(join(dataDir, 'replacement'), NO);
    setKernelRuntime(c);
    expect(getKernelRuntime()).toBe(c);
  });

  it('未初始化时 getKernelRuntime 返回 null（不偷偷懒初始化）', () => {
    expect(getKernelRuntime()).toBeNull();
  });
});

describe('§14：kernelRoot 与内核 dataDir 必须是同一个字符串', () => {
  it('runtime.dataDir 就是 resolveKernelRoot 的输出，且实跑扫描能隔离出半成品实例', async () => {
    const userData = await tmpRoot();
    const dataDir = resolveKernelRoot(userData);
    const k = make(dataDir, YES);
    // 同一条字符串：不是「同一个目录」这种模糊说法，而是字面相等
    expect(k.dataDir).toBe(dataDir);
    expect(k.dataDir).toBe(join(userData, APP_DATA_DIR, 'kernel'));

    // 造一个「有目录、无 instance.json」的半成品（create_instance 崩在写 manifest 之前）
    await mkdir(join(dataDir, 'instances', 'half'), { recursive: true });
    await mkdir(join(dataDir, 'instances', 'good'), { recursive: true });
    await writeFile(
      join(dataDir, 'instances', 'good', 'instance.json'),
      JSON.stringify({ name: 'good', edition: 'java' }),
    );

    const report = runStartupRecovery({
      userDataDir: userData,
      kernelRoot: k.dataDir,
      apply: true,
    });
    expect(report.incompleteInstances.map((i) => i.name)).toEqual(['half']);
    expect(report.quarantined).toEqual(['half']);
    // 好的实例必须还在（不能连坐）
    expect(existsSync(join(dataDir, 'instances', 'good', 'instance.json'))).toBe(true);
    // 半成品已被移出 instances/ ⇒ list_instances 不再看到它（这正是「同一根」的意义）
    const listed = await k.runRead('list_instances');
    expect((listed.data as { instances: string[] }).instances).toEqual(['good']);
  });

  it('反证：若 kernelRoot 指向别处（两处各算一个路径），半成品就既扫不到也清不掉', async () => {
    const userData = await tmpRoot();
    const dataDir = resolveKernelRoot(userData);
    const k = make(dataDir, YES);
    await mkdir(join(dataDir, 'instances', 'half'), { recursive: true });

    const wrong = join(userData, 'mc-creator', 'somewhere-else');
    expect(wrong).not.toBe(k.dataDir);
    const report = runStartupRecovery({ userDataDir: userData, kernelRoot: wrong, apply: true });
    expect(report.incompleteInstances).toEqual([]);
    expect(report.quarantined).toEqual([]);
    // 但内核照样把它当成正常实例列出来 —— 半成品卡死实例的老问题原样存在
    const listed = await k.runRead('list_instances');
    expect((listed.data as { instances: string[] }).instances).toEqual(['half']);
  });

  it('半成品隔离发生在 whenReady 的清理阶段，所以 initKernelRuntime 必须早于扫描调用', async () => {
    // 这条不是在测实现细节，而是在把 index.ts 的调用顺序钉死：
    // getKernelRuntime()?.dataDir 为 undefined 时 runStartupRecovery 会静默跳过实例扫描。
    const userData = await tmpRoot();
    const dataDir = resolveKernelRoot(userData);
    await mkdir(join(dataDir, 'instances', 'half'), { recursive: true });

    setKernelRuntime(null);
    const beforeInit = runStartupRecovery({
      userDataDir: userData,
      kernelRoot: getKernelRuntime()?.dataDir,
    });
    expect(beforeInit.incompleteInstances).toEqual([]);

    const k = initKernelRuntime({ dataDir, confirm: YES });
    rt = k;
    const afterInit = runStartupRecovery({
      userDataDir: userData,
      kernelRoot: getKernelRuntime()?.dataDir,
      apply: true,
    });
    expect(afterInit.quarantined).toEqual(['half']);
    // 确认用的是同一个字符串而不是碰巧扫到同一个目录
    expect(getKernelRuntime()?.dataDir).toBe(k.dataDir);
  });
});

describe('§10.6 确认闸门', () => {
  it('create_instance（X 类）会问 confirm，请求带中文 summary 与 risk=execute', async () => {
    const dataDir = await tmpRoot();
    const seen: KernelConfirmRequest[] = [];
    const k = make(dataDir, (req) => {
      seen.push(req);
      return true;
    });

    const r = await k.runWrite('create_instance', { name: 'demo', versionId: '1.21.1' });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('create_instance');
    expect(seen[0].risk).toBe('execute');
    expect(seen[0].summary).toContain('demo');
    expect(seen[0].payload).toMatchObject({ name: 'demo' });
    // confirmLog 是审计出口：内核确实问过闸门
    expect(k.confirmLog()).toHaveLength(1);
    // 副作用真的落盘了（说明 confirm=true 之后才发生）
    expect(existsSync(join(dataDir, 'instances', 'demo', 'instance.json'))).toBe(true);
  });

  it('confirm=false → 内核拒绝，磁盘上一个字节都不多（闸门是真闸门，不是提示）', async () => {
    const dataDir = await tmpRoot();
    let calls = 0;
    const k = make(dataDir, () => {
      calls += 1;
      return false;
    });

    const r = await k.runWrite('create_instance', { name: 'denied', versionId: '1.21.1' });
    expect(calls).toBe(1);
    expect(k.confirmLog()).toHaveLength(1);
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe('permission');
    expect(r.error?.message).toContain('弹窗确认');
    expect(r.data).toEqual({ confirmRequired: true });
    expect(existsSync(join(dataDir, 'instances'))).toBe(false);
  });

  it('异步 confirm（Promise）同样被支持，拒绝时依旧零副作用', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, async () => false);
    const r = await k.runWrite('delete_instance', { instanceId: 'whatever' });
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'instances'))).toBe(false);
  });

  it('W 类 kind 同样问闸门，且 risk=write（§10.6「写实例目录」也须确认）', async () => {
    const dataDir = await tmpRoot();
    const seen: KernelConfirmRequest[] = [];
    const k = make(dataDir, (req) => {
      seen.push(req);
      return false;
    });
    // install_mod 需要真实 jar 文件，用一个不存在的路径：闸门先于任何文件访问被问到，
    // 于是 risk 一定停在 write，且不会因为文件缺失而变成别的分类。
    const r = await k.runWrite('install_mod', { mod: 'C:\\nope\\x.jar', instanceId: 'demo' });
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('install_mod');
    expect(seen[0].risk).toBe('write');
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe('permission');
  });

  it('R 类 kind 不问 confirm（只读免确认，§10.6）', async () => {
    const k = make(await tmpRoot(), () => {
      throw new Error('只读 kind 不该触发确认闸门');
    });
    const r = await k.runRead('get_capabilities', {});
    expect(r.ok).toBe(true);
    expect(k.confirmLog()).toHaveLength(0);
  });

  it('confirm 是必填项：省略它在编译期就失败（§10.6 闸门不允许「忘了接」）', async () => {
    const dataDir = await tmpRoot();
    // 这条测试的价值全在下面那句 @ts-expect-error：把它删掉，
    // `tsc -p tsconfig.node.json` 会立刻报 TS2578（未使用的 expect-error），
    // 也就是「KernelRuntimeOptions 允许没有 confirm」这个洞会被验收命令抓住。
    const opts = { dataDir };
    // @ts-expect-error confirm 必填
    const typed: KernelRuntimeOptions = opts;
    expect(typed.dataDir).toBe(dataDir);
  });
});

describe('runRead / runWrite 的白名单与路由', () => {
  it('runRead 拒绝 W/X kind，runWrite 拒绝 R kind（不靠内核报错，自己先拒）', async () => {
    const k = make(await tmpRoot(), YES);

    const readAttempt = await k.runRead('delete_instance', { instanceId: 'x' });
    expect(readAttempt.ok).toBe(false);
    expect(readAttempt.error?.code).toBe('KERNEL_KIND_NOT_ALLOWED');

    const writeAttempt = await k.runWrite('get_capabilities', {});
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.error?.code).toBe('KERNEL_KIND_NOT_ALLOWED');
  });

  it('create_instance / delete_instance 支持 payload.edition 改道到 server 内核', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);
    // 服务端内核的 create_instance 需要 runtime + acceptEula（EULA 不得代用户同意）
    const r = await k.runWrite('create_instance', {
      name: 'srv',
      edition: 'server',
      runtime: 'paper',
      acceptEula: true,
    });
    expect(r.ok).toBe(true);
    // server 内核的 create_instance 落在 <dataDir>/<id> 下（不是 instances/）
    expect(existsSync(join(dataDir, 'srv', 'server.properties'))).toBe(true);
    expect(existsSync(join(dataDir, 'instances'))).toBe(false);
  });

  it('edition 改道只对白名单内的 kind 生效（不给出「换个 edition 就换内核」的自由度）', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);
    await mkdir(join(dataDir, 'instances', 'only-java-instance'), { recursive: true });

    // list_instances 不在 EDITION_OVERRIDABLE 里 ⇒ 带 edition:'server' 也仍然读 java 内核
    const r = await k.runRead('list_instances', { edition: 'server' });
    expect((r.data as { instances: string[] }).instances).toEqual(['only-java-instance']);

    // get_capabilities 在白名单里 ⇒ edition 真的会改道（能力表内容不同）
    const javaCap = await k.runRead('get_capabilities', { edition: 'java' });
    const serverCap = await k.runRead('get_capabilities', { edition: 'server' });
    expect(JSON.stringify(javaCap.data)).not.toBe(JSON.stringify(serverCap.data));

    // 白名单外的 edition 值直接回落默认内核，不猜
    const bogus = await k.runRead('get_capabilities', { edition: 'devkit' });
    expect(bogus.ok).toBe(true);
    expect(JSON.stringify(bogus.data)).toBe(JSON.stringify(javaCap.data));
  });

  it('保留目录名（instances）被宿主拒绝：否则 list_servers 会把实例目录当服务端', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);

    const blocked = await k.runWrite('create_instance', { name: 'instances' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('KERNEL_ID_RESERVED');
    expect(existsSync(join(dataDir, 'instances'))).toBe(false);

    expect(RESERVED_KERNEL_IDS).toContain('instances');
    expect(k.confirmLog()).toHaveLength(0); // 拒绝发生在闸门之前，没有副作用也没有弹窗
  });

  it('permissionOf / riskOf 直接来自 contract 的 §10.6 分级', () => {
    expect(permissionOf('get_capabilities')).toBe('R');
    expect(permissionOf('install_mod')).toBe('W');
    expect(permissionOf('delete_instance')).toBe('X');
    expect(permissionOf('not_a_kind')).toBeNull();
    expect(riskOf('install_mod', 'W')).toBe('write');
    expect(riskOf('delete_instance', 'X')).toBe('execute');
  });

  it('describeKernelKinds 自描述全部 kind：R/W/X 分级 + uiReachable 只给 R 类', () => {
    const kinds = describeKernelKinds();
    const byName = new Map(kinds.map((k) => [k.kind, k]));
    expect(byName.get('get_capabilities')?.permission).toBe('R');
    expect(byName.get('get_capabilities')?.uiReachable).toBe(true);
    expect(byName.get('launch_instance')?.permission).toBe('X');
    expect(byName.get('launch_instance')?.uiReachable).toBe(false);
    expect(byName.get('read_logs')?.edition).toBe('server');
    expect(byName.get('validate_content')?.edition).toBe('bedrock');
    expect(byName.get('get_capabilities')?.edition).toBe('java');
    expect(kinds.length).toBeGreaterThanOrEqual(20);
    // 每个 kind 都必须有非空 edition / permission / risk（无 undefined 漏网）
    for (const k of kinds) {
      expect(['java', 'server', 'bedrock']).toContain(k.edition);
      expect(['R', 'W', 'X']).toContain(k.permission);
      expect(['write', 'execute']).toContain(k.risk);
    }
  });
});

describe('release（dispose）', () => {
  it('dispose 后 disposed=true，任何 read/write 都返回 KERNEL_RUNTIME_DISPOSED 而不抛', async () => {
    const k = make(await tmpRoot(), YES);
    expect(k.disposed).toBe(false);
    expect((await k.runRead('get_capabilities')).ok).toBe(true);

    k.dispose();
    expect(k.disposed).toBe(true);

    const read = await k.runRead('get_capabilities');
    expect(read.ok).toBe(false);
    expect(read.error?.code).toBe('KERNEL_RUNTIME_DISPOSED');

    const write = await k.runWrite('create_instance', { name: 'x' });
    expect(write.ok).toBe(false);
    expect(write.error?.code).toBe('KERNEL_RUNTIME_DISPOSED');
    // 释放必须幂等（before-quit 与 IPC 注销可能各调一次）
    expect(() => k.dispose()).not.toThrow();
  });

  it('dispose 后不再接受新确认请求（闸门不会在退出期弹窗）', async () => {
    const k = make(await tmpRoot(), YES);
    k.dispose();
    await k.runWrite('create_instance', { name: 'x' });
    expect(k.confirmLog()).toHaveLength(0);
  });
});

describe('sandbox 模式（§13.4）', () => {
  it('mode=sandbox 时写操作只落 sandboxDir，绝不自动进正式 dataDir', async () => {
    const dataDir = await tmpRoot();
    const sandboxDir = await tmpRoot();
    const k = createKernelRuntime({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });
    rt = k;

    const r = await k.runWrite('create_instance', { name: 'boxed' });
    expect(r.ok).toBe(true);
    expect(existsSync(join(sandboxDir, 'instances', 'boxed', 'instance.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'instances'))).toBe(false);
    expect(k.mode).toBe('sandbox');
    // 只读任务在 sandbox 模式下也读 sandboxDir（与内核的 readRoot 一致）
    const listed = await k.runRead('list_instances');
    expect((listed.data as { instances: string[] }).instances).toEqual(['boxed']);
  });

  it('mode=sandbox 但没给 sandboxDir → 内核拒绝写入，不落到 dataDir', async () => {
    const dataDir = await tmpRoot();
    const k = createKernelRuntime({ dataDir, mode: 'sandbox', confirm: YES });
    rt = k;
    const r = await k.runWrite('create_instance', { name: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SANDBOX_ROOT_MISSING');
    expect(existsSync(join(dataDir, 'instances'))).toBe(false);
  });
});

describe('内核产物的可读性（§10.2 读现状闭环）', () => {
  it('create_instance 后 list_instances / get_context_pack 都能读到同一个实例', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);
    await k.runWrite('create_instance', { name: 'ctx', versionId: '1.21.1', loader: 'fabric' });

    const listed = await k.runRead('list_instances');
    expect((listed.data as { instances: string[] }).instances).toEqual(['ctx']);

    const pack = await k.runRead('get_context_pack', { edition: 'java', instanceId: 'ctx' });
    expect(pack.ok).toBe(true);
    const data = pack.data as { target: Record<string, unknown>; parts: Record<string, unknown> };
    expect(data.target).toMatchObject({ edition: 'java', instanceId: 'ctx' });
    expect(data.parts).toBeDefined();
  });

  it('get_context_pack 对不存在的实例返回明确的 validation，而不是空数据', async () => {
    const k = make(await tmpRoot(), YES);
    const pack = await k.runRead('get_context_pack', { edition: 'java', instanceId: 'ghost' });
    expect(pack.ok).toBe(false);
    expect(pack.error?.category).toBe('validation');
  });

  it('read_logs / read_config 读的是 <dataDir>/<serverId> 下的真实文件', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);
    await mkdir(join(dataDir, 'srv-a', 'logs'), { recursive: true });
    await writeFile(join(dataDir, 'srv-a', 'server.properties'), 'motd=hello\n');
    await writeFile(join(dataDir, 'srv-a', 'logs', 'latest.log'), 'line-1\nline-2\n');

    const cfg = await k.runRead('read_config', { serverId: 'srv-a' });
    expect(cfg.ok).toBe(true);
    expect((cfg.data as { text: string }).text).toContain('motd=hello');

    const logs = await k.runRead('read_logs', { serverId: 'srv-a' });
    expect(logs.ok).toBe(true);
    expect((logs.data as { tail: string[] }).tail).toContain('line-2');
  });

  it('read_config / read_logs 对不存在的服务端返回 validation，不返回空壳成功', async () => {
    const k = make(await tmpRoot(), YES);
    const missing = await k.runRead('read_config', { serverId: 'no-such-server' });
    expect(missing.ok).toBe(false);
    expect(missing.error?.category).toBe('validation');
    const missingLogs = await k.runRead('read_logs', { serverId: 'no-such-server' });
    expect(missingLogs.ok).toBe(false);
  });

  it('validate_content 对一个合规的 bedrock 包给出空 errors（§10.3 机器可判定）', async () => {
    const packRoot = await tmpRoot();
    await writeFile(
      join(packRoot, 'manifest.json'),
      JSON.stringify({
        header: {
          uuid: '0123456789abcdef0123456789abcdef',
          version: [1, 0, 0],
          min_engine_version: [1, 20, 0],
        },
        modules: [{ uuid: 'fedcba9876543210fedcba9876543210', version: [1, 0, 0], type: 'script' }],
      }),
    );
    const k = make(await tmpRoot(), YES);
    const r = await k.runRead('validate_content', { path: packRoot });
    expect(r.ok).toBe(true);
    expect((r.data as { errors: string[] }).errors).toEqual([]);
    expect((r.data as { modules: number }).modules).toBe(1);
  });

  it('create_instance 写出的 instance.json 是合法 JSON 且带 sha256 产物引用（§0.5）', async () => {
    const dataDir = await tmpRoot();
    const k = make(dataDir, YES);
    const r = await k.runWrite('create_instance', { name: 'hashed', versionId: '1.21.1' });
    expect(r.ok).toBe(true);
    const artifacts = r.artifacts ?? [];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const raw = await readFile(join(dataDir, 'instances', 'hashed', 'instance.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ name: 'hashed', edition: 'java', versionId: '1.21.1' });
    // 原子写不留 *.tmp 残留（否则 §14 启动扫描每次都要清一遍）
    const files = await readdir(join(dataDir, 'instances', 'hashed'));
    expect(files.some((f) => f.includes('.tmp'))).toBe(false);
  });
});
