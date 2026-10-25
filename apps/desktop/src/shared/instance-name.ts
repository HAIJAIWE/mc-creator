/**
 * 实例名 = 目录名（PCL / HMCL / Modrinth 的做法）。
 *
 * ## 为什么严格校验而不「悄悄改」
 *
 * 一开始的设计里我倾向把非法字符替换掉（`我的/整合包` → `我的_整合包`），
 * 因为那样永远不会失败。但那会让**磁盘上的目录名和界面上的名字不一致**：
 * 用户在界面上看到「Fabulously/Optimized」，翻到磁盘上却是
 * `Fabulously_Optimized` —— 以后手动改配置文件、找存档时必然迷路。
 *
 * 所以改成**当场拒绝**：下载原版时弹框让用户起名，输入非法字符立刻红字提示，
 * 用户改到合法为止。这样「目录名 = 显示名」是 100% 成立的，不是「基本成立」。
 *
 * ## 校验规则从哪来
 *
 * Windows 文件系统（`.` / `..` / `CON` / 尾部点空格 / `<>:"/\|?*`），
 * 外加跨平台要求（`: * ? " < > |` 在 macOS/Linux 上是合法的，但为了
 * 「一个存档拷到别的系统也能用」，统一按最严的一档来）。
 */

/** 结果类型：不合法时带**可以直接展示给用户**的原因。 */
export type NameCheck = { ok: true } | { ok: false; reason: string };

/**
 * Windows 保留设备名（不分大小写）。
 *
 * `CON`、`PRN`、`AUX`、`NUL`、`COM1`-`COM9`、`LPT1`-`LPT9`。
 * 连扩展名都救不了 —— `CON.txt` 在 Windows 上仍然指向设备。
 *
 * 不校验这一条的后果很隐蔽：目录建得出来（NTFS 允许），但程序往里面
 * 读��时拿到的是设备句柄，表现为一个和「实例名」毫无关系的 IO 错误。
 */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** Windows 文件名非法字符（`<>:"/\|?*` + ASCII 控制字符）。 */
/**
 * Windows 文件名非法字符（`<>:"/\|?*` + ASCII 控制字符）。
 *
 * ⚠️ 控制字符用 `new RegExp` 的字符串形式，**不写字面量、也不写正则字面量里的
 * `\u0000` 转义**：两种都会让源文件里留真实的 NUL/RS 字节，读工具得按二进制
 * 处理，git diff 也会把整行显示成乱码。
 */
const ILLEGAL_CHARS = new RegExp('[<>:"/\\\\|?*' + '\\u0000-\\u001F]');

/** 空 / 纯空白 / `.` / `..`。 */
const RESERVED_NAMES = new Set(['', '.', '..']);

/**
 * 实例名长度上限。
 *
 * 260 是 Windows `MAX_PATH` 的经典上限，但真正的约束是：实例目录要参与
 * `baseDir/game/<name>/saves/<world>/region/r.0.0.mca` 这样的多层拼接，
 * 每一层都由用户命名。留出余量取 **64** —— 够放下「Fabulously Optimized
 * (Fabric 1.21.1)」这种最长见的名字，又不会让整条路径撞上限。
 */
export const MAX_INSTANCE_NAME_LENGTH = 64;

/**
 * 校验一个实例名是否可以**直接作为目录名**使用。
 *
 * 不做长度截断、不做字符替换 —— 只回答「行不行」，不行就给出原因。
 * 截断/替换会破坏「目录名 = 显示名」这个前提（见文件头）。
 */
export function checkInstanceName(raw: string): NameCheck {
  const name = raw;

  if (RESERVED_NAMES.has(name.trim())) {
    return { ok: false, reason: '名字不能为空，也不能是「.」或「..」' };
  }
  if (name !== name.trim()) {
    return { ok: false, reason: '名字首尾不能有空格' };
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    return {
      ok: false,
      reason: '名字不能以「.」或空格结尾（Windows 会自动去掉，导致对不上）',
    };
  }
  if (name.length > MAX_INSTANCE_NAME_LENGTH) {
    return {
      ok: false,
      reason: `名字太长（${name.length} 字），上限 ${MAX_INSTANCE_NAME_LENGTH} 字`,
    };
  }
  const bad = ILLEGAL_CHARS.exec(name);
  if (bad) {
    return {
      ok: false,
      reason: `名字里不能有这些字符：${[...`<>:"/\\|?*`].join(' ')}（当前含「${bad[0]}」）`,
    };
  }
  // 保留设备名要看「主名」：`CON (1)` 的主名是 `CON (1)`，合法；
  // `CON.txt` 的主名是 `CON`，非法。
  const stem = (name.split('.')[0] ?? '').toLowerCase();
  if (RESERVED_DEVICE_NAMES.has(stem)) {
    return { ok: false, reason: `「${stem}」是 Windows 保留设备名，不能用` };
  }
  return { ok: true };
}

/**
 * 给定一批已存在的实例名，生成一个不冲突的名字。
 *
 * 冲突时加 ` (2)` / ` (3)` …（Windows 资源管理器的习惯）。
 *
 * **只在用户没改名时使用**（比如连点两次「下载」）。已经起过名的实例
 * 撞名要走校验拒绝，不能静默改名 —— 否则用户会看到两个不同的实例
 * 突然变成「xxx」和「xxx (2)」。
 */
export function dedupeInstanceName(desired: string, existing: Iterable<string>): string {
  const taken = new Set<string>();
  for (const e of existing) taken.add(e.toLowerCase());
  if (!taken.has(desired.toLowerCase())) return desired;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${desired} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // 理论上到不了（999 个同名实例）。仍要给一个能用的结果而不是崩。
  return `${desired} (${Date.now()})`;
}

/** 碰撞判断只需要这两个字段（`InstanceRecord` / `InstanceSummary` 都满足）。 */
export interface ExistingInstanceName {
  id: string;
  versionId: string;
}

/** 起名对话框的校验结果。 */
export interface InstanceNameCheck {
  /** 阻断性错误：有值时确认按钮禁用，红字显示。 */
  error?: string;
  /** 非阻断提示：正常显示，不挡确认。 */
  hint?: string;
}

/**
 * 校验用户为**某个 MC 版本**起的实例名，连「会不会撞上已有实例」一起判。
 *
 * ## 为什么必须在这里判，而不是丢给 `dedupeInstanceName`
 *
 * `dedupeInstanceName` 会**静默**加 ` (2)` 后缀，而实例的 id 就是磁盘目录名 ——
 * 静默改名会让「界面上的名字」和「磁盘上的目录」当场不一致（见文件头）。
 * 更糟的是 `InstanceRegistry.create()` 撞到同 id 时是**就地更新**：
 * 用户随手起了个和别的实例一样的名字，会把那个实例的 `versionId` 一起改掉，
 * 等于把人家装好的实例悄悄换成另一个 MC 版本。所以这里当场拦住。
 *
 * 唯一放行的情况：撞到的正是**同一个 MC 版本**的同名实例 —— 那本来就是
 * 「重复下载同一版本 = 更新它」，不是冲突。
 *
 * 大小写不同也算撞：Windows 的目录不区分大小写，`Foo` 与 `foo` 是同一个文件夹。
 */
export function checkInstanceNameAgainst(
  desired: string,
  targetVersionId: string,
  existing: Iterable<ExistingInstanceName>,
): InstanceNameCheck {
  const basic = checkInstanceName(desired);
  if (!basic.ok) return { error: basic.reason };

  const list = [...existing];

  const exact = list.find((i) => i.id === desired);
  if (exact) {
    if (exact.versionId === targetVersionId) {
      return { hint: `已有同名实例，装的就是 MC ${exact.versionId} —— 下载会更新它` };
    }
    return {
      error: `已有同名实例「${exact.id}」，它装的是 MC ${exact.versionId}。换个名字，或先把那个实例删掉`,
    };
  }

  const lower = desired.toLowerCase();
  const caseOnly = list.find((i) => i.id.toLowerCase() === lower);
  if (caseOnly) {
    return {
      error: `已有同名实例「${caseOnly.id}」，只有大小写不同。Windows 上目录不分大小写，两者是同一个文件夹`,
    };
  }

  return {};
}
